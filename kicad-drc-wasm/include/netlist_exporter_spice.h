/**
 * Stub netlist_exporter_spice.h for WASM build.
 * Only provides the ConvertToSpiceMarkup static method used by schematic.cpp.
 */
#ifndef NETLIST_EXPORTER_SPICE_H
#define NETLIST_EXPORTER_SPICE_H

#include <wx/string.h>

class NETLIST_EXPORTER_SPICE
{
public:
    static void ConvertToSpiceMarkup( wxString* aNetName )
    {
        // Minimal implementation: replace slashes and spaces for SPICE compatibility
        aNetName->Replace( wxT( "/" ), wxT( "_" ) );
        aNetName->Replace( wxT( " " ), wxT( "_" ) );
    }
};

#endif  // NETLIST_EXPORTER_SPICE_H
