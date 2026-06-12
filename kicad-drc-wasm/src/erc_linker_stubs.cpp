/**
 * ERC-specific linker stubs for WASM build.
 * Separate from linker_stubs.cpp to avoid conflicts between forward declarations
 * and real eeschema headers.
 */

#include <wx/string.h>
#include <richio.h>

// ── SIM_LIB_MGR stubs (simulation not needed for basic ERC) ──────────────
#include <sim/sim_lib_mgr.h>

SIM_LIB_MGR::SIM_LIB_MGR( const PROJECT* aPrj ) : m_project( aPrj ), m_forceFullParse( false ) {}

SIM_LIBRARY::MODEL SIM_LIB_MGR::CreateModel( const SCH_SHEET_PATH* aSheetPath,
                                              SCH_SYMBOL& aSymbol,
                                              bool aResolve, int aDepth,
                                              const wxString& aVariantName,
                                              REPORTER& aReporter,
                                              const wxString& aMergedSimPins )
{
    // Return a null reference - caller should handle gracefully
    static SIM_MODEL* s_null = nullptr;
    return { "", *s_null };
}

// ── SYMBOL_LIBRARY_ADAPTER stubs ─────────────────────────────────────────
#include <libraries/symbol_library_adapter.h>

const char* SYMBOL_LIBRARY_ADAPTER::PropPowerSymsOnly = "";
const char* SYMBOL_LIBRARY_ADAPTER::PropNonPowerSymsOnly = "";

SYMBOL_LIBRARY_ADAPTER::SYMBOL_LIBRARY_ADAPTER( LIBRARY_MANAGER& aMgr )
    : LIBRARY_MANAGER_ADAPTER( aMgr ) {}

LIB_SYMBOL* SYMBOL_LIBRARY_ADAPTER::LoadSymbol( const wxString&, const wxString& )
{
    return nullptr;
}

// SYMBOL_LIBRARY_ADAPTER virtual method stubs
// LoadOne is the "key function" - defining it out-of-line emits the vtable
#include <libraries/library_manager.h>

std::optional<LIB_STATUS> SYMBOL_LIBRARY_ADAPTER::LoadOne( LIB_DATA* aLib )
{
    return std::nullopt;
}

wxString SYMBOL_LIBRARY_ADAPTER::GlobalPathEnvVariableName()
{
    return wxT( "KICAD_SYMBOL_DIR" );
}

bool SYMBOL_LIBRARY_ADAPTER::SupportsConfigurationDialog( const wxString& ) const { return false; }
void SYMBOL_LIBRARY_ADAPTER::ShowConfigurationDialog( const wxString&, wxWindow* ) const {}

void SYMBOL_LIBRARY_ADAPTER::enumerateLibrary( LIB_DATA*, const wxString& ) {}

LIBRARY_RESULT<IO_BASE*> SYMBOL_LIBRARY_ADAPTER::createPlugin( const LIBRARY_TABLE_ROW* )
{
    return tl::unexpected( LIBRARY_ERROR{ wxT("Not implemented in WASM") } );
}

SCH_IO* SYMBOL_LIBRARY_ADAPTER::schplugin( const LIB_DATA* ) { return nullptr; }

LEAK_AT_EXIT<std::map<wxString, LIB_DATA>> SYMBOL_LIBRARY_ADAPTER::GlobalLibraries;
std::shared_mutex SYMBOL_LIBRARY_ADAPTER::GlobalLibraryMutex;

// ── SCH_COMMIT stubs (edit/undo not needed for ERC) ──────────────────────
#include <sch_commit.h>

SCH_COMMIT::SCH_COMMIT( TOOL_MANAGER* aToolMgr )
    : m_toolMgr( aToolMgr ), m_isLibEditor( false ) {}

SCH_COMMIT::SCH_COMMIT( EDA_DRAW_FRAME* aFrame )
    : m_toolMgr( nullptr ), m_isLibEditor( false ) {}

