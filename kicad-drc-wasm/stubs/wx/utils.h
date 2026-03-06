#pragma once

#include "string.h"
#include "filefn.h"
#include <cstdlib>
#include <unistd.h>
inline wxString wxGetHomeDir() { return wxString("/"); }
inline wxString wxGetCwd() {
    char buf[4096];
    if (getcwd(buf, sizeof(buf)))
        return wxString(buf);
    return wxString("/");
}
inline bool wxSetWorkingDirectory(const wxString& dir) {
    return chdir(dir.c_str()) == 0;
}
inline long wxGetFreeMemory() { return 256 * 1024 * 1024; }
inline unsigned long wxGetProcessId() { return 1; }

inline void wxMilliSleep(unsigned long ms) {}
inline void wxMicroSleep(unsigned long us) {}
inline void wxSleep(int secs) {}
inline void wxUsleep(unsigned long us) {}
inline void wxYield() {}
inline bool wxSafeYield(void* = nullptr, bool = false) { return true; }

inline bool wxLaunchDefaultBrowser(const wxString&) { return false; }
inline bool wxLaunchDefaultApplication(const wxString&) { return false; }

inline void wxBell() {}

// wxGetEnv / wxSetEnv
inline bool wxGetEnv(const wxString& name, wxString* value) {
    const char* v = getenv(name.c_str());
    if(v && value) *value = wxString(v);
    return v != nullptr;
}
inline bool wxSetEnv(const wxString& name, const wxString& value) {
    return setenv(name.c_str(), value.c_str(), 1) == 0;
}
inline bool wxUnsetEnv(const wxString& name) {
    return unsetenv(name.c_str()) == 0;
}

// wxStandardPaths stub
class wxStandardPaths
{
public:
    static wxStandardPaths& Get() { static wxStandardPaths sp; return sp; }
    wxString GetUserDataDir() const { return wxString("/"); }
    wxString GetUserConfigDir() const { return wxString("/"); }
    wxString GetUserLocalDataDir() const { return wxString("/"); }
    wxString GetTempDir() const { return wxString("/tmp"); }
    wxString GetExecutablePath() const { return wxString("/kicad"); }
    wxString GetDataDir() const { return wxString("/"); }
    wxString GetResourcesDir() const { return wxString("/"); }
    wxString GetPluginsDir() const { return wxString("/"); }
    wxString GetDocumentsDir() const { return wxString("/"); }
    wxString GetAppDocumentsDir() const { return wxString("/"); }
    void SetInstallPrefix(const wxString&) {}
    wxString GetInstallPrefix() const { return wxString("/usr"); }
    void UseAppInfo(int flags) {}
};
