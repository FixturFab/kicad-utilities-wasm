/**
 * DRC + ERC API implementation for WASM.
 *
 * Links against KiCad's existing libraries to provide DRC and ERC as standalone
 * functions callable without wxWidgets application infrastructure.
 */

#include "kicad_drc_api.h"

#include <memory>
#include <string>
#include <sstream>
#include <fstream>

// KiCad headers - DRC
#include <board.h>
#include <board_design_settings.h>
#include <pcb_marker.h>
#include <richio.h>
#include <pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.h>
#include <drc/drc_engine.h>
#include <drc/drc_item.h>
#include <drc/drc_report.h>
#include <pgm_base.h>
#include <advanced_config.h>
#include <connectivity/connectivity_data.h>
#include <marker_base.h>
#include <kiface_base.h>
#include <thread_pool.h>
#include <wx/filename.h>

// KiCad headers - PCB geometry extraction
#include <board_stackup_manager/board_stackup.h>
#include <footprint.h>
#include <pad.h>
#include <pcb_track.h>
#include <zone.h>
#include <geometry/shape_poly_set.h>
#include <geometry/shape_line_chain.h>
#include <layer_ids.h>
#include <lset.h>
#include <nlohmann/json.hpp>

// KiCad headers - ERC
#include <schematic.h>
#include <sch_io/sch_io_mgr.h>
#include <sch_io/kicad_sexpr/sch_io_kicad_sexpr.h>
#include <sch_sheet.h>
#include <sch_screen.h>
#include <sch_sheet_path.h>
#include <erc/erc.h>
#include <erc/erc_settings.h>
#include <erc/erc_report.h>
#include <connection_graph.h>
#include <settings/settings_manager.h>
#include <project_sch.h>
#include <tool/tool_manager.h>

// Stub for Kiface() - required by some KiCad library code but not used in DRC path
static KIFACE_BASE* s_kiface_stub = nullptr;

KIFACE_BASE& Kiface()
{
    wxASSERT( s_kiface_stub );
    return *s_kiface_stub;
}

// Minimal PGM_BASE subclass for standalone DRC operation.
// Provides the thread pool needed by connectivity algorithms and satisfies
// Pgm() references from GAL and other transitive dependencies.
class PGM_DRC_STANDALONE : public PGM_BASE
{
public:
    PGM_DRC_STANDALONE() : PGM_BASE()
    {
        // Initialize the thread pool required by connectivity algorithms.
        // KICAD_SINGLETON::Init() is not exported from libkicommon.so,
        // so we set the pointer directly.
        int num_threads = std::max( 0, ADVANCED_CFG::GetCfg().m_MaximumThreads );
        m_singleton.m_ThreadPool = new BS::priority_thread_pool( num_threads );

        // Initialize settings manager - needed by ERC (SCHEMATIC_SETTINGS
        // calls GetAppSettings<EESCHEMA_SETTINGS>() through Pgm()).
        m_settings_manager = std::make_unique<SETTINGS_MANAGER>();
    }

    ~PGM_DRC_STANDALONE()
    {
        delete m_singleton.m_ThreadPool;
        m_singleton.m_ThreadPool = nullptr;
    }

    void MacOpenFile( const wxString& ) override {}
};

// Global state
static std::unique_ptr<BOARD>              g_board;
static std::string                         g_json_result;
static std::string                         g_geometry_json_result;
static std::unique_ptr<PGM_DRC_STANDALONE> g_pgm;

static void ensure_pgm_initialized()
{
    if( !g_pgm )
    {
        g_pgm = std::make_unique<PGM_DRC_STANDALONE>();
        SetPgm( g_pgm.get() );
    }
}

