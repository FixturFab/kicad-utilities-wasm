# KiCad ERC (Electrical Rules Check) WebAssembly - Product Requirements Document

## Overview

**Project Goal**: Extend the kicad-cli-wasm project to support ERC (Electrical Rules Check) for schematic validation in browsers and Node.js.

**Relationship to DRC**: ERC will be added to the same WASM module as DRC, sharing the substantial common infrastructure already developed.

**Target Environments**: Browser and Node.js (same as DRC)

---

## Feasibility Research Summary

### ERC Source Location

ERC is implemented in KiCad's `eeschema/` directory:

| Location | Purpose |
|----------|---------|
| `eeschema/erc/erc.cpp/h` | Main ERC_TESTER class with 19 test methods |
| `eeschema/erc/erc_settings.cpp/h` | ERC configuration and rule settings |
| `eeschema/erc/erc_item.cpp/h` | ERC violation item definitions |
| `eeschema/erc/erc_sch_pin_context.cpp/h` | Pin context for ERC checks |
| `eeschema/connection_graph.cpp/h` | Connectivity graph (critical for ERC) |
| `eeschema/schematic.cpp/h` | SCHEMATIC class (equivalent to BOARD for PCB) |
| `eeschema/sch_io/kicad_sexpr/` | S-expression parser for .kicad_sch files |

### ERC vs DRC Architecture Comparison

| Aspect | DRC (PCB) | ERC (Schematic) |
|--------|-----------|-----------------|
| **Main class** | DRC_ENGINE | ERC_TESTER |
| **Data model** | BOARD | SCHEMATIC |
| **Connectivity** | CONNECTIVITY_DATA | CONNECTION_GRAPH |
| **Test structure** | 27 separate test provider classes | 19 methods in ERC_TESTER |
| **File parser** | PCB_IO_KICAD_SEXPR_PARSER | SCH_IO_KICAD_SEXPR_PARSER |
| **File format** | .kicad_pcb | .kicad_sch |
| **Item types** | FOOTPRINT, PAD, PCB_TRACK, ZONE... | SCH_SYMBOL, SCH_PIN, SCH_SHEET, SCH_WIRE... |

### Shared Infrastructure (Already Built for DRC)

The following components from the DRC WASM build can be fully reused:

1. **wxString stubs** (`stubs/wx/`) - Extensive wxString compatibility layer
2. **Platform stubs** (`kiplatform_wasm.cpp`, `pgm_base_wasm.cpp`)
3. **Core libraries** - core, kimath, sexpr, fmt_lib, clipper2, delaunator
4. **kicommon_wasm** - ~140 source files of common infrastructure
5. **gal_wasm** - GAL subset (fonts, painters, views)
6. **Reporter infrastructure** - REPORTER, PROGRESS_REPORTER stubs
7. **Job system** - JOB_RC base class
8. **S-expression parser base** - DSNLEXER, richio

### ERC-Specific Modules Required

New modules that need to be compiled for ERC:

```
eeschema/
├── erc/
│   ├── erc.cpp/h                    # Main ERC_TESTER class
│   ├── erc_settings.cpp/h           # ERC configuration
│   ├── erc_item.cpp/h               # Violation items
│   └── erc_sch_pin_context.cpp/h    # Pin context
├── connection_graph.cpp/h           # Connectivity graph
├── schematic.cpp/h                  # SCHEMATIC class
├── sch_symbol.cpp/h                 # Symbol instances
├── sch_pin.cpp/h                    # Pin objects
├── sch_sheet.cpp/h                  # Hierarchical sheets
├── sch_sheet_pin.cpp/h              # Sheet pins
├── sch_wire.cpp/h                   # Wires
├── sch_bus_entry.cpp/h              # Bus entries
├── sch_junction.cpp/h               # Junctions
├── sch_no_connect.cpp/h             # No-connect markers
├── sch_label.cpp/h                  # Labels (local, global, hier)
├── sch_field.cpp/h                  # Symbol fields
├── sch_screen.cpp/h                 # Screen management
├── sch_item.cpp/h                   # Base item class
├── sch_connection.cpp/h             # Connection representation
├── sch_io/
│   ├── sch_io.cpp/h                 # I/O plugin base
│   ├── sch_io_mgr.cpp/h             # I/O manager
│   └── kicad_sexpr/
│       ├── sch_io_kicad_sexpr.cpp/h
│       └── sch_io_kicad_sexpr_parser.cpp/h
└── lib_symbol.cpp/h                 # Library symbol definitions
```

