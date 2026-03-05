/**
 * Stub symbol_editor_settings.h for WASM build.
 * The real header is in eeschema/symbol_editor/ and we need a minimal definition.
 */
#ifndef SYMBOL_EDITOR_SETTINGS_H
#define SYMBOL_EDITOR_SETTINGS_H

#include <settings/app_settings.h>

class SYMBOL_EDITOR_SETTINGS : public APP_SETTINGS_BASE
{
public:
    SYMBOL_EDITOR_SETTINGS() : APP_SETTINGS_BASE( "symbol_editor", 0 ) {}
    virtual ~SYMBOL_EDITOR_SETTINGS();
};

#endif  // SYMBOL_EDITOR_SETTINGS_H