SCH_COMMIT::~SCH_COMMIT() {}

void SCH_COMMIT::Push( const wxString& aMessage, int aCommitFlags ) {}
void SCH_COMMIT::Revert() {}

COMMIT& SCH_COMMIT::Stage( EDA_ITEM* aItem, CHANGE_TYPE aChangeType,
                            BASE_SCREEN* aScreen, RECURSE_MODE aRecurse )
{
    return *this;
}

COMMIT& SCH_COMMIT::Stage( std::vector<EDA_ITEM*>& container, CHANGE_TYPE aChangeType,
                            BASE_SCREEN* aScreen )
{
    return *this;
}

EDA_ITEM* SCH_COMMIT::makeImage( EDA_ITEM* aItem ) const { return nullptr; }
EDA_ITEM* SCH_COMMIT::undoLevelItem( EDA_ITEM* aItem ) const { return aItem; }

void SCH_COMMIT::pushLibEdit( const wxString& aMessage, int aCommitFlags ) {}
void SCH_COMMIT::pushSchEdit( const wxString& aMessage, int aCommitFlags ) {}
void SCH_COMMIT::revertLibEdit() {}

// ── PICKED_ITEMS_LIST stubs ──────────────────────────────────────────────
#include <undo_redo_container.h>

PICKED_ITEMS_LIST::PICKED_ITEMS_LIST() {}
PICKED_ITEMS_LIST::~PICKED_ITEMS_LIST() {}

UNDO_REDO PICKED_ITEMS_LIST::GetPickedItemStatus( unsigned int aIdx ) const
{
    return UNDO_REDO::UNSPECIFIED;
}

EDA_ITEM* PICKED_ITEMS_LIST::GetPickedItem( unsigned int aIdx ) const
{
    return nullptr;
}

EDA_ITEM* PICKED_ITEMS_LIST::GetPickedItemLink( unsigned int aIdx ) const
{
    return nullptr;
}

// ── NGSPICE_SETTINGS constructor stub ────────────────────────────────────
#include <sim/spice_settings.h>

SPICE_SETTINGS::SPICE_SETTINGS( JSON_SETTINGS* aParent, const std::string& aPath )
    : NESTED_SETTINGS( "spice", 0, aParent, aPath ),
      m_fixIncludePaths( false ) {}

NGSPICE_SETTINGS::NGSPICE_SETTINGS( JSON_SETTINGS* aParent, const std::string& aPath )
    : SPICE_SETTINGS( aParent, aPath ),
      m_compatibilityMode( NGSPICE_COMPATIBILITY_MODE::NGSPICE ) {}

bool NGSPICE_SETTINGS::operator==( const SPICE_SETTINGS& ) const { return true; }

// ── SIM_MODEL stubs ──────────────────────────────────────────────────────
#include <sim/sim_model.h>

std::vector<std::reference_wrapper<const SIM_MODEL_PIN>> SIM_MODEL::GetPins() const
{
    return {};
}

#include <sim/sim_model_serializer.h>
SIM_MODEL::~SIM_MODEL() = default;

// ── SIM_MODEL_RAW_SPICE stub ─────────────────────────────────────────────
#include <sim/sim_model_raw_spice.h>

SIM_MODEL_RAW_SPICE::SIM_MODEL_RAW_SPICE( const std::string& )
    : SIM_MODEL( SIM_MODEL::TYPE::RAWSPICE ) {}

void SIM_MODEL_RAW_SPICE::AssignSymbolPinNumberToModelPin( const std::string&, const wxString& ) {}

// ── SPICE_VALUE stubs ────────────────────────────────────────────────────
#include <sim/spice_value.h>

void SPICE_VALUE::Normalize() {}

wxString SPICE_VALUE::ToString( const SPICE_VALUE_FORMAT& )
{
    return wxT( "0" );
}

// ── FIELD_VALIDATOR stubs ────────────────────────────────────────────────
#include <validators.h>

