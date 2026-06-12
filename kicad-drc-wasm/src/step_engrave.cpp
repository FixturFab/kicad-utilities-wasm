/*
 * step_engrave.cpp — post-process a KiCad STEP export so silkscreen becomes
 * real engraved recesses in the board body.
 *
 * KiCad's STEP exporter emits silkscreen as zero-thickness planar faces
 * floating slightly above the board surface. This module:
 *   1. reads the exported STEP into an XCAF document (colors preserved),
 *   2. classifies shapes: planar (zero z-extent) = silkscreen cutters,
 *      thickest solid = board body,
 *   3. extrudes each silk face into a prism sunk `depth` mm into the board,
 *   4. boolean-cuts all prisms from the body in one operation,
 *   5. colors the cut faces near-white so viewers render the recess as
 *      frosted engraving,
 *   6. removes the now-consumed silk faces and rewrites the STEP in place.
 *
 * Kept separate from api.cpp and independent of KiCad classes — pure OCCT —
 * so it needs no changes to the kicad-src tree.
 */

#include <cstdio>
#include <string>
#include <vector>

#include <Bnd_Box.hxx>
#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepGProp.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <GProp_GProps.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <Quantity_Color.hxx>
#include <STEPCAFControl_Reader.hxx>
#include <STEPCAFControl_Writer.hxx>
#include <STEPControl_StepModelType.hxx>
#include <TDataStd_Name.hxx>
#include <TDF_Label.hxx>
#include <TDF_LabelSequence.hxx>
#include <TDocStd_Document.hxx>
#include <TopoDS_Compound.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopTools_MapOfShape.hxx>
#include <XCAFApp_Application.hxx>
#include <XCAFDoc_ColorTool.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>

#include "step_engrave.h"

namespace
{

struct ShapeEntry
{
    TDF_Label    label;     // product (shape) label
    TDF_Label    component; // assembly component instance referring to it (may be null)
    TopoDS_Shape shape;
    double       zMin = 0;
    double       zMax = 0;
};

// Collect simple (non-assembly) shape labels reachable from the free shapes
void collectSimpleShapes( const Handle( XCAFDoc_ShapeTool ) & shapeTool, const TDF_Label& label,
                          const TDF_Label& component, std::vector<ShapeEntry>& out )
{
    if( shapeTool->IsAssembly( label ) )
    {
        TDF_LabelSequence components;
        shapeTool->GetComponents( label, components );

        for( Standard_Integer i = 1; i <= components.Length(); i++ )
        {
            TDF_Label referred;

            if( shapeTool->GetReferredShape( components.Value( i ), referred ) )
                collectSimpleShapes( shapeTool, referred, components.Value( i ), out );
            else
                collectSimpleShapes( shapeTool, components.Value( i ), TDF_Label(), out );
        }

        return;
    }

    ShapeEntry entry;
    entry.label = label;
    entry.component = component;
    entry.shape = shapeTool->GetShape( label );

    if( entry.shape.IsNull() )
        return;

    Bnd_Box box;
    BRepBndLib::Add( entry.shape, box );

    if( box.IsVoid() )
        return;

    double xMin, yMin, xMax, yMax;
    box.Get( xMin, yMin, entry.zMin, xMax, yMax, entry.zMax );
    out.push_back( entry );
}

} // namespace

