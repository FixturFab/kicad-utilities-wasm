# KiCad Native STEP Export via WASM - Product Requirements Document

## Overview

**Project Goal**: Compile KiCad's native STEP exporter (`exporter_step.cpp` + `step_pcb_model.cpp`) to WASM as a monolith alongside OCCT 7.6.3, achieving exact parity with `kicad-cli pcb export step`.

**Why**: The previous approach (JS reimplementation via `opencascade.js`) cannot achieve parity:
- opencascade.js ships OCCT 7.4.0p1, but KiCad 8.0.9 requires OCCT 7.5.0+ (hard-enforced)
- API breaks between 7.4 and 7.6: `Message_Printer` signatures, color spaces, `BRepTools::Write()`
- JS reimplementation introduces subtle geometry bugs that are hard to detect and fix
- Boolean operations fail silently in browser due to broken C++ exception handling
- Output is 2.5-4.2x larger than native due to missing XCAFDoc assembly hierarchy

**Architecture**: Single WASM binary containing KiCad's PCB engine + OCCT 7.6.3 + KiCad's native STEP exporter. The BOARD is already loaded in memory (for DRC/ERC). We add `_kicad_export_step()` that calls `EXPORTER_STEP::Export()` directly.

```
KiCad WASM (existing: DRC + ERC + geometry)
    + OCCT 7.6.3 (compiled from source via Emscripten)
    + KiCad STEP exporter (exporter_step.cpp, step_pcb_model.cpp)
    = Single WASM binary with exact native parity
```

**Target Environments**: Node.js and Browser (same as DRC/ERC)

---

## Reference Code

| Source File | Purpose |
|-------------|---------|
| `kicad-src/pcbnew/exporters/step/exporter_step.cpp` | Main export logic (1,391 lines) |
| `kicad-src/pcbnew/exporters/step/step_pcb_model.cpp` | 3D model construction via OCCT (4,302 lines) |
| `kicad-src/pcbnew/exporters/step/exporter_step.h` | EXPORTER_STEP class + EXPORTER_STEP_PARAMS |
| `kicad-src/pcbnew/exporters/step/step_pcb_model.h` | STEP_PCB_MODEL class (401 lines) |
| `kicad-src/pcbnew/exporters/step/KI_XCAFDoc_AssemblyGraph.cxx` | Custom OCCT assembly graph (270 lines) |
| `kicad-src/pcbnew/exporters/step/KI_XCAFDoc_AssemblyGraph.hxx` | Assembly graph header (220 lines) |
| `kicad-src/pcbnew/exporters/step/kicad3d_info.cpp` | 3D model info struct (90 lines) |
| `kicad-src/common/jobs/job_export_pcb_3d.h` | EXPORTER_STEP_PARAMS class definition |
| `kicad-drc-wasm/src/api.cpp` | Existing WASM API (integration point) |
| `kicad-drc-wasm/CMakeLists.txt` | Existing WASM build configuration |

**OCCT on system**: v7.6.3, headers at `/usr/include/opencascade/` (7,543 headers), 50 libraries at `/usr/lib/x86_64-linux-gnu/libTK*.so`, CMake config at `/usr/lib/x86_64-linux-gnu/cmake/opencascade/`.

**OCCT version-conditional code in exporter** (11 occurrences):
- `OCC_VERSION_HEX < 0x070500`: Message_Printer old API (we use 7.6.3, takes new path)
- `OCC_VERSION_HEX >= 0x070600`: BRepTools::Write extended signature (we take this path)
- `OCC_VERSION_HEX >= 0x070700`: VrmlAPI_CafReader, RWPly_CafWriter (we skip, 7.6 < 7.7)
- `OCC_VERSION_HEX > 0x070101`: UpdateAssemblies (we take this path)

---

## Stage 1: Download and Configure OCCT 7.6.3 Source for Emscripten