**Estimated file count**: ~40-50 additional source files

---

## Open Questions Resolved

### Architecture

**Q1: Should ERC be a separate WASM module or combined with DRC?**

**A: Combined module.** Rationale:
- ~70% shared infrastructure (kicommon_wasm, stubs, core libs)
- Same build system and toolchain
- Unified API for Studio integration
- Smaller total download size than two separate modules
- Users validating designs typically need both DRC and ERC

**Q2: What KiCad source modules are required for ERC vs DRC?**

**A: See table above.** Key difference is:
- DRC: pcbnew/ (BOARD, PCB_*, FOOTPRINT, CONNECTIVITY_DATA)
- ERC: eeschema/ (SCHEMATIC, SCH_*, LIB_SYMBOL, CONNECTION_GRAPH)

Both share: common/, libs/core/, libs/kimath/, libs/sexpr/

**Q3: Can we build a minimal "validation-only" subset of KiCad?**

**A: Yes, same approach as DRC.** Exclude:
- GUI components (editors, dialogs, tools)
- Netlist export (separate feature)
- Simulation integration (ngspice)
- BOM generation
- PDF/plot export
- Symbol library editor functionality

**Q4: What's the memory footprint difference between ERC-only vs full CLI?**

**A: Estimated ERC addition**: +2-4MB WASM binary, +5-10MB runtime memory
- ERC is simpler than DRC (no polygon operations, no zone fills)
- Schematic data structures are lighter than PCB (no copper pours)
- CONNECTION_GRAPH is the main memory consumer

### Dependencies

**Q1: Does ERC require symbol library loading? How to handle?**

**A: Partial.**
- Basic ERC (connectivity, pin conflicts): No library needed
- "Library symbol differs from schematic" check: Needs library access
- **Strategy**: Make library checks optional, skip in WASM by default
- Symbols embedded in .kicad_sch files are sufficient for most checks

**Q2: Does ERC need the schematic's linked footprints/PCB?**

**A: No.**
- ERC is schematic-only
- Footprint assignment checking is optional and can be disabled
- PCB cross-reference (annotation) is not part of ERC

**Q3: What file formats does ERC need to parse beyond .kicad_sch?**

**A: Minimal additional formats:**
- `.kicad_sym` - Symbol library files (optional, for library validation)
- Hierarchical schematics reference other .kicad_sch files (handled recursively)
- No other formats required for basic ERC

**Q4: Are there runtime data files (e.g., rule definitions) needed?**

**A: No.**
- ERC rules are embedded in the schematic's project settings
- Default rules are compiled into the code
- No external configuration files required

### API Design

**Q1: What should the JavaScript/TypeScript API look like?**

**A: Extend existing DRC API pattern:**
```typescript
// Existing DRC API
interface KicadWasm {
  // DRC (existing)
  loadPcb(content: string): boolean;
  runDrc(): DrcResult;

  // ERC (new)
  loadSchematic(content: string): boolean;
  loadSchematicSheet(path: string, content: string): boolean; // For hierarchical
  runErc(): ErcResult;
  getErcResults(): string; // JSON
  cleanupSchematic(): void;
}

interface ErcResult {
  violations: ErcViolation[];
  summary: {
    errors: number;
    warnings: number;
    exclusions: number;
  };
}

interface ErcViolation {
  type: string;           // e.g., "ERCE_PIN_NOT_CONNECTED"
  severity: "error" | "warning";
  message: string;
  sheet: string;          // Sheet path
  items: {
    reference?: string;   // e.g., "U1"
    pin?: string;         // e.g., "VCC"
    position: { x: number; y: number };
  }[];
}
```

**Q2: How to handle file system access in WASM (virtual FS)?**

**A: Same as DRC - use STRING_LINE_READER:**
- Pass schematic content as string to API
- For hierarchical schematics, caller provides all sheet contents
- No actual filesystem access needed

**Q3: Should we support streaming results or batch-only?**

**A: Batch-only initially.**
- ERC is fast enough for batch processing
- Streaming adds complexity without clear benefit
- Can add streaming later if needed for very large schematics

**Q4: How to report progress for long-running checks?**

**A: Optional progress callback:**
```typescript
runErc(options?: {
  onProgress?: (percent: number, message: string) => void;
}): ErcResult;
```

