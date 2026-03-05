/**
 * Stub sch_selection_tool.h for WASM build.
 * The real header is in eeschema/tools/ and depends on the GUI tool system.
 */
#ifndef SCH_SELECTION_TOOL_H
#define SCH_SELECTION_TOOL_H

class EDA_ITEM;

class SCH_SELECTION_TOOL
{
public:
    virtual ~SCH_SELECTION_TOOL() = default;
    void RemoveItemFromSel(EDA_ITEM*, bool = false) {}
    void AddItemToSel(EDA_ITEM*, bool = false) {}
};

#endif  // SCH_SELECTION_TOOL_H
