/**
 * Stub pcb_edit_frame.h for WASM build (specctra compilation only).
 *
 * Provides enough of PCB_EDIT_FRAME that the member functions in
 * specctra_export.cpp and specctra_import.cpp compile.  These member
 * functions are never called at runtime — only the free functions
 * DSN::ExportBoardToSpecctraFile() and DSN::ImportSpecctraSession().
 */
#ifndef __PCB_EDIT_FRAME_H__
#define __PCB_EDIT_FRAME_H__

#include <wx/window.h>
#include <board.h>
#include <base_screen.h>
#include <view/view.h>

// Minimal canvas stub with a view
class PCB_DRAW_PANEL_GAL_STUB
{
public:
    KIGFX::VIEW* GetView() { return &m_view; }
private:
    KIGFX::VIEW m_view;
};

class PCB_EDIT_FRAME : public wxWindow
{
public:
    PCB_EDIT_FRAME() = default;
    virtual ~PCB_EDIT_FRAME() = default;

    BOARD* GetBoard() const { return m_board; }
    BASE_SCREEN* GetScreen() const { return m_screen; }
    PCB_DRAW_PANEL_GAL_STUB* GetCanvas() const { return nullptr; }

    void SetStatusText( const wxString& ) {}
    void ClearUndoRedoList() {}
    void OnModify() {}

    // Declared but defined in the .cpp files — NOT defined here
    bool ExportSpecctraFile( const wxString& aFullFilename );
    bool ImportSpecctraSession( const wxString& fullFileName );

private:
    BOARD* m_board = nullptr;
    BASE_SCREEN* m_screen = nullptr;
};

#endif  // __PCB_EDIT_FRAME_H__
