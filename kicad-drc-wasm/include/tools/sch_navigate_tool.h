/**
 * Stub sch_navigate_tool.h for WASM build.
 * Overrides the real eeschema/tools/sch_navigate_tool.h to avoid GUI tool deps.
 */
#ifndef SCH_NAVIGATE_TOOL_H
#define SCH_NAVIGATE_TOOL_H

#include <wx/string.h>
#include <tool/tool_base.h>

class SCH_NAVIGATE_TOOL : public TOOL_BASE
{
public:
    SCH_NAVIGATE_TOOL() : TOOL_BASE( INTERACTIVE, 0, "eeschema.NavigateTool" ) {}
    ~SCH_NAVIGATE_TOOL() override = default;

    void HypertextCommand( const wxString& ) {}

    static inline wxString g_BackLink;
};

#endif  // SCH_NAVIGATE_TOOL_H