### Integration

**Q1: How will kicanvas display ERC errors as overlays?**

**A: Kicanvas integration via error coordinates:**
- ERC results include sheet path and (x, y) positions
- Kicanvas can render markers at those positions
- Error items include reference designators for symbol highlighting

**Q2: How will the wizard present ERC results to users?**

**A: Grouped by severity and type:**
- Errors first, then warnings
- Grouped by error type (all "unconnected pins" together)
- Click-to-navigate in kicanvas viewer

**Q3: Should ERC results be cached/persisted?**

**A: Application decision, not WASM module concern.**
- WASM module is stateless between runs
- Caller can cache results if desired

**Q4: How to handle ERC on hierarchical schematics (multiple sheets)?**

**A: API supports loading multiple sheets:**
```typescript
// Load root schematic
loadSchematic(rootContent);

// Load child sheets by path
loadSchematicSheet("subsheet.kicad_sch", subsheetContent);
loadSchematicSheet("power/power.kicad_sch", powerContent);

// Run ERC on full hierarchy
runErc();
```

---

## Technical Approach

### Phase Strategy

**Prerequisite**: DRC WASM must be complete and stable (Stage 5g verified) before starting ERC work.

ERC will be added incrementally to the existing kicad-cli-wasm project, following the same methodology that worked for DRC.

---

## Phases

### Phase 1: Native ERC Validation

**Goal**: Verify ERC works with the existing kicad-cli native build before attempting WASM.

**Tasks**:
- [x] Verify `kicad-cli sch erc` works on sample schematics
- [x] Document ERC JSON output format
- [x] Create sample .kicad_sch test files (simple, hierarchical, with errors)
- [x] Identify all ERC error types in output

**Success Criteria**:
- [x] ERC JSON output parsed and understood
- [x] Test schematics with known violations produce expected errors
- [x] Hierarchical schematic ERC works

---

### Phase 2: Schematic Parser WASM Compilation

**Goal**: Get the schematic parser compiling for WASM.

**Tasks**:
- [ ] Add `eeschema/sch_io/kicad_sexpr/` files to CMakeLists.txt
- [ ] Add generated `sch_keywords.cpp` from KiCad build
- [ ] Add schematic item classes (sch_symbol, sch_pin, sch_sheet, etc.)
- [ ] Fix compilation errors (likely need additional wx stubs)
- [ ] Create `sch_io_mgr_wasm.cpp` (equivalent to `pcb_io_mgr_wasm.cpp`)

**Success Criteria**:
- [ ] Schematic parser library compiles for WASM
- [ ] Can load .kicad_sch content into SCHEMATIC object

---

### Phase 3: CONNECTION_GRAPH WASM Compilation

**Goal**: Get the connectivity graph compiling, which is critical for ERC.

**Tasks**:
- [ ] Add `eeschema/connection_graph.cpp` to CMakeLists.txt
- [ ] Add `eeschema/sch_connection.cpp`
- [ ] Fix compilation errors (wx dependencies, threading)
- [ ] Verify CONNECTION_GRAPH builds connectivity from parsed schematic

**Success Criteria**:
- [ ] CONNECTION_GRAPH compiles for WASM
- [ ] Connectivity data generated from loaded schematic

---

### Phase 4: ERC Engine WASM Compilation

**Goal**: Get the ERC engine compiling and running basic checks.

**Tasks**:
- [ ] Add `eeschema/erc/*.cpp` files to CMakeLists.txt
- [ ] Add `jobs/job_sch_erc.cpp` to kicommon_wasm
- [ ] Create ERC API functions in `src/api.cpp`:
  - `kicad_load_schematic()`
  - `kicad_run_erc()`
  - `kicad_get_erc_results()`
  - `kicad_cleanup_schematic()`
- [ ] Implement ERC JSON report generation

**Success Criteria**:
- [ ] ERC engine compiles for WASM
- [ ] Basic connectivity checks run (unconnected pins, conflicts)

---

### Phase 5: Hierarchical Schematic Support

**Goal**: Support multi-sheet schematics.

**Tasks**:
- [ ] Implement `kicad_load_schematic_sheet()` API for child sheets
- [ ] Verify SCH_SHEET_LIST builds correctly from loaded sheets
- [ ] Test hierarchical pin/label connectivity
- [ ] Verify ERC runs across sheet boundaries

**Success Criteria**:
- [ ] Hierarchical schematics load correctly
- [ ] ERC detects cross-sheet connectivity issues

