/**
 * Single-threaded stub replacement for BS::thread_pool.
 *
 * In Emscripten, synchronous ccall() from JavaScript blocks the calling thread.
 * If C++ code dispatches work to pthreads that then need to proxy operations
 * (memory growth, filesystem) back to the blocked thread, the result is a
 * deadlock. This stub runs all tasks inline on the calling thread.
 */

#pragma once

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <future>
#include <functional>
#include <type_traits>
#include <vector>

namespace BS {

using opt_t = std::uint8_t;
using priority_t = std::int8_t;

namespace tp {
    enum tp_flags : opt_t {
        none                 = 0,
        priority             = 1 << 0,
        pause                = 1 << 1,
        wait_deadlock_checks = 1 << 2,
    };
} // namespace tp

// Priority constants matching real BS thread pool
enum pr : priority_t {
    lowest  = -128,
    low     = -64,
    normal  = 0,
    high    = +64,
    highest = +127,
};

/**
 * multi_future<T> — vector of futures with collective wait().
 */
template <typename T>
class multi_future {
public:
    using iterator = typename std::vector<std::future<T>>::iterator;
    using const_iterator = typename std::vector<std::future<T>>::const_iterator;

    void push_back(std::future<T>&& f) { futures_.push_back(std::move(f)); }

    void wait() const {
        for (const auto& f : futures_)
            if (f.valid()) f.wait();
    }

    template <typename R, typename P>
    bool wait_for(const std::chrono::duration<R, P>&) const { return true; }

    template <typename C, typename D>
    bool wait_until(const std::chrono::time_point<C, D>&) const { return true; }

    [[nodiscard]] std::size_t ready_count() const { return futures_.size(); }
    [[nodiscard]] bool valid() const noexcept {
        for (const auto& f : futures_)
            if (!f.valid()) return false;
        return true;
    }

    std::size_t size() const { return futures_.size(); }
    std::future<T>& operator[](std::size_t i) { return futures_[i]; }
    const std::future<T>& operator[](std::size_t i) const { return futures_[i]; }

    iterator begin() { return futures_.begin(); }
    iterator end() { return futures_.end(); }
    const_iterator begin() const { return futures_.begin(); }
    const_iterator end() const { return futures_.end(); }
private:
    std::vector<std::future<T>> futures_;
};

/**
 * blocks — helper to divide a range into blocks.
 */
template <typename T1, typename T2, typename T = std::common_type_t<T1, T2>>
class blocks {
public:
    blocks(T1 first, T2 last, std::size_t num_blocks = 0)
        : first_(static_cast<T>(first)),
          last_(static_cast<T>(last))
    {
        if (last_ <= first_) { num_blocks_ = 0; block_size_ = 0; remainder_ = 0; return; }
        std::size_t total = static_cast<std::size_t>(last_ - first_);
        num_blocks_ = (num_blocks > 0 && num_blocks <= total) ? num_blocks : total;
        block_size_ = total / num_blocks_;
        remainder_ = total % num_blocks_;
    }
    T start(std::size_t i) const {
        return first_ + static_cast<T>(i * block_size_ + (i < remainder_ ? i : remainder_));
    }
    T end(std::size_t i) const {
        return start(i) + static_cast<T>(block_size_ + (i < remainder_ ? 1 : 0));
    }
    std::size_t get_num_blocks() const { return num_blocks_; }
private:
    T first_, last_;
    std::size_t num_blocks_, block_size_, remainder_;
};

/**
 * thread_pool — single-threaded inline executor stub.
 * Template param matches real BS::thread_pool<opt_t>.
 */
template <opt_t OptFlags = tp::none>
class thread_pool {
public:
    thread_pool() = default;
    explicit thread_pool(std::size_t) {}
    template <typename F>
    explicit thread_pool(std::size_t, F&&) {}
    template <typename F>
    explicit thread_pool(F&&) {}

    ~thread_pool() = default;

    thread_pool(const thread_pool&) = delete;
    thread_pool(thread_pool&&) = delete;
    thread_pool& operator=(const thread_pool&) = delete;
    thread_pool& operator=(thread_pool&&) = delete;

    [[nodiscard]] std::size_t get_thread_count() const { return 0; }

    // ── submit_task: run inline, return resolved future ──────────────────
    template <typename F, typename R = std::invoke_result_t<std::decay_t<F>>>
    [[nodiscard]] std::future<R> submit_task(F&& task, priority_t = 0) {
        std::promise<R> p;
        auto fut = p.get_future();
        try {
            if constexpr (std::is_void_v<R>) {
                task();
                p.set_value();
            } else {
                p.set_value(task());
            }
        } catch (...) {
            p.set_exception(std::current_exception());
        }
        return fut;
    }

