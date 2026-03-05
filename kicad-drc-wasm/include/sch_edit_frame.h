/**
 * Stub sch_edit_frame.h for WASM build.
 * Provides a complete SCH_EDIT_FRAME class that compiles but does nothing.
 */
#ifndef SCH_EDIT_FRAME_H
#define SCH_EDIT_FRAME_H

#include <sch_base_frame.h>
#include <sch_sheet_path.h>
#include <symbol.h>
#include <sch_screen.h>
#include <tool/tool_manager.h>

class SCH_COMMIT;

class SCH_EDIT_FRAME : public SCH_BASE_FRAME
{
public:
    SCH_EDIT_FRAME() = default;
    virtual ~SCH_EDIT_FRAME() = default;

    SCH_SHEET_PATH& GetCurrentSheet() { return m_currentSheet; }
    const SCH_SHEET_PATH& GetCurrentSheet() const { return m_currentSheet; }
    void SetCurrentSheet( const SCH_SHEET_PATH& aSheet ) { m_currentSheet = aSheet; }

    SEVERITY GetSeverity( int aErrorCode ) const { return RPT_SEVERITY_ERROR; }

    void RecalculateConnections( SCH_COMMIT* aCommit, int aCleanupFlags ) {}

    EDA_ITEM* ResolveItem( const KIID& aId, bool aAllowNullptrReturn = false ) const
    {
        return nullptr;
    }

private:
    SCH_SHEET_PATH m_currentSheet;
};

#endif  // SCH_EDIT_FRAME_H