**Goal**: Get OCCT 7.6.3 source tree, configure a minimal Emscripten build with only the modules needed for STEP export.

- [x] 1a: Download OCCT 7.6.3 source release to `kicad-drc-wasm/thirdparty/occt-7.6.3/`
- [x] 1b: Identify the minimal set of OCCT modules needed. Based on KiCad's `FindOCC.cmake` and the exporter's `#include` directives, we need these OCCT toolkits:
  - **Foundation**: TKernel, TKMath
  - **Modeling Data**: TKG2d, TKG3d, TKGeomBase, TKBRep
  - **Modeling Algorithms**: TKGeomAlgo, TKTopAlgo, TKShHealing, TKBool, TKBO, TKPrim, TKFillet, TKOffset, TKFeat, TKHLR
  - **Data Exchange**: TKSTEP, TKSTEPBase, TKSTEPAttr, TKSTEP209, TKXSBase, TKIGES, TKXDESTEP, TKXDEIGES, TKRWMesh, TKMesh, TKSTL, TKVRML
  - **Application Framework**: TKCAF, TKCDF, TKLCAF, TKXCAF, TKBinXCAF, TKBin, TKBinL, TKBinTObj, TKTObj, TKService, TKV3d, TKXMesh
  - Exclude visualization (TKOpenGl, TKMeshVS), XML persistence (TKXml*), Draw harness
- [x] 1c: Create `kicad-drc-wasm/thirdparty/occt-emscripten.cmake` that:
  - Sets OCCT source root
  - Defines `BUILD_MODULE_*` variables to enable/disable modules
  - Sets Emscripten-specific compile flags (`-O3 -flto -fexceptions -pthread`)
  - Disables platform-specific code (X11, OpenGL, Tcl/Tk)
  - Stubs out `OSD_Path`, `OSD_Process` platform calls (reference: opencascade.js patches)
- [x] 1d: Test that OCCT headers are parseable by Emscripten compiler with a minimal test:
  ```cpp
  #include <Standard_Version.hxx>
  #include <gp_Pnt.hxx>
  #include <BRepPrimAPI_MakeCylinder.hxx>
  int main() { return OCC_VERSION_MAJOR; }
  ```

**Verification**: `emcc` compiles the test file without errors against OCCT 7.6.3 headers.

---

## Stage 2: Compile OCCT Core Modules to WASM Static Libraries

**Goal**: Compile the OCCT foundation and modeling modules as static libraries via Emscripten.

- [x] 2a: Add OCCT source compilation to CMakeLists.txt. Start with just TKernel + TKMath. These are the base modules with the most platform-specific code (threading, file I/O, memory management). Getting these to compile first validates our platform stubs.
- [x] 2b: Create `kicad-drc-wasm/stubs/occt/` directory with platform stubs for Emscripten:
  - NOT NEEDED: OCCT 7.6.3 has native `__EMSCRIPTEN__` support in OSD, Standard, etc.
  - Only fix required: `-U__linux__` in OCCT compile options to prevent conflict with global KiCad define
- [ ] 2c: Compile TKG2d, TKG3d, TKGeomBase, TKBRep (modeling data modules)
- [ ] 2d: Compile TKGeomAlgo, TKTopAlgo, TKShHealing (modeling algorithm modules)
- [ ] 2e: Compile TKBool, TKBO, TKPrim, TKFillet (boolean operations + primitives)
- [ ] 2f: Validate with a test that creates a cylinder and performs a boolean cut:
  ```cpp
  #include <BRepPrimAPI_MakeCylinder.hxx>
  #include <BRepPrimAPI_MakeBox.hxx>
  #include <BRepAlgoAPI_Cut.hxx>
  // Create box, cut hole, verify shape is valid
  ```

**Verification**: Emscripten produces `.a` static libraries for each toolkit. Test program links and runs under Node.js.

---

## Stage 3: Compile OCCT STEP I/O and Application Framework Modules

