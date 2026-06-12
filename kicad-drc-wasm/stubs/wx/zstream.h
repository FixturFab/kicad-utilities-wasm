#pragma once
#include "stream.h"

enum wxZlibCompressionLevels {
    wxZ_DEFAULT_COMPRESSION = -1,
    wxZ_NO_COMPRESSION = 0,
    wxZ_BEST_SPEED = 1,
    wxZ_BEST_COMPRESSION = 9,
};

// wxZLIB_* header flags are already #defined in stream.h

class wxZlibInputStream : public wxInputStream {
public:
    wxZlibInputStream(wxInputStream&, int flags = 0) {}
};
class wxZlibOutputStream : public wxOutputStream {
public:
    using wxOutputStream::Write; // keep the Write(wxInputStream&) overload visible
    wxZlibOutputStream(wxOutputStream& stream, int level = -1, int flags = 0)
        : m_stream(stream) {}
    wxOutputStream& Write(const void* buffer, size_t size) override {
        return m_stream.Write(buffer, size);
    }
    bool Close() { return true; }
private:
    wxOutputStream& m_stream;
};
