/**
 * Stub sch_base_frame.h for WASM build.
 * Overrides the real eeschema/sch_base_frame.h to avoid heavy GUI deps.
 * Inherits from EDA_DRAW_FRAME so static_cast from EDA_DRAW_FRAME* works.
 */
#ifndef SCH_BASE_FRAME_H
#define SCH_BASE_FRAME_H

#include <eda_draw_frame.h>
#include <schematic_holder.h>

class SYMBOL_EDIT_FRAME;
class LIB_SYMBOL;
class SCH_SCREEN;

class SCH_BASE_FRAME : public EDA_DRAW_FRAME, public SCHEMATIC_HOLDER
{
public:
    SCH_BASE_FRAME()
        : EDA_DRAW_FRAME( nullptr, nullptr, FRAME_SCH, wxEmptyString,
                          wxDefaultPosition, wxDefaultSize, 0, wxEmptyString, schIUScale )
    {}
    virtual ~SCH_BASE_FRAME() = default;

    bool IsType( FRAME_T aType ) const { return false; }

    // SCHEMATIC_HOLDER interface
    void AddToScreen( EDA_ITEM* aItem, SCH_SCREEN* aScreen = nullptr ) override {}
    void RemoveFromScreen( EDA_ITEM* aItem, SCH_SCREEN* aScreen ) override {}
};

#endif  // SCH_BASE_FRAME_H
