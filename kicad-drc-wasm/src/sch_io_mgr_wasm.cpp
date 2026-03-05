/**
 * Simplified sch_io_mgr.cpp for WASM build.
 * Only registers the KiCad s-expression plugin (the only one needed for ERC).
 */

#include <wx/filename.h>
#include <wx/uri.h>

#include <sch_io/sch_io_mgr.h>
#include <sch_io/kicad_sexpr/sch_io_kicad_sexpr.h>
#include <common.h>
#include <wildcards_and_files_ext.h>
#include <kiway_player.h>
#include <string_utils.h>
#include <libraries/library_table_parser.h>

#define FMT_UNIMPLEMENTED   _( "Plugin '%s' does not implement the '%s' function." )
#define FMT_NOTFOUND        _( "Plugin type '%s' is not found." )


SCH_IO* SCH_IO_MGR::FindPlugin( SCH_FILE_T aFileType )
{
    switch( aFileType )
    {
    case SCH_KICAD: return new SCH_IO_KICAD_SEXPR();
    default:        return nullptr;
    }
}


const wxString SCH_IO_MGR::ShowType( SCH_FILE_T aType )
{
    switch( aType )
    {
    case SCH_KICAD:        return wxString( wxT( "KiCad" ) );
    case SCH_NESTED_TABLE: return LIBRARY_TABLE_ROW::TABLE_TYPE_NAME;
    default:               return wxString::Format( _( "Unknown SCH_FILE_T value: %d" ), aType );
    }
}


SCH_IO_MGR::SCH_FILE_T SCH_IO_MGR::EnumFromStr( const wxString& aType )
{
    if( aType == wxT( "KiCad" ) )
        return SCH_KICAD;
    else if( aType == LIBRARY_TABLE_ROW::TABLE_TYPE_NAME )
        return SCH_NESTED_TABLE;

    return SCH_FILE_UNKNOWN;
}


SCH_IO_MGR::SCH_FILE_T SCH_IO_MGR::GuessPluginTypeFromLibPath( const wxString& aLibPath, int aCtl )
{
    IO_RELEASER<SCH_IO> pi( FindPlugin( SCH_KICAD ) );

    if( pi && pi->CanReadLibrary( aLibPath ) )
        return SCH_KICAD;

    return SCH_FILE_UNKNOWN;
}


SCH_IO_MGR::SCH_FILE_T SCH_IO_MGR::GuessPluginTypeFromSchPath( const wxString& aSchematicPath,
                                                               int             aCtl )
{
    IO_RELEASER<SCH_IO> pi( FindPlugin( SCH_KICAD ) );

    if( pi && pi->CanReadSchematicFile( aSchematicPath ) )
        return SCH_KICAD;

    return SCH_FILE_UNKNOWN;
}