**Goal**: Compile the STEP reader/writer and XDE assembly framework modules.

- [ ] 3a: Compile TKXSBase, TKSTEP, TKSTEPBase, TKSTEPAttr, TKSTEP209 (STEP I/O core)
- [ ] 3b: Compile TKCDF, TKLCAF, TKCAF, TKTObj (application framework)
- [ ] 3c: Compile TKXCAF, TKXDESTEP (XDE STEP, assembly support with colors/materials)
- [ ] 3d: Compile remaining needed modules: TKIGES, TKXDEIGES, TKBin, TKBinL, TKBinTObj, TKBinXCAF, TKService, TKV3d, TKRWMesh, TKMesh, TKSTL, TKVRML, TKXMesh, TKOffset, TKFeat, TKHLR
- [ ] 3e: Validate with a test that writes a STEP file:
  ```cpp
  #include <STEPCAFControl_Writer.hxx>
  #include <BRepPrimAPI_MakeBox.hxx>
  #include <XCAFApp_Application.hxx>
  // Create document, add shape, write STEP to virtual FS, read back and verify ISO-10303 header
  ```

**Verification**: STEP write test produces valid STEP file bytes in Emscripten virtual FS. File starts with `ISO-10303-21`.

---

## Stage 4: Integrate KiCad's STEP Exporter Source Files

**Goal**: Compile KiCad's native STEP exporter files and link them with the OCCT WASM libraries.

- [ ] 4a: Add OCCT include directory to `KICAD_INCLUDE_DIRS` in CMakeLists.txt (WASM section)
- [ ] 4b: Add KiCad STEP exporter source files to the WASM build:
  ```cmake
  set(STEP_EXPORTER_SOURCES
      ${KICAD_SRC}/pcbnew/exporters/step/exporter_step.cpp
      ${KICAD_SRC}/pcbnew/exporters/step/step_pcb_model.cpp
      ${KICAD_SRC}/pcbnew/exporters/step/kicad3d_info.cpp
      ${KICAD_SRC}/pcbnew/exporters/step/KI_XCAFDoc_AssemblyGraph.cxx
  )
  ```
- [ ] 4c: Handle additional KiCad dependencies the exporter needs that may not be compiled yet:
  - `filename_resolver.cpp` — 3D model file path resolution
  - `convert_basic_shapes_to_polygon.cpp` — geometry conversion
  - `streamwrapper.cpp` — OCCT stream wrapper (at `kicad-src/common/streamwrapper.cpp`)
  - `exporters/u3d/writer.cpp` — U3D writer (may need stub if only STEP is needed)
  - `pcb_painter.cpp` — color extraction (may need stub)
  - Any other missing symbols found during linking
- [ ] 4d: Add stubs for features we don't need in WASM:
  - `footprint_library_adapter` — GUI library browser (stub or exclude)
  - `pcb_barcode` — barcode generation (may need minimal stub)
  - U3D, PDF, PLY format writers — stub with "not supported in WASM" returns
  - `plotters/plotters_pslike` — plotting (stub)
- [ ] 4e: Compile and fix all remaining link errors. The exporter uses these KiCad classes that should already be compiled in pcbcommon_wasm: BOARD, FOOTPRINT, PAD, PCB_TRACK, ZONE, SHAPE_POLY_SET, BOARD_STACKUP, PCB_SHAPE, PCB_TEXTBOX, PCB_TABLE.
- [ ] 4f: Link OCCT static libraries into the final WASM target:
  ```cmake
  target_link_libraries(kicad_drc PRIVATE
      # ... existing libraries ...
      # OCCT static libraries
      TKernel TKMath TKG2d TKG3d TKGeomBase TKBRep
      TKGeomAlgo TKTopAlgo TKShHealing TKBool TKBO TKPrim TKFillet
      TKSTEP TKSTEPBase TKSTEPAttr TKSTEP209 TKXSBase
      TKCDF TKLCAF TKCAF TKTObj TKXCAF TKXDESTEP
      TKBinXCAF TKBin TKBinL TKBinTObj TKService TKV3d
      TKRWMesh TKMesh TKSTL TKVRML TKXMesh
      TKIGES TKXDEIGES TKOffset TKFeat TKHLR
  )
  ```