FIELD_VALIDATOR::FIELD_VALIDATOR( FIELD_T aFieldId, wxString* aValue )
    : wxTextValidator( 0, aValue ), m_fieldId( aFieldId ) {}

FIELD_VALIDATOR::FIELD_VALIDATOR( const FIELD_VALIDATOR& aValidator )
    : wxTextValidator( aValidator ), m_fieldId( aValidator.m_fieldId ) {}

bool FIELD_VALIDATOR::Validate( wxWindow* aParent ) { return true; }

bool FIELD_VALIDATOR::DoValidate( const wxString&, wxWindow* ) { return true; }

wxString GetFieldValidationErrorMessage( FIELD_T, const wxString& ) { return wxString(); }

// ── AutoplaceFields stubs ────────────────────────────────────────────────
#include <sch_symbol.h>
#include <lib_symbol.h>

void SCH_SYMBOL::AutoplaceFields( SCH_SCREEN*, AUTOPLACE_ALGO ) {}
void LIB_SYMBOL::AutoplaceFields( SCH_SCREEN*, AUTOPLACE_ALGO ) {}

// ── ToProtoEnum for SCH_LAYER_ID stub ────────────────────────────────────
#include <api/schematic/schematic_types.pb.h>

template<typename KiCadEnum, typename ProtoEnum>
ProtoEnum ToProtoEnum(KiCadEnum);

template<> kiapi::schematic::types::SchematicLayer
ToProtoEnum<SCH_LAYER_ID, kiapi::schematic::types::SchematicLayer>( SCH_LAYER_ID )
{
    return (kiapi::schematic::types::SchematicLayer)0;
}

// ── SYMBOL_EDITOR_SETTINGS typeinfo stub ─────────────────────────────────
// Define destructor out-of-line to force vtable/typeinfo emission
#include "symbol_editor_settings.h"

SYMBOL_EDITOR_SETTINGS::~SYMBOL_EDITOR_SETTINGS() = default;

// ── EDA_BASE_FRAME / KIWAY_PLAYER / EDA_DRAW_FRAME typeinfo stubs ────────
// These GUI frame classes are too heavy to compile for WASM.
// We provide destructor + key virtual method stubs to emit vtable/typeinfo.
#include <lockfile.h>  // Complete LOCKFILE definition needed by EDA_DRAW_FRAME destructor
#include <eda_draw_frame.h>

// TOOLS_HOLDER stubs - key function: RegisterUIUpdateHandler(TOOL_ACTION&,...)
TOOLS_HOLDER::TOOLS_HOLDER()
    : m_toolManager( nullptr ), m_actions( nullptr ), m_toolDispatcher( nullptr ),
      m_immediateActions( true ), m_dragAction( MOUSE_DRAG_ACTION::SELECT ),
      m_moveWarpsCursor( true ) {}

void TOOLS_HOLDER::RegisterUIUpdateHandler( const TOOL_ACTION&, const ACTION_CONDITIONS& ) {}
void TOOLS_HOLDER::UnregisterUIUpdateHandler( const TOOL_ACTION& ) {}
void TOOLS_HOLDER::PushTool( const TOOL_EVENT& ) {}
void TOOLS_HOLDER::PopTool( const TOOL_EVENT& ) {}
std::string TOOLS_HOLDER::CurrentToolName() const { return ""; }
bool TOOLS_HOLDER::IsCurrentTool( const TOOL_ACTION& ) const { return false; }
void TOOLS_HOLDER::ShowChangedLanguage() {}
void TOOLS_HOLDER::CommonSettingsChanged( int ) {}

// EDA_BASE_FRAME stubs - destructor is the key function
EDA_BASE_FRAME::EDA_BASE_FRAME( wxWindow* aParent, FRAME_T aFrameType,
                                 const wxString& aTitle, const wxPoint& aPos,
                                 const wxSize& aSize, long aStyle,
                                 const wxString& aFrameName, KIWAY* aKiway,
                                 const EDA_IU_SCALE& aIuScale )
    : wxFrame(), TOOLS_HOLDER(), KIWAY_HOLDER( aKiway, KIWAY_HOLDER::FRAME ),
      UNITS_PROVIDER( aIuScale, EDA_UNITS::MM ) {}

