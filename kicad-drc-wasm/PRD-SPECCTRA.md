# PRD: Specctra DSN/SES WASM Support

Add Specctra DSN export and SES import to kicad-cli-wasm, enabling browser/Node.js autorouting workflows.

## Phase 1: Compilation — Add Specctra to WASM Build

**Goal**: Get specctra source files compiling in the WASM build.

**Work**:
- Create stub headers: `pcb_edit_frame.h`, `confirm.h`, `gestfich.h`
- Add 4 specctra source files to `pcbcommon_wasm` in CMakeLists.txt
- Add include path for generated `specctra_lexer.h`
- Add Boost include path for `ptr_container`
- Fix compile errors

**Success**: `emmake make` completes without errors

## Phase 2: Linking — Resolve Undefined Symbols

**Goal**: WASM binary links successfully with specctra code included.

**Work**:
- Add linker stubs for missing symbols
- Add C API: `kicad_export_dsn()`, `kicad_import_ses()`, `kicad_save_pcb()`
- Add to `EXPORTED_FUNCTIONS` in CMakeLists.txt

**Success**: WASM binary builds, `diag_ping()` still works

## Phase 3: DSN Export — Functional Testing

**Goal**: `kicad_export_dsn()` produces valid Specctra DSN output.

**Work**:
- Create `test/test-specctra.mjs`
- Load sample PCB, export DSN, verify output
- Fix runtime issues

**Success**: DSN export produces parseable Specctra format

## Phase 4: SES Import & PCB Save — Full Workflow

**Goal**: Complete autorouting round-trip works.

**Work**:
- Test `kicad_import_ses()` with minimal SES file
- Test `kicad_save_pcb()` to serialize modified board
- Update TypeScript types and package.json exports

**Success**: Load PCB → Export DSN → Import SES → Save PCB round-trip succeeds

## Key Technical Details

**Free functions** (no GUI dependency):
- `DSN::ExportBoardToSpecctraFile(BOARD*, wxString&)` — specctra_export.cpp:112
- `DSN::ImportSpecctraSession(BOARD*, wxString&)` — specctra_import.cpp:566

**New C API**:
- `const char* kicad_export_dsn(void)` — returns DSN string
- `int kicad_import_ses(const char* content, size_t length)` — imports SES routes
- `const char* kicad_save_pcb(void)` — returns .kicad_pcb string