bool EngraveStepInPlace( const char* aPath, double aDepthMm )
{
    if( aDepthMm <= 0 )
        return false;

    // ── Read ────────────────────────────────────────────────────────────
    Handle( TDocStd_Document ) doc;
    XCAFApp_Application::GetApplication()->NewDocument( "BinXCAF", doc );

    STEPCAFControl_Reader reader;
    reader.SetColorMode( true );
    reader.SetNameMode( true );

    if( reader.ReadFile( aPath ) != IFSelect_RetDone || !reader.Transfer( doc ) )
    {
        fprintf( stderr, "[ENGRAVE] failed to read STEP file %s\n", aPath );
        return false;
    }

    Handle( XCAFDoc_ShapeTool ) shapeTool = XCAFDoc_DocumentTool::ShapeTool( doc->Main() );
    Handle( XCAFDoc_ColorTool ) colorTool = XCAFDoc_DocumentTool::ColorTool( doc->Main() );

    TDF_LabelSequence freeShapes;
    shapeTool->GetFreeShapes( freeShapes );

    std::vector<ShapeEntry> shapes;

    for( Standard_Integer i = 1; i <= freeShapes.Length(); i++ )
        collectSimpleShapes( shapeTool, freeShapes.Value( i ), TDF_Label(), shapes );

    if( shapes.empty() )
    {
        fprintf( stderr, "[ENGRAVE] no shapes found in document\n" );
        return false;
    }

    // ── Classify: planar shapes are silkscreen, thickest solid is the board ──
    constexpr double PLANAR_EPS = 0.001; // mm

    ShapeEntry* board = nullptr;
    std::vector<ShapeEntry*> silk;

    for( ShapeEntry& entry : shapes )
    {
        double thickness = entry.zMax - entry.zMin;

        if( thickness < PLANAR_EPS )
            silk.push_back( &entry );
        else if( !board || thickness > ( board->zMax - board->zMin ) )
            board = &entry;
    }

    if( !board || silk.empty() )
    {
        fprintf( stderr, "[ENGRAVE] nothing to engrave (board=%d silk=%zu)\n",
                 board != nullptr, silk.size() );
        return false;
    }

    fprintf( stderr, "[ENGRAVE] board z=[%.3f, %.3f], %zu silk shape(s), depth %.3f mm\n",
             board->zMin, board->zMax, silk.size(), aDepthMm );

    // ── Build cutter prisms from the silk faces ──────────────────────────
    // Start each prism slightly proud of the surface and overshoot the depth
    // by the same margin so the boolean never has to resolve coplanar faces.
    constexpr double OVERSHOOT = 0.01; // mm

    double boardMidZ = ( board->zMin + board->zMax ) / 2.0;

    TopTools_ListOfShape cutters;

    for( ShapeEntry* entry : silk )
    {
        bool   top      = entry->zMin >= boardMidZ;
        double surfaceZ = top ? board->zMax : board->zMin;
        double startZ   = surfaceZ + ( top ? OVERSHOOT : -OVERSHOOT );
        double sweep    = ( aDepthMm + OVERSHOOT ) * ( top ? -1.0 : 1.0 );

        gp_Trsf translate;
        translate.SetTranslation( gp_Vec( 0, 0, startZ - entry->zMin ) );

        BRepBuilderAPI_Transform moved( entry->shape, translate, true );

        for( TopExp_Explorer faceExp( moved.Shape(), TopAbs_FACE ); faceExp.More();
             faceExp.Next() )
        {
            BRepPrimAPI_MakePrism prism( faceExp.Current(), gp_Vec( 0, 0, sweep ) );

            if( prism.IsDone() )
                cutters.Append( prism.Shape() );
        }
    }

    if( cutters.IsEmpty() )
    {
        fprintf( stderr, "[ENGRAVE] no cutter prisms could be built\n" );
        return false;
    }

    // ── Subtract all prisms from the board body in one boolean ───────────
    BRepAlgoAPI_Cut cut;
    TopTools_ListOfShape arguments;
    arguments.Append( board->shape );
    cut.SetArguments( arguments );
    cut.SetTools( cutters );
    cut.SetRunParallel( false ); // single-threaded WASM
    cut.Build();

    if( !cut.IsDone() )
    {
        fprintf( stderr, "[ENGRAVE] boolean cut failed\n" );
        return false;
    }

    TopoDS_Shape engraved = cut.Shape();

    // ── Engraving plugs: the removed material volume ──────────────────────
    // Publish board ∩ cutters as separate single-solid products. Label-level
    // colors on simple solids are the only color channel that survives
    // common readers (occt-import-js drops per-face styles and explodes
    // compounds), and the plugs render as the frosted engraving marks,
    // sitting exactly in their recesses.
    BRepAlgoAPI_Common common;
    TopTools_ListOfShape commonArgs;
    commonArgs.Append( board->shape ); // pre-cut board
    common.SetArguments( commonArgs );
    common.SetTools( cutters );
    common.SetRunParallel( false );
    common.Build();

    // ── Swap the board shape and add the plug products ────────────────────
    shapeTool->SetShape( board->label, engraved );

    int plugCount = 0;

    if( common.IsDone() )
    {
        // Linear 0.92 — written to STEP as sRGB and read back as ~0.92 linear,
        // matching ENGRAVING_FACE_COLOR in the viewer's materials.mjs
        const Quantity_Color frostedWhite( 0.92, 0.92, 0.92, Quantity_TOC_RGB );

        for( TopExp_Explorer solidExp( common.Shape(), TopAbs_SOLID ); solidExp.More();
             solidExp.Next() )
        {
            TDF_Label plugLabel = shapeTool->AddShape( solidExp.Current(), false );
            TDataStd_Name::Set( plugLabel, "ENGRAVING" );
            colorTool->SetColor( plugLabel, frostedWhite, XCAFDoc_ColorGen );
            colorTool->SetColor( plugLabel, frostedWhite, XCAFDoc_ColorSurf );
            plugCount++;
        }
    }
    else
    {
        fprintf( stderr, "[ENGRAVE] warning: plug boolean failed; recesses uncolored\n" );
    }

    // ── Remove the consumed silkscreen shapes ─────────────────────────────
    // A product referenced by an assembly component cannot be removed until
    // the component instance is removed first.
    for( ShapeEntry* entry : silk )
    {
        if( !entry->component.IsNull() )
            shapeTool->RemoveComponent( entry->component );

        bool removed = shapeTool->RemoveShape( entry->label, true );

        if( !removed )
            fprintf( stderr, "[ENGRAVE] warning: silk shape removal failed\n" );
    }

    shapeTool->UpdateAssemblies();

    fprintf( stderr, "[ENGRAVE] cut OK, %d engraving plug(s) added, %zu silk shapes removed\n",
             plugCount, silk.size() );

    // ── Write back ────────────────────────────────────────────────────────
    STEPCAFControl_Writer writer;
    writer.SetColorMode( true );
    writer.SetNameMode( true );

    if( !writer.Transfer( doc, STEPControl_AsIs ) || writer.Write( aPath ) != IFSelect_RetDone )
    {
        fprintf( stderr, "[ENGRAVE] failed to write engraved STEP\n" );
        return false;
    }

    return true;
}