**Verification**: WASM binary compiles and links without errors. Binary size noted. Existing DRC/ERC tests still pass.

---

## Stage 5: Add `_kicad_export_step()` API Function

**Goal**: Expose the STEP export as a C API function in the WASM module, reusing the already-loaded BOARD.

- [ ] 5a: Add the export function to `api.cpp`:
  ```cpp
  #include <exporters/step/exporter_step.h>

  extern "C" {

  const char* kicad_export_step(const char* options_json)
  {
      if (!g_board)
          return nullptr;

      // Parse options from JSON (output format, origin, component filtering, etc.)
      EXPORTER_STEP_PARAMS params;
      params.m_Format = EXPORTER_STEP_PARAMS::FORMAT::STEP;
      params.m_ExportBoardBody = true;
      params.m_ExportComponents = true;
      // ... parse remaining options from JSON ...

      // Write to virtual FS path
      wxString outputPath = wxS("/tmp/kicad_wasm_step/output.step");
      params.m_OutputFile = outputPath;

      // Create reporter, run export
      EXPORTER_STEP exporter(g_board, params, /* reporter */);
      exporter.m_outputFile = outputPath;
      bool ok = exporter.Export();

      // Read STEP file from virtual FS, return as string
  }

  } // extern "C"
  ```
- [ ] 5b: Add `_kicad_export_step` to EXPORTED_FUNCTIONS in CMakeLists.txt link flags
- [ ] 5c: Add options parsing: accept JSON with fields for export parameters (format, origin, components, tracks, silkscreen, soldermask, etc.) mapping to EXPORTER_STEP_PARAMS fields
- [ ] 5d: Handle the STEP file output:
  - Option A: Return the STEP file content as a string (simple, works for STEP text format)
  - Option B: Write to Emscripten virtual FS and return the path (supports binary formats like GLB)
  - Implement both: string return for STEP, FS path for binary formats
- [ ] 5e: Handle 3D model resolution. The exporter calls `FILENAME_RESOLVER` to find `.step`/`.wrl` model files. For WASM:
  - Accept a model map via the options JSON: `{ "models": { "path/to/model.step": <FS path> } }`
  - Write models to virtual FS before export
  - Or: export with `m_BoardOnly = true` initially (no component models), add model support later
- [ ] 5f: Add TypeScript type declarations to `types/kicad-wasm.d.ts`

**Verification**: `_kicad_export_step` is callable from Node.js. Returns a STEP file string for a loaded PCB.

---

## Stage 6: Parity Testing — Comparison with Native kicad-cli

**Goal**: Verify the WASM STEP output matches native `kicad-cli pcb export step` output.

- [ ] 6a: Create `test/test-step-native-parity.mjs` that:
  1. Loads a test PCB via WASM (`_kicad_load_pcb`)
  2. Exports STEP via WASM (`_kicad_export_step`)
  3. Exports STEP via native `kicad-cli pcb export step` (subprocess)
  4. Compares outputs
- [ ] 6b: Comparison levels (from strictest to most lenient):
  - **Level 1**: Byte-for-byte identical (after normalizing timestamps/file paths)
  - **Level 2**: Same STEP entities (parse both, compare entity counts and types)
  - **Level 3**: Same geometry (tessellate both, compare vertex positions within tolerance)
  - **Level 4**: Same bounding box and volume (coarsest check)
  - Start with Level 2+3, aspire to Level 1