    // ── submit_loop: run loop body inline for each index ─────────────────
    template <typename T1, typename T2, typename F>
    [[nodiscard]] multi_future<void> submit_loop(T1 first, T2 last, F&& loop,
                                                  std::size_t = 0, priority_t = 0) {
        multi_future<void> mf;
        using T = std::common_type_t<T1, T2>;
        for (T i = static_cast<T>(first); i < static_cast<T>(last); ++i)
            loop(i);
        std::promise<void> p;
        p.set_value();
        mf.push_back(p.get_future());
        return mf;
    }

    // ── submit_blocks: run block function inline ─────────────────────────
    template <typename T1, typename T2, typename F,
              typename R = std::invoke_result_t<std::decay_t<F>,
                  std::common_type_t<T1,T2>, std::common_type_t<T1,T2>>>
    [[nodiscard]] multi_future<R> submit_blocks(T1 first, T2 last, F&& block,
                                                 std::size_t num_blocks = 0,
                                                 priority_t = 0) {
        multi_future<R> mf;
        blocks<T1, T2> b(first, last, num_blocks ? num_blocks : 1);
        for (std::size_t i = 0; i < b.get_num_blocks(); ++i) {
            std::promise<R> p;
            try {
                if constexpr (std::is_void_v<R>) {
                    block(b.start(i), b.end(i));
                    p.set_value();
                } else {
                    p.set_value(block(b.start(i), b.end(i)));
                }
            } catch (...) {
                p.set_exception(std::current_exception());
            }
            mf.push_back(p.get_future());
        }
        return mf;
    }

    // ── submit_sequence: run sequence function inline ────────────────────
    template <typename T1, typename T2, typename F,
              typename R = std::invoke_result_t<std::decay_t<F>, std::common_type_t<T1,T2>>>
    [[nodiscard]] multi_future<R> submit_sequence(T1 first, T2 last, F&& seq,
                                                   priority_t = 0) {
        multi_future<R> mf;
        using T = std::common_type_t<T1, T2>;
        for (T i = static_cast<T>(first); i < static_cast<T>(last); ++i) {
            std::promise<R> p;
            try {
                if constexpr (std::is_void_v<R>) {
                    seq(i);
                    p.set_value();
                } else {
                    p.set_value(seq(i));
                }
            } catch (...) {
                p.set_exception(std::current_exception());
            }
            mf.push_back(p.get_future());
        }
        return mf;
    }

    // ── detach variants: run inline ──────────────────────────────────────
    template <typename F>
    void detach_task(F&& task, priority_t = 0) { task(); }

    template <typename T1, typename T2, typename F>
    void detach_loop(T1 first, T2 last, F&& loop, std::size_t = 0, priority_t = 0) {
        using T = std::common_type_t<T1, T2>;
        for (T i = static_cast<T>(first); i < static_cast<T>(last); ++i)
            loop(i);
    }

    template <typename T1, typename T2, typename F>
    void detach_blocks(T1 first, T2 last, F&& block, std::size_t num_blocks = 0, priority_t = 0) {
        blocks<T1, T2> b(first, last, num_blocks ? num_blocks : 1);
        for (std::size_t i = 0; i < b.get_num_blocks(); ++i)
            block(b.start(i), b.end(i));
    }

    template <typename T1, typename T2, typename F>
    void detach_sequence(T1 first, T2 last, F&& seq, priority_t = 0) {
        using T = std::common_type_t<T1, T2>;
        for (T i = static_cast<T>(first); i < static_cast<T>(last); ++i)
            seq(i);
    }

    // ── wait / pause: no-ops (all tasks already complete) ─────────────────
    void wait() {}

    template <typename R, typename P>
    bool wait_for(const std::chrono::duration<R, P>&) { return true; }

    template <typename C, typename D>
    bool wait_until(const std::chrono::time_point<C, D>&) { return true; }
    void pause() {}
    void unpause() {}
    [[nodiscard]] bool is_paused() const { return false; }
    [[nodiscard]] std::size_t get_tasks_queued() const { return 0; }
    [[nodiscard]] std::size_t get_tasks_running() const { return 0; }
    [[nodiscard]] std::size_t get_tasks_total() const { return 0; }
};

using priority_thread_pool = thread_pool<tp::priority>;

} // namespace BS