---

### Phase 6: Testing and Integration

**Goal**: Verify WASM ERC matches native kicad-cli output.

**Tasks**:
- [ ] Create Node.js test suite comparing WASM vs native results
- [ ] Test with spork-generated schematics
- [ ] Document any limitations vs native ERC
- [ ] Create TypeScript type definitions
- [ ] Update package.json with ERC exports

**Success Criteria**:
- [ ] WASM ERC results match native for all test cases
- [ ] Performance acceptable (<2s for typical schematics)
- [ ] Works with spork output

---

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| CONNECTION_GRAPH complexity | HIGH | It's the largest ERC component; may need significant stubbing |
| Symbol library dependency for some checks | MEDIUM | Make library checks optional; document limitations |
| Hierarchical schematic complexity | MEDIUM | Start with flat schematics; add hierarchy incrementally |
| wx dependencies in eeschema differ from pcbnew | MEDIUM | Reuse DRC stubs; add new stubs as needed |
| WASM binary size increase | LOW | ERC is lighter than DRC; acceptable tradeoff |

---

## Out of Scope

- **Full schematic editor** - Just validation
- **Real-time ERC** - Batch check only
- **Custom ERC rules** - Use KiCad defaults
- **Schematic netlist export** - Separate feature
- **SPICE model validation** - Requires ngspice integration
- **BOM generation** - Not ERC-related
- **Annotation** - Not ERC-related
- **Symbol library editing** - Not needed for validation

---

## Estimated File Counts

Based on DRC experience and eeschema structure:

| Component | Estimated Files | Notes |
|-----------|----------------|-------|
| ERC core (erc/*.cpp) | 4 | Smaller than DRC |
| Schematic data model (sch_*.cpp) | 25 | Similar to pcb_*.cpp |
| Schematic parser | 5 | Similar to PCB parser |
| Connection graph | 3 | Critical component |
| Jobs/settings | 5 | Extend existing |
| **Total new files** | ~42 | Smaller than DRC (~117) |

---

## API Reference

### C API (WASM exports)

```c
// Load a KiCad schematic file from memory
int kicad_load_schematic(const char* sch_content, size_t length);

// Load an additional schematic sheet (for hierarchical designs)
int kicad_load_schematic_sheet(const char* sheet_path, const char* content, size_t length);

// Run ERC checks on loaded schematic
int kicad_run_erc(void);

// Get ERC results as JSON string
const char* kicad_get_erc_results(void);

// Free schematic resources
void kicad_cleanup_schematic(void);
```

### JSON Output Format

```json
{
  "source": "kicad-wasm",
  "date": "2024-02-20T...",
  "kicad_version": "9.99.0",
  "violations": [
    {
      "type": "ERCE_PIN_NOT_CONNECTED",
      "severity": "error",
      "description": "Pin not connected",
      "sheet_path": "/",
      "items": [
        {
          "description": "Pin 1 (input) of U1",
          "pos": {"x": 100.0, "y": 50.0}
        }
      ]
    }
  ],
  "summary": {
    "errors": 3,
    "warnings": 5,
    "exclusions": 0
  }
}
```

---

## Resources

- KiCad ERC CLI: `kicad-cli sch erc --help`
- [KiCad Schematic File Format](https://dev-docs.kicad.org/en/file-formats/sexpr-schematic/)
- [KiCad GitLab - eeschema](https://gitlab.com/kicad/code/kicad/-/tree/master/eeschema)
- [KiCad ERC Settings](https://gitlab.com/kicad/code/kicad/-/blob/master/eeschema/erc/erc_settings.cpp)
- Existing DRC WASM implementation in this repo

---

## Checkpoints

After each phase:

- [x] **Phase 1**: Native ERC verified, test files created
- [ ] **Phase 2**: Schematic parser compiles for WASM
- [ ] **Phase 3**: CONNECTION_GRAPH compiles for WASM
- [ ] **Phase 4**: ERC engine runs basic checks in WASM
- [ ] **Phase 5**: Hierarchical schematics work
- [ ] **Phase 6**: WASM output matches native, integration complete

---

## Prerequisites

**Before starting ERC implementation:**

1. DRC WASM must pass Stage 5g (Node.js testing complete)
2. DRC WASM build system stable and documented
3. Sample .kicad_sch test files prepared
4. Native kicad-cli ERC output format documented