- [ ] 6c: Create STEP comparison utility functions:
  - `normalizeStepFile(content)` — strip timestamps, file paths, whitespace normalization
  - `parseStepEntities(content)` — extract entity type counts
  - `compareStepFiles(wasm, native)` — multi-level comparison returning detailed diff
- [ ] 6d: Test with multiple PCB files:
  - `samples/parity-test.kicad_pcb` (existing: 50x35mm, PTH, NPTH, vias, SMD, slot)
  - `public/sample.kicad_pcb` (existing: the demo PCB)
  - Create a complex test PCB with: zones, arcs, multiple board outlines, many footprints
- [ ] 6e: Add to CI: `npm run test:step-native-parity`

**Verification**: WASM and native STEP outputs match at Level 2 (same entities) and Level 3 (same geometry within 0.001mm tolerance). Differences documented if any.

---

## Stage 7: Browser Integration and Demo Page Update

**Goal**: Update the browser demo page to use the native STEP export instead of the JS reimplementation.

- [ ] 7a: Update `public/step.html` to call `_kicad_export_step()` instead of the JS StepBuilder
  - Remove the entire inline StepBuilder class
  - Remove the opencascade.js dependency (no more 63MB WASM download)
  - The STEP export now happens inside the existing KiCad WASM module
- [ ] 7b: Update the Generate STEP button handler:
  ```javascript
  async function generateStep() {
      const optionsJson = JSON.stringify({
          format: "step",
          board_only: true,
          export_board_body: true,
          export_components: false
      });
      const stepContent = Module.ccall('kicad_export_step', 'string', ['string'], [optionsJson]);
      // Enable download button with stepContent
  }
  ```
- [ ] 7c: Keep the three.js 3D preview (tessellate the STEP output for display)
- [ ] 7d: Update `package.json` — remove `opencascade.js` dependency
- [ ] 7e: Update the step-export module (`src/step-export/index.mjs`) to use the native API
- [ ] 7f: Run all existing tests to verify no regressions

**Verification**: Browser demo exports STEP files using the native exporter. No opencascade.js download. STEP output matches native kicad-cli.

---

## Stage 8: Component 3D Model Support

**Goal**: Enable component 3D model loading in the WASM STEP export.

- [ ] 8a: Design the model resolution API for WASM:
  ```javascript
  // Before export, upload model files to virtual FS
  Module.FS.writeFile('/models/Resistor_SMD.step', modelData);
  const options = {
      format: "step",
      export_components: true,
      model_search_paths: ["/models/"]
  };
  ```
- [ ] 8b: Implement WASM-compatible `FILENAME_RESOLVER` that searches the Emscripten virtual FS
- [ ] 8c: Test with a PCB that has component models
- [ ] 8d: Add model preloading to the browser demo

**Verification**: STEP export with components matches native kicad-cli output including 3D models.

---

## Build Size Budget

| Component | Estimated Size |
|-----------|---------------|
| Current WASM (DRC+ERC) | 9.6 MB |
| OCCT core (TKernel through TKBool) | ~15-20 MB |
| OCCT STEP I/O + XDE | ~10-15 MB |
| KiCad exporter code | ~0.5 MB |
| **Total estimated** | **35-45 MB** |
| Brotli compressed | ~8-12 MB |

This replaces the current 9.6 MB (KiCad) + 63 MB (opencascade.js) = 72.6 MB total with a single ~40 MB binary.

---

## Key Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| OCCT platform code won't compile with Emscripten | opencascade.js proves it's possible; reference their patches |
| OCCT compile time too long (hours) | Cache `.a` static libraries; only recompile when OCCT version changes |
| Binary size too large | Aggressively strip unused modules; `-O3 -flto` dead code elimination |
| KiCad exporter has dependencies we haven't compiled | Stub incrementally; the exporter's core path is well-bounded |
| 3D model loading requires file I/O | Use Emscripten virtual FS; provide models via JS before export |
| STEP output differs from native | Same code + same OCCT version = same output; any differences are bugs to fix |
