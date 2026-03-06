/**
 * Stubs for STEP export dependencies not needed in the WASM build.
 *
 * Provides:
 * - EXPORTER_STEP_PARAMS::GetDefaultExportExtension() and GetFormatName()
 *   (defined in job_export_pcb_3d.cpp which pulls in too many JOB dependencies)
 */

#include <jobs/job_export_pcb_3d.h>

wxString EXPORTER_STEP_PARAMS::GetDefaultExportExtension() const
{
    switch( m_Format )
    {
    case EXPORTER_STEP_PARAMS::FORMAT::STEP:  return wxS( "step" );
    case EXPORTER_STEP_PARAMS::FORMAT::STEPZ: return wxS( "stpz" );
    case EXPORTER_STEP_PARAMS::FORMAT::BREP:  return wxS( "brep" );
    case EXPORTER_STEP_PARAMS::FORMAT::XAO:   return wxS( "xao" );
    case EXPORTER_STEP_PARAMS::FORMAT::GLB:   return wxS( "glb" );
    case EXPORTER_STEP_PARAMS::FORMAT::PLY:   return wxS( "ply" );
    case EXPORTER_STEP_PARAMS::FORMAT::STL:   return wxS( "stl" );
    case EXPORTER_STEP_PARAMS::FORMAT::U3D:   return wxS( "u3d" );
    case EXPORTER_STEP_PARAMS::FORMAT::PDF:   return wxS( "pdf" );
    default:                                  return wxEmptyString;
    }
}

wxString EXPORTER_STEP_PARAMS::GetFormatName() const
{
    switch( m_Format )
    {
    case EXPORTER_STEP_PARAMS::FORMAT::STEP:  return wxS( "STEP" );
    case EXPORTER_STEP_PARAMS::FORMAT::STEPZ: return wxS( "STPZ" );
    case EXPORTER_STEP_PARAMS::FORMAT::BREP:  return wxS( "BREP" );
    case EXPORTER_STEP_PARAMS::FORMAT::XAO:   return wxS( "XAO" );
    case EXPORTER_STEP_PARAMS::FORMAT::GLB:   return wxS( "Binary GLTF" );
    case EXPORTER_STEP_PARAMS::FORMAT::PLY:   return wxS( "PLY" );
    case EXPORTER_STEP_PARAMS::FORMAT::STL:   return wxS( "STL" );
    case EXPORTER_STEP_PARAMS::FORMAT::U3D:   return wxS( "Universal 3D" );
    case EXPORTER_STEP_PARAMS::FORMAT::PDF:   return wxS( "PDF" );
    default:                                  return wxEmptyString;
    }
}
