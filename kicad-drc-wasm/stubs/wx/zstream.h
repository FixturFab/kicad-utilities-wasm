#pragma once
#include "stream.h"
class wxZlibInputStream : public wxInputStream {
public:
    wxZlibInputStream(wxInputStream&, int flags = 0) {}
};
class wxZlibOutputStream : public wxOutputStream {
public:
    wxZlibOutputStream(wxOutputStream& stream, int level = -1, int flags = 0)
        : m_stream(stream) {}
    wxOutputStream& Write(const void* buffer, size_t size) override {
        return m_stream.Write(buffer, size);
    }
    bool Close() { return true; }
private:
    wxOutputStream& m_stream;
};
