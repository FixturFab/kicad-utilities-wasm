/**
 * Stub sch_selection.h for WASM build.
 * The real header is in eeschema/tools/ and requires tool/selection.h (GUI tool system).
 * We provide minimal methods needed by sch_io_kicad_sexpr.cpp Format().
 */
#ifndef SCH_SELECTION_H
#define SCH_SELECTION_H

#include <deque>

class EDA_ITEM;
class SCH_SCREEN;
class SCH_SHEET_PATH;

// Minimal stub - the real class inherits from SELECTION (GUI tool infrastructure)
class SCH_SELECTION
{
public:
    using ITER = std::deque<EDA_ITEM*>::iterator;
    using CITER = std::deque<EDA_ITEM*>::const_iterator;

    SCH_SELECTION( SCH_SCREEN* aScreen = nullptr ) : m_screen( aScreen ) {}

    ITER begin() { return m_items.begin(); }
    ITER end() { return m_items.end(); }
    CITER begin() const { return m_items.cbegin(); }
    CITER end() const { return m_items.cend(); }

    SCH_SCREEN* GetScreen() { return m_screen; }

private:
    std::deque<EDA_ITEM*> m_items;
    SCH_SCREEN* m_screen = nullptr;
};

#endif  // SCH_SELECTION_H