extern "C" {

int kicad_load_pcb( const char* pcb_content, size_t length )
{
    ensure_pgm_initialized();

    g_board.reset();
    g_json_result.clear();

    if( !pcb_content )
        return -1;

    std::string content;
    if( length == 0 )
        content = std::string( pcb_content );
    else
        content = std::string( pcb_content, length );

    try
    {
        STRING_LINE_READER reader( content, wxS( "input.kicad_pcb" ) );
        PCB_IO_KICAD_SEXPR plugin;
        BOARD* board = plugin.DoLoad( reader, nullptr, nullptr, nullptr, 0 );

        if( !board )
            return -2;

        g_board.reset( board );

        // Build connectivity data (needed for unconnected items DRC check)
        g_board->BuildConnectivity();

        return 0;
    }
    catch( const IO_ERROR& e )
    {
        fprintf( stderr, "PCB parse error: %s\n",
                 static_cast<const char*>( e.What().mb_str() ) );
        return -3;
    }
    catch( const std::exception& e )
    {
        fprintf( stderr, "PCB parse error: %s\n", e.what() );
        return -4;
    }
}

int kicad_run_drc( void )
{
    if( !g_board )
        return -1;

    g_json_result.clear();

    BOARD_DESIGN_SETTINGS& bds = g_board->GetDesignSettings();

    if( !bds.m_DRCEngine )
        bds.m_DRCEngine = std::make_shared<DRC_ENGINE>( g_board.get(), &bds );

    std::shared_ptr<DRC_ENGINE> drcEngine = bds.m_DRCEngine;
    drcEngine->SetBoard( g_board.get() );
    drcEngine->SetDesignSettings( &bds );

    // Initialize the DRC engine - loads default rules and registers test providers
    try
    {
        drcEngine->InitEngine( wxFileName() );
    }
    catch( ... )
    {
        // Best effort - continue with default rules even if custom rules fail
    }

    g_board->DeleteMARKERs( true, true );

    // Set violation handler: create markers and add them to the board
    drcEngine->SetViolationHandler(
            [&]( const std::shared_ptr<DRC_ITEM>& aItem, const VECTOR2I& aPos, int aLayer,
                 const std::function<void( PCB_MARKER* )>& aPathGenerator )
            {
                PCB_MARKER* marker = new PCB_MARKER( aItem, aPos, aLayer );
                aPathGenerator( marker );
                g_board->Add( marker );
            } );

    drcEngine->RunTests( EDA_UNITS::MM, true /*reportAllTrackErrors*/, false /*testFootprints*/ );
    drcEngine->ClearViolationHandler();

    // Write JSON report to a temporary file and read it back
    wxString tmpPath = wxFileName::CreateTempFileName( wxS( "drc_report" ) );

    auto markersProvider = std::make_shared<DRC_ITEMS_PROVIDER>(
            g_board.get(), MARKER_BASE::MARKER_DRC, MARKER_BASE::MARKER_DRAWING_SHEET );
    auto ratsnestProvider = std::make_shared<DRC_ITEMS_PROVIDER>(
            g_board.get(), MARKER_BASE::MARKER_RATSNEST );
    auto fpWarningsProvider = std::make_shared<DRC_ITEMS_PROVIDER>(
            g_board.get(), MARKER_BASE::MARKER_PARITY );

    int severities = RPT_SEVERITY_ERROR | RPT_SEVERITY_WARNING;
    markersProvider->SetSeverities( severities );
    ratsnestProvider->SetSeverities( severities );
    fpWarningsProvider->SetSeverities( severities );

    DRC_REPORT reportWriter( g_board.get(), EDA_UNITS::MM,
                             markersProvider, ratsnestProvider, fpWarningsProvider );

    bool ok = reportWriter.WriteJsonReport( tmpPath );

    if( ok )
    {
        std::ifstream ifs( static_cast<const char*>( tmpPath.mb_str() ) );
        if( ifs )
        {
            std::ostringstream oss;
            oss << ifs.rdbuf();
            g_json_result = oss.str();
        }
        wxRemoveFile( tmpPath );
    }

    int count = markersProvider->GetCount() + ratsnestProvider->GetCount()
                + fpWarningsProvider->GetCount();

    return count;
}

const char* kicad_get_drc_results( void )
{
    if( g_json_result.empty() )
        return nullptr;

    return g_json_result.c_str();
}

void kicad_cleanup( void )
{
    g_json_result.clear();
    g_geometry_json_result.clear();
    g_board.reset();
}

const char* kicad_get_pcb_geometry( void )
{
    if( !g_board )
        return nullptr;

    g_geometry_json_result.clear();

    try
    {
        nlohmann::json result;
        result["format_version"] = 1;
        result["units"] = "mm";

        // ── Board outline ──────────────────────────────────────────
        SHAPE_POLY_SET outlines;
        bool outlineOk = g_board->GetBoardPolygonOutlines( outlines, true, nullptr, false, false );

        nlohmann::json boardJson;
        nlohmann::json polygonsJson = nlohmann::json::array();

        if( outlineOk )
        {
            // Convert arcs to line segments for easier serialization
            outlines.ClearArcs();

            for( int i = 0; i < outlines.OutlineCount(); i++ )
            {
                nlohmann::json polyJson;

                // Outer outline
                const SHAPE_LINE_CHAIN& outline = outlines.COutline( i );
                nlohmann::json outlinePoints = nlohmann::json::array();

                for( int j = 0; j < outline.PointCount(); j++ )
                {
                    const VECTOR2I& pt = outline.CPoint( j );
                    outlinePoints.push_back( { pcbIUScale.IUTomm( pt.x ),
                                               pcbIUScale.IUTomm( pt.y ) } );
                }

                polyJson["outline"] = outlinePoints;

                // Holes
                nlohmann::json holesJson = nlohmann::json::array();

                for( int h = 0; h < outlines.HoleCount( i ); h++ )
                {
                    const SHAPE_LINE_CHAIN& hole = outlines.CHole( i, h );
                    nlohmann::json holePoints = nlohmann::json::array();

                    for( int j = 0; j < hole.PointCount(); j++ )
                    {
                        const VECTOR2I& pt = hole.CPoint( j );
                        holePoints.push_back( { pcbIUScale.IUTomm( pt.x ),
                                                pcbIUScale.IUTomm( pt.y ) } );
                    }

                    holesJson.push_back( holePoints );
                }

                polyJson["holes"] = holesJson;
                polygonsJson.push_back( polyJson );
            }
        }

        boardJson["outline"]["polygons"] = polygonsJson;

        // Board thickness
        BOARD_STACKUP stackup = g_board->GetStackupOrDefault();
        int thicknessIU = stackup.BuildBoardThicknessFromStackup();
        boardJson["thickness_mm"] = pcbIUScale.IUTomm( thicknessIU );

        result["board"] = boardJson;

        // ── Stackup ──────────────────────────────────────────────────
        nlohmann::json stackupJson = nlohmann::json::array();
        double zOffset = 0.0;

        for( int i = 0; i < stackup.GetCount(); i++ )
        {
            BOARD_STACKUP_ITEM* item = stackup.GetStackupLayer( i );

            if( !item || !item->IsEnabled() )
                continue;

            nlohmann::json layerJson;

            switch( item->GetType() )
            {
            case BS_ITEM_TYPE_COPPER:      layerJson["type"] = "copper"; break;
            case BS_ITEM_TYPE_DIELECTRIC:  layerJson["type"] = "dielectric"; break;
            case BS_ITEM_TYPE_SOLDERMASK:  layerJson["type"] = "soldermask"; break;
            case BS_ITEM_TYPE_SILKSCREEN:  layerJson["type"] = "silkscreen"; break;
            case BS_ITEM_TYPE_SOLDERPASTE: layerJson["type"] = "solderpaste"; break;
            default:                       layerJson["type"] = "unknown"; break;
            }

            PCB_LAYER_ID layerId = item->GetBrdLayerId();
            if( layerId != UNDEFINED_LAYER )
                layerJson["layer_id"] = std::string( g_board->GetLayerName( layerId ).mb_str() );

            double thicknessMm = pcbIUScale.IUTomm( item->GetThickness() );
            layerJson["thickness_mm"] = thicknessMm;
            layerJson["z_offset_mm"] = zOffset;

            wxString material = item->GetMaterial();
            if( !material.IsEmpty() )
                layerJson["material"] = std::string( material.mb_str() );

            if( item->HasEpsilonRValue() )
                layerJson["epsilon_r"] = item->GetEpsilonR();

            stackupJson.push_back( layerJson );
            zOffset += thicknessMm;
        }

        result["stackup"] = stackupJson;
        result["copper_layer_count"] = g_board->GetCopperLayerCount();

        // ── Components ────────────────────────────────────────────────
        nlohmann::json componentsJson = nlohmann::json::array();

        for( const FOOTPRINT* fp : g_board->Footprints() )
        {
            nlohmann::json compJson;

            compJson["reference"] = std::string( fp->GetReference().mb_str() );

            VECTOR2I pos = fp->GetPosition();
            compJson["position"]["x_mm"] = pcbIUScale.IUTomm( pos.x );
            compJson["position"]["y_mm"] = pcbIUScale.IUTomm( pos.y );

            compJson["rotation_deg"] = fp->GetOrientation().AsDegrees();
            compJson["side"] = ( fp->GetLayer() == B_Cu ) ? "bottom" : "top";

            // 3D models
            nlohmann::json modelsJson = nlohmann::json::array();

            for( const FP_3DMODEL& model : fp->Models() )
            {
                if( !model.m_Show )
                    continue;

                nlohmann::json modelJson;
                modelJson["filename"] = std::string( model.m_Filename.mb_str() );
                modelJson["offset"]["x_mm"] = model.m_Offset.x;
                modelJson["offset"]["y_mm"] = model.m_Offset.y;
                modelJson["offset"]["z_mm"] = model.m_Offset.z;
                modelJson["rotation"]["x_deg"] = model.m_Rotation.x;
                modelJson["rotation"]["y_deg"] = model.m_Rotation.y;
                modelJson["rotation"]["z_deg"] = model.m_Rotation.z;
                modelJson["scale"]["x"] = model.m_Scale.x;
                modelJson["scale"]["y"] = model.m_Scale.y;
                modelJson["scale"]["z"] = model.m_Scale.z;
                modelsJson.push_back( modelJson );
            }

            compJson["models"] = modelsJson;
            componentsJson.push_back( compJson );
        }

        result["components"] = componentsJson;

        // ── Copper layers ─────────────────────────────────────────────
        nlohmann::json copperLayersJson = nlohmann::json::array();

        // Build a map of copper layer z_offset and thickness from stackup
        std::map<PCB_LAYER_ID, double> copperZOffset;
        std::map<PCB_LAYER_ID, double> copperThickness;
        double zOff = 0.0;

        for( int i = 0; i < stackup.GetCount(); i++ )
        {
            BOARD_STACKUP_ITEM* item = stackup.GetStackupLayer( i );
            if( !item || !item->IsEnabled() )
                continue;

            double thk = pcbIUScale.IUTomm( item->GetThickness() );

            if( item->GetType() == BS_ITEM_TYPE_COPPER )
            {
                PCB_LAYER_ID lid = item->GetBrdLayerId();
                copperZOffset[lid] = zOff;
                copperThickness[lid] = thk;
            }

            zOff += thk;
        }

        // Get enabled copper layers
        LSET enabledCu = g_board->GetEnabledLayers() & LSET::AllCuMask();
        LSEQ cuSeq = enabledCu.Seq();

        for( PCB_LAYER_ID layer : cuSeq )
        {
            SHAPE_POLY_SET layerPolys;

            // Collect pad shapes on this layer
            for( const FOOTPRINT* fp : g_board->Footprints() )
            {
                for( const PAD* pad : fp->Pads() )
                {
                    if( pad->IsOnLayer( layer ) )
                    {
                        pad->TransformShapeToPolygon( layerPolys, layer, 0,
                                                      ARC_LOW_DEF, ERROR_INSIDE );
                    }
                }
            }

            // Collect track shapes on this layer
            for( const PCB_TRACK* track : g_board->Tracks() )
            {
                if( track->Type() == PCB_VIA_T )
                {
                    const PCB_VIA* via = static_cast<const PCB_VIA*>( track );
                    if( via->IsOnLayer( layer ) )
                    {
                        via->TransformShapeToPolygon( layerPolys, layer, 0,
                                                      ARC_LOW_DEF, ERROR_INSIDE );
                    }
                }
                else
                {
                    if( track->IsOnLayer( layer ) )
                    {
                        track->TransformShapeToPolygon( layerPolys, layer, 0,
                                                         ARC_LOW_DEF, ERROR_INSIDE );
                    }
                }
            }

            // Collect zone fill polygons on this layer
            for( const ZONE* zone : g_board->Zones() )
            {
                if( zone->IsOnCopperLayer() && zone->GetLayerSet().test( layer )
                    && zone->IsFilled() )
                {
                    zone->TransformSolidAreasShapesToPolygon( layer, layerPolys );
                }
            }

            // Simplify and serialize
            layerPolys.ClearArcs();
            layerPolys.Simplify();

            nlohmann::json layerCuJson;
            layerCuJson["layer_id"] = std::string( g_board->GetLayerName( layer ).mb_str() );
            layerCuJson["z_start_mm"] = copperZOffset.count( layer ) ? copperZOffset[layer] : 0.0;
            layerCuJson["thickness_mm"] = copperThickness.count( layer )
                                              ? copperThickness[layer] : 0.035;

            nlohmann::json cuPolygonsJson = nlohmann::json::array();

            for( int i = 0; i < layerPolys.OutlineCount(); i++ )
            {
                nlohmann::json polyJson;

                const SHAPE_LINE_CHAIN& outline = layerPolys.COutline( i );
                nlohmann::json outlinePoints = nlohmann::json::array();

                for( int j = 0; j < outline.PointCount(); j++ )
                {
                    const VECTOR2I& pt = outline.CPoint( j );
                    outlinePoints.push_back( { pcbIUScale.IUTomm( pt.x ),
                                               pcbIUScale.IUTomm( pt.y ) } );
                }

                polyJson["outline"] = outlinePoints;

                nlohmann::json holesJson = nlohmann::json::array();

                for( int h = 0; h < layerPolys.HoleCount( i ); h++ )
                {
                    const SHAPE_LINE_CHAIN& hole = layerPolys.CHole( i, h );
                    nlohmann::json holePoints = nlohmann::json::array();

                    for( int j = 0; j < hole.PointCount(); j++ )
                    {
                        const VECTOR2I& pt = hole.CPoint( j );
                        holePoints.push_back( { pcbIUScale.IUTomm( pt.x ),
                                                pcbIUScale.IUTomm( pt.y ) } );
                    }

                    holesJson.push_back( holePoints );
                }

                polyJson["holes"] = holesJson;
                cuPolygonsJson.push_back( polyJson );
            }

            layerCuJson["polygons"] = cuPolygonsJson;
            copperLayersJson.push_back( layerCuJson );
        }

        result["copper_layers"] = copperLayersJson;

        // ── Drill holes ──────────────────────────────────────────────
        nlohmann::json holesJson = nlohmann::json::array();

        // Holes from pads
        for( const FOOTPRINT* fp : g_board->Footprints() )
        {
            for( const PAD* pad : fp->Pads() )
            {
                if( !pad->HasHole() )
                    continue;

                nlohmann::json holeJson;
                holeJson["type"] = ( pad->GetAttribute() == PAD_ATTRIB::NPTH ) ? "npth" : "pth";

                VECTOR2I pos = pad->GetPosition();
                holeJson["x_mm"] = pcbIUScale.IUTomm( pos.x );
                holeJson["y_mm"] = pcbIUScale.IUTomm( pos.y );
                holeJson["diameter_mm"] = pcbIUScale.IUTomm( pad->GetDrillSizeX() );
                holeJson["top_layer"] = std::string(
                        g_board->GetLayerName( F_Cu ).mb_str() );
                holeJson["bottom_layer"] = std::string(
                        g_board->GetLayerName( B_Cu ).mb_str() );

                if( pad->GetAttribute() != PAD_ATTRIB::NPTH )
                    holeJson["plating_thickness_mm"] = 0.025;

                holesJson.push_back( holeJson );
            }
        }

        // Holes from vias
        for( const PCB_TRACK* track : g_board->Tracks() )
        {
            if( track->Type() != PCB_VIA_T )
                continue;

            const PCB_VIA* via = static_cast<const PCB_VIA*>( track );

            nlohmann::json holeJson;
            holeJson["type"] = "pth";

            VECTOR2I pos = via->GetPosition();
            holeJson["x_mm"] = pcbIUScale.IUTomm( pos.x );
            holeJson["y_mm"] = pcbIUScale.IUTomm( pos.y );
            holeJson["diameter_mm"] = pcbIUScale.IUTomm( via->GetDrillValue() );
            holeJson["top_layer"] = std::string(
                    g_board->GetLayerName( via->TopLayer() ).mb_str() );
            holeJson["bottom_layer"] = std::string(
                    g_board->GetLayerName( via->BottomLayer() ).mb_str() );
            holeJson["plating_thickness_mm"] = 0.025;

            holesJson.push_back( holeJson );
        }

        result["holes"] = holesJson;

        g_geometry_json_result = result.dump();
        return g_geometry_json_result.c_str();
    }
    catch( const std::exception& e )
    {
        fprintf( stderr, "PCB geometry extraction error: %s\n", e.what() );
        return nullptr;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// ERC API Implementation
// ═══════════════════════════════════════════════════════════════════════════

} // end DRC extern "C" block

// ERC global state
static std::unique_ptr<SCHEMATIC>          g_schematic;
static std::unique_ptr<SETTINGS_MANAGER>   g_erc_settings_mgr;
static std::string                         g_erc_json_result;
static const wxString                      g_sch_virtual_dir = wxS( "/tmp/kicad_wasm_sch/" );

extern "C" {

int kicad_load_schematic( const char* sch_content, size_t length )
{
    ensure_pgm_initialized();

    g_schematic.reset();
    g_erc_json_result.clear();

    if( !sch_content )
        return -1;

    std::string content;
    if( length == 0 )
        content = std::string( sch_content );
    else
        content = std::string( sch_content, length );

    try
    {
        // Write content to virtual filesystem so KiCad's file-based loader works
        wxString schDir = g_sch_virtual_dir;
        wxString schPath = schDir + wxS( "input.kicad_sch" );
        wxString prjPath = schDir + wxS( "input.kicad_pro" );

        // Create directories
        wxFileName::Mkdir( schDir, wxS_DIR_DEFAULT, wxPATH_MKDIR_FULL );

        // Write schematic file
        {
            std::ofstream ofs( (const char*)schPath.c_str() );
            ofs << content;
        }

        // Create minimal project file so KiCad doesn't complain
        {
            std::ofstream ofs( (const char*)prjPath.c_str() );
            ofs << "{}" ;
        }

        fprintf( stderr, "[ERC] Creating settings manager...\n" );

        // Use a standalone SETTINGS_MANAGER (not from PGM_BASE which may not
        // have one initialized) to create and manage the project.
        // Pass aSetActive=false to avoid calling Pgm().GetLibraryManager()
        // which is not initialized in WASM.
        if( !g_erc_settings_mgr )
            g_erc_settings_mgr = std::make_unique<SETTINGS_MANAGER>();

        fprintf( stderr, "[ERC] Loading project at: %s\n", (const char*)prjPath.c_str() );
        try {
            g_erc_settings_mgr->LoadProject( prjPath, false );
        } catch( const std::exception& e2 ) {
            fprintf( stderr, "[ERC] LoadProject threw: %s\n", e2.what() );
            return -7;
        }
        fprintf( stderr, "[ERC] Getting project...\n" );
        PROJECT* project = g_erc_settings_mgr->GetProject( prjPath );

        if( !project )
        {
            fprintf( stderr, "Failed to create project\n" );
            return -2;
        }

        fprintf( stderr, "[ERC] Creating schematic object...\n" );
        try {
            g_schematic = std::make_unique<SCHEMATIC>( project );
        } catch( const std::exception& e2 ) {
            fprintf( stderr, "[ERC] SCHEMATIC constructor threw: %s\n", e2.what() );
            return -6;
        } catch( ... ) {
            fprintf( stderr, "[ERC] SCHEMATIC constructor threw unknown exception\n" );
            return -6;
        }
        fprintf( stderr, "[ERC] Creating default screens...\n" );
        g_schematic->CreateDefaultScreens();

        fprintf( stderr, "[ERC] Loading schematic file...\n" );
        IO_RELEASER<SCH_IO> pi( SCH_IO_MGR::FindPlugin( SCH_IO_MGR::SCH_KICAD ) );

        SCH_SHEET* rootSheet = pi->LoadSchematicFile( schPath, g_schematic.get() );

        if( !rootSheet )
        {
            g_schematic.reset();
            return -3;
        }

        fprintf( stderr, "[ERC] Post-load processing...\n" );
        g_schematic->SetTopLevelSheets( { rootSheet } );

        // Post-load processing
        SCH_SHEET_LIST sheetList = g_schematic->BuildSheetListSortedByPageNumbers();
        SCH_SCREENS    screens( g_schematic->Root() );

        for( SCH_SCREEN* screen = screens.GetFirst(); screen; screen = screens.GetNext() )
            screen->UpdateLocalLibSymbolLinks();

        if( g_schematic->RootScreen()->GetFileFormatVersionAtLoad() < 20221002 )
            sheetList.UpdateSymbolInstanceData( g_schematic->RootScreen()->GetSymbolInstances() );

        sheetList.UpdateSheetInstanceData( g_schematic->RootScreen()->GetSheetInstances() );

        if( g_schematic->RootScreen()->GetFileFormatVersionAtLoad() < 20230221 )
            screens.FixLegacyPowerSymbolMismatches();

        fprintf( stderr, "[ERC] Annotating power symbols...\n" );
        sheetList.AnnotatePowerSymbols();

        fprintf( stderr, "[ERC] Building connectivity graph...\n" );
        // Build connectivity graph
        g_schematic->ConnectionGraph()->Reset();

        g_schematic->RecalculateConnections( nullptr, GLOBAL_CLEANUP, nullptr );
        fprintf( stderr, "[ERC] Load complete.\n" );

        return 0;
    }
    catch( const IO_ERROR& e )
    {
        fprintf( stderr, "Schematic parse error: %s\n",
                 static_cast<const char*>( e.What().mb_str() ) );
        g_schematic.reset();
        return -4;
    }
    catch( const std::exception& e )
    {
        fprintf( stderr, "Schematic parse error: %s\n", e.what() );
        g_schematic.reset();
        return -5;
    }
}

int kicad_load_schematic_sheet( const char* sheet_path, const char* content, size_t length )
{
    if( !sheet_path || !content )
        return -1;

    std::string str_content;
    if( length == 0 )
        str_content = std::string( content );
    else
        str_content = std::string( content, length );

    try
    {
        // Write sheet content to virtual filesystem
        wxString fullPath = g_sch_virtual_dir + wxString( sheet_path );

        // Ensure parent directory exists
        wxFileName fn( fullPath );
        wxFileName::Mkdir( fn.GetPath(), wxS_DIR_DEFAULT, wxPATH_MKDIR_FULL );

        std::ofstream ofs( (const char*)fullPath.c_str() );
        ofs << str_content;

        return 0;
    }
    catch( const std::exception& e )
    {
        fprintf( stderr, "Sheet write error: %s\n", e.what() );
        return -2;
    }
}

int kicad_run_erc( void )
{
    if( !g_schematic )
        return -1;

    g_erc_json_result.clear();

    try
    {
        fprintf( stderr, "[ERC] Creating ERC_TESTER...\n" );
        ERC_TESTER ercTester( g_schematic.get() );
        ERC_SETTINGS& ercSettings = g_schematic->ErcSettings();

        fprintf( stderr, "[ERC] AnnotatePowerSymbols...\n" );
        g_schematic->BuildSheetListSortedByPageNumbers().AnnotatePowerSymbols();

        fprintf( stderr, "[ERC] TestDuplicateSheetNames...\n" );
        if( ercSettings.IsTestEnabled( ERCE_DUPLICATE_SHEET_NAME ) )
            ercTester.TestDuplicateSheetNames( true );

        fprintf( stderr, "[ERC] ConnectionGraph()->RunERC...\n" );
        g_schematic->ConnectionGraph()->RunERC();

        fprintf( stderr, "[ERC] TestMultiunitFootprints...\n" );
        if( ercSettings.IsTestEnabled( ERCE_DIFFERENT_UNIT_FP ) )
            ercTester.TestMultiunitFootprints();

        fprintf( stderr, "[ERC] TestMissingUnits...\n" );
        if( ercSettings.IsTestEnabled( ERCE_MISSING_UNIT )
            || ercSettings.IsTestEnabled( ERCE_MISSING_INPUT_PIN )
            || ercSettings.IsTestEnabled( ERCE_MISSING_POWER_INPUT_PIN )
            || ercSettings.IsTestEnabled( ERCE_MISSING_BIDI_PIN ) )
        {
            ercTester.TestMissingUnits();
        }

        fprintf( stderr, "[ERC] TestMultUnitPinConflicts...\n" );
        if( ercSettings.IsTestEnabled( ERCE_DIFFERENT_UNIT_NET ) )
            ercTester.TestMultUnitPinConflicts();

        fprintf( stderr, "[ERC] TestDuplicatePinNets...\n" );
        if( ercSettings.IsTestEnabled( ERCE_DUPLICATE_PIN_ERROR ) )
            ercTester.TestDuplicatePinNets();

        fprintf( stderr, "[ERC] TestPinToPin...\n" );
        if( ercSettings.IsTestEnabled( ERCE_PIN_TO_PIN_ERROR )
            || ercSettings.IsTestEnabled( ERCE_POWERPIN_NOT_DRIVEN )
            || ercSettings.IsTestEnabled( ERCE_PIN_NOT_DRIVEN ) )
        {
            ercTester.TestPinToPin();
        }

        fprintf( stderr, "[ERC] TestStackedPinNotation...\n" );
        if( ercSettings.IsTestEnabled( ERCE_STACKED_PIN_SYNTAX ) )
            ercTester.TestStackedPinNotation();

        fprintf( stderr, "[ERC] TestSimilarLabels...\n" );
        if( ercSettings.IsTestEnabled( ERCE_SIMILAR_LABELS )
            || ercSettings.IsTestEnabled( ERCE_SIMILAR_POWER )
            || ercSettings.IsTestEnabled( ERCE_SIMILAR_LABEL_AND_POWER ) )
        {
            ercTester.TestSimilarLabels();
        }

        fprintf( stderr, "[ERC] TestGroundPins...\n" );
        if( ercSettings.IsTestEnabled( ERCE_GROUND_PIN_NOT_GROUND ) )
            ercTester.TestGroundPins();

        fprintf( stderr, "[ERC] TestSameLocalGlobalLabel...\n" );
        if( ercSettings.IsTestEnabled( ERCE_SAME_LOCAL_GLOBAL_LABEL ) )
            ercTester.TestSameLocalGlobalLabel();

        fprintf( stderr, "[ERC] TestTextVars...\n" );
        if( ercSettings.IsTestEnabled( ERCE_UNRESOLVED_VARIABLE ) )
            ercTester.TestTextVars( nullptr );

        fprintf( stderr, "[ERC] TestFieldNameWhitespace...\n" );
        if( ercSettings.IsTestEnabled( ERCE_FIELD_NAME_WHITESPACE ) )
            ercTester.TestFieldNameWhitespace();

        // Skip TestSimModelIssues - SIM_LIB_MGR::CreateModel is stubbed
        // Skip TestLibSymbolIssues - requires Pgm().GetLibraryManager()
        // Skip TestFootprintLinkIssues - requires CvPcb (passed as nullptr)

        fprintf( stderr, "[ERC] TestNoConnectPins...\n" );
        if( ercSettings.IsTestEnabled( ERCE_NOCONNECT_CONNECTED ) )
            ercTester.TestNoConnectPins();

        fprintf( stderr, "[ERC] TestFootprintFilters...\n" );
        if( ercSettings.IsTestEnabled( ERCE_FOOTPRINT_FILTERS ) )
            ercTester.TestFootprintFilters();

        fprintf( stderr, "[ERC] TestOffGridEndpoints...\n" );
        if( ercSettings.IsTestEnabled( ERCE_ENDPOINT_OFF_GRID ) )
            ercTester.TestOffGridEndpoints();

        fprintf( stderr, "[ERC] TestFourWayJunction...\n" );
        if( ercSettings.IsTestEnabled( ERCE_FOUR_WAY_JUNCTION ) )
            ercTester.TestFourWayJunction();

        fprintf( stderr, "[ERC] TestLabelMultipleWires...\n" );
        if( ercSettings.IsTestEnabled( ERCE_LABEL_MULTIPLE_WIRES ) )
            ercTester.TestLabelMultipleWires();

        fprintf( stderr, "[ERC] TestMissingNetclasses...\n" );
        if( ercSettings.IsTestEnabled( ERCE_UNDEFINED_NETCLASS ) )
            ercTester.TestMissingNetclasses();

        fprintf( stderr, "[ERC] ResolveERCExclusionsPostUpdate...\n" );
        g_schematic->ResolveERCExclusionsPostUpdate();

        fprintf( stderr, "[ERC] Tests complete, collecting results...\n" );
        // Collect results
        std::shared_ptr<SHEETLIST_ERC_ITEMS_PROVIDER> markersProvider =
                std::make_shared<SHEETLIST_ERC_ITEMS_PROVIDER>( g_schematic.get() );

        int severities = RPT_SEVERITY_ERROR | RPT_SEVERITY_WARNING;
        markersProvider->SetSeverities( severities );

        int count = markersProvider->GetCount();

        // Generate JSON report
        ERC_REPORT reportWriter( g_schematic.get(), EDA_UNITS::MM, markersProvider );

        wxString tmpPath = wxFileName::CreateTempFileName( wxS( "erc_report" ) );
        bool ok = reportWriter.WriteJsonReport( tmpPath );

        if( ok )
        {
            std::ifstream ifs( (const char*)tmpPath.c_str() );
            if( ifs )
            {
                std::ostringstream oss;
                oss << ifs.rdbuf();
                g_erc_json_result = oss.str();
            }
            wxRemoveFile( tmpPath );
        }

        return count;
    }
    catch( const std::exception& e )
    {
        fprintf( stderr, "ERC error: %s\n", e.what() );
        return -2;
    }
}

const char* kicad_get_erc_results( void )
{
    if( g_erc_json_result.empty() )
        return nullptr;

    return g_erc_json_result.c_str();
}

void kicad_cleanup_schematic( void )
{
    g_erc_json_result.clear();
    g_schematic.reset();
    // Don't reset g_erc_settings_mgr - reuse across calls
}

} // extern "C"
