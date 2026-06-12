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

// ── PDF outline font stubs ──────────────────────────────────────────────
// pdf_outline_font.cpp needs real FreeType/HarfBuzz, which the WASM build
// doesn't carry. The 3D-PDF export path that uses these is unreachable
// (we only request FORMAT::STEP), so no-op definitions satisfy the linker.
#include <plotters/pdf_outline_font.h>

PDF_OUTLINE_FONT_SUBSET::PDF_OUTLINE_FONT_SUBSET( KIFONT::OUTLINE_FONT*, unsigned ) {}
uint16_t PDF_OUTLINE_FONT_SUBSET::EnsureGlyph( uint32_t, const std::u32string& ) { return 0; }
bool PDF_OUTLINE_FONT_SUBSET::HasGlyphs() const { return false; }
const std::vector<uint8_t>& PDF_OUTLINE_FONT_SUBSET::FontFileData()
{
    static const std::vector<uint8_t> s_empty;
    return s_empty;
}
std::string PDF_OUTLINE_FONT_SUBSET::BuildWidthsArray() const { return {}; }
std::string PDF_OUTLINE_FONT_SUBSET::BuildToUnicodeCMap() const { return {}; }
std::string PDF_OUTLINE_FONT_SUBSET::BuildCIDToGIDStream() const { return {}; }
bool PDF_OUTLINE_FONT_SUBSET::GLYPH_KEY::operator<( const GLYPH_KEY& ) const { return false; }

PDF_OUTLINE_FONT_MANAGER::PDF_OUTLINE_FONT_MANAGER() {}
void PDF_OUTLINE_FONT_MANAGER::Reset() {}
void PDF_OUTLINE_FONT_MANAGER::EncodeString( const wxString&, KIFONT::OUTLINE_FONT*, bool, bool,
                                             std::vector<PDF_OUTLINE_FONT_RUN>* ) {}
std::vector<PDF_OUTLINE_FONT_SUBSET*> PDF_OUTLINE_FONT_MANAGER::AllSubsets() const { return {}; }

// ── U3D writer stubs ────────────────────────────────────────────────────
// The U3D/PDF export path is unreachable in the WASM build (we only request
// FORMAT::STEP), but exporter_step.cpp references the writer, so satisfy
// the linker with no-op definitions.
#include <exporters/u3d/writer.h>

U3D::WRITER::WRITER( const std::string& )
{
}

bool U3D::WRITER::Perform( const Handle( TDocStd_Document ) & )
{
    return false;
}