EDA_BASE_FRAME::~EDA_BASE_FRAME() {}

bool EDA_BASE_FRAME::ProcessEvent( wxEvent& ) { return false; }
void EDA_BASE_FRAME::OnCharHook( wxKeyEvent& ) {}
void EDA_BASE_FRAME::RegisterUIUpdateHandler( int, const ACTION_CONDITIONS& ) {}
void EDA_BASE_FRAME::UnregisterUIUpdateHandler( int ) {}
void EDA_BASE_FRAME::OnSize( wxSizeEvent& ) {}
void EDA_BASE_FRAME::ChangeUserUnits( EDA_UNITS ) {}
void EDA_BASE_FRAME::OnMenuEvent( wxMenuEvent& ) {}

// KIWAY_PLAYER stubs
KIWAY_PLAYER::KIWAY_PLAYER( KIWAY* aKiway, wxWindow* aParent, FRAME_T aFrameType,
                             const wxString& aTitle, const wxPoint& aPos,
                             const wxSize& aSize, long aStyle,
                             const wxString& aFrameName, const EDA_IU_SCALE& aIuScale )
    : EDA_BASE_FRAME( aParent, aFrameType, aTitle, aPos, aSize, aStyle,
                       aFrameName, aKiway, aIuScale ) {}

KIWAY_PLAYER::~KIWAY_PLAYER() throw() {}

bool KIWAY_PLAYER::ShowModal( wxString*, wxWindow* ) { return false; }
void KIWAY_PLAYER::KiwayMailIn( KIWAY_MAIL_EVENT& ) {}
bool KIWAY_PLAYER::Destroy() { return false; }
bool KIWAY_PLAYER::IsDismissed() { return true; }
void KIWAY_PLAYER::DismissModal( bool, const wxString& ) {}
void KIWAY_PLAYER::CreateServer( int, bool ) {}
void KIWAY_PLAYER::OnSockRequest( wxSocketEvent& ) {}
void KIWAY_PLAYER::OnSockRequestServer( wxSocketEvent& ) {}

// EDA_DRAW_FRAME stubs
EDA_DRAW_FRAME::EDA_DRAW_FRAME( KIWAY* aKiway, wxWindow* aParent, FRAME_T aFrameType,
                                 const wxString& aTitle, const wxPoint& aPos,
                                 const wxSize& aSize, long aStyle,
                                 const wxString& aFrameName, const EDA_IU_SCALE& aIuScale )
    : KIWAY_PLAYER( aKiway, aParent, aFrameType, aTitle, aPos, aSize, aStyle,
                     aFrameName, aIuScale ) {}

EDA_DRAW_FRAME::~EDA_DRAW_FRAME() {}

std::unique_ptr<GRID_HELPER> EDA_DRAW_FRAME::MakeGridHelper() { return nullptr; }
void EDA_DRAW_FRAME::OnSize( wxSizeEvent& ) {}
COLOR_SETTINGS* EDA_DRAW_FRAME::GetColorSettings( bool ) const { return nullptr; }
wxString EDA_DRAW_FRAME::GetScreenDesc() const { return wxT(""); }
wxString EDA_DRAW_FRAME::GetFullScreenDesc() const { return wxT(""); }
void EDA_DRAW_FRAME::SetGridVisibility( bool ) {}
void EDA_DRAW_FRAME::SetGridOverrides( bool ) {}
void EDA_DRAW_FRAME::OnSelectZoom( wxCommandEvent& ) {}
void EDA_DRAW_FRAME::HardRedraw() {}
void EDA_DRAW_FRAME::Zoom_Automatique( bool ) {}
void EDA_DRAW_FRAME::DisplayGridMsg() {}
