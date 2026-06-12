# KiCad WASM Utilities

KiCad PCB and schematic tools running in the browser or Node.js via WebAssembly.

This project compiles KiCad's validation and export tools to WebAssembly, enabling PCB/schematic design checks and 3D export without a native KiCad installation.

**[Try the Live Demo](https://fixturfab.github.io/kicad-utilities-wasm/)**

## Features

### DRC (Design Rule Check)
- **26 DRC test providers** — clearance, track width, hole size, annular width, silk/mask, courtyard, connectivity, and more
- **JSON output** following the [`schemas.kicad.org/drc.v1.json`](https://schemas.kicad.org/drc.v1.json) schema

### ERC (Electrical Rules Check)
- **42 ERC violation types** — pin conflicts, power integrity, unconnected nets, hierarchical sheet validation
- **JSON output** following the [`schemas.kicad.org/erc.v1.json`](https://schemas.kicad.org/erc.v1.json) schema

### STEP Export
- **3D STEP model generation** from PCB layouts using OCCT
- **Board geometry extraction** — stackup, drill holes, component positions
- **Silkscreen engraving** — `engrave_depth_mm` boolean-subtracts the silkscreen
  from the board body as real recesses (for laser-engraved panel previews); the
  removed volumes are kept as marker-colored `ENGRAVING` products

### Specctra DSN/SES
- **DSN export** for autorouter integration
- **SES import** to apply routed tracks back to PCB

### Common
- **Multi-threaded** via WebAssembly pthreads (SharedArrayBuffer)
- **~7 MB** optimized WASM binary (-O3 -flto)
- Runs in **Node.js** and **browser** environments

## Quick Start

```js
import { readFileSync } from 'fs';
import createKicadDRC from './build-wasm/kicad_drc.mjs';

// Initialize the WASM module
const Module = await createKicadDRC();

// Read a .kicad_pcb file
const pcb = readFileSync('board.kicad_pcb', 'utf-8');

// Allocate string in WASM memory
const len = Module.lengthBytesUTF8(pcb) + 1;
const ptr = Module._malloc(len);
Module.stringToUTF8(pcb, ptr, len);

// Load PCB (returns 0 on success)
const rc = Module._kicad_load_pcb(ptr, 0);
Module._free(ptr);

// Run DRC
const violationCount = Module._kicad_run_drc();

// Get JSON results
const jsonPtr = Module._kicad_get_drc_results();
const results = JSON.parse(Module.UTF8ToString(jsonPtr));

console.log(results.violations);

// Clean up
Module._kicad_cleanup();
```

Run with threading support:

```bash
node --experimental-wasm-threads test/test-wasm.mjs board.kicad_pcb
```

## API Reference

The module exports four C functions, callable via `Module._<name>()`:

### `kicad_load_pcb(pcb_content, length)`

Load a KiCad PCB from in-memory content (s-expression format).

- **pcb_content** (`const char*`) — null-terminated `.kicad_pcb` file content
- **length** (`size_t`) — byte length, or 0 to use strlen
- **Returns** `0` on success, non-zero error code on failure

### `kicad_run_drc()`

Run all DRC checks on the loaded PCB. Must call `kicad_load_pcb()` first.

- **Returns** number of violations found, or `-1` on error

### `kicad_get_drc_results()`

Get DRC results as a JSON string. The returned pointer is valid until the next call to `kicad_run_drc()` or `kicad_cleanup()`.

- **Returns** JSON string following the `schemas.kicad.org/drc.v1.json` schema, or `NULL` on error

### `kicad_cleanup()`

Free all resources (board, DRC engine, results).

## Output Format

Results follow the [KiCad DRC JSON schema](https://schemas.kicad.org/drc.v1.json):

```json
{
  "source": "board.kicad_pcb",
  "coordinate_units": "mm",
  "violations": [
    {
      "type": "silk_overlap",
      "severity": "warning",
      "description": "Silkscreen overlap ...",
      "items": [
        {
          "description": "Text \"REF**\" on F.Silkscreen",
          "pos": { "x": 100.0, "y": 50.0 }
        }
      ]
    }
  ],
  "unconnected_items": [],
  "schematic_parity": []
}
```

## Building from Source

### Prerequisites

- **Emscripten SDK** (emsdk 5.0.0+)
- **CMake** 3.20+
- **KiCad source tree** with a completed native release build (provides generated headers)

### Steps

```bash
# 1. Clone KiCad source — NOTE: master pinned near 2026-03-06, NOT the 9.0
#    stable branch (the port tracks master-only files like layer_utils.cpp)
git clone --shallow-since=2026-02-15 https://gitlab.com/kicad/code/kicad.git kicad-src
git -C kicad-src checkout $(git -C kicad-src rev-list -1 --before="2026-03-07" origin/master)

# 2. Build KiCad natively first (needed for generated headers).
#    KICAD_USE_CMAKE_FINDPROTOBUF works around Ubuntu's protobuf packages
#    lacking CMake config files.
cmake -S kicad-src -B kicad-src/build/release -DCMAKE_BUILD_TYPE=Release \
      -DKICAD_USE_CMAKE_FINDPROTOBUF=ON -DKICAD_BUILD_QA_TESTS=OFF \
      -DKICAD_SCRIPTING_WXPYTHON=OFF
cmake --build kicad-src/build/release -j$(nproc)

# 3. Install and activate Emscripten
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk && ./emsdk install 5.0.0 && ./emsdk activate 5.0.0
source emsdk_env.sh && cd ..

# 4. Download OCCT 7.6.3 source (compiled into the WASM build for STEP export)
git clone --depth 1 --branch V7_6_3 https://github.com/Open-Cascade-SAS/OCCT.git \
    kicad-drc-wasm/thirdparty/occt-7.6.3

# 5. Configure WASM build (build-wasm-erc is the directory the node tests use)
emcmake cmake -S kicad-drc-wasm -B kicad-drc-wasm/build-wasm-erc

# 6. Build (8GB+ RAM or swap recommended for the LTO link)
cmake --build kicad-drc-wasm/build-wasm-erc -j$(nproc)
```

Output files:
- `kicad-drc-wasm/build-wasm/kicad_drc.wasm` (7.3 MB)
- `kicad-drc-wasm/build-wasm/kicad_drc.mjs` (103 KB loader)
- `kicad-drc-wasm/build-wasm/kicad_drc.worker.mjs` (pthread worker)

## Known Limitations

- **Violation count differs from kicad-cli** — the WASM build reports 4 violations on the sample PCB vs. 6 from `kicad-cli`. The 2 missing are library parity warnings that require footprint library access and schematic data, which are not available in standalone mode.
- **No schematic parity checks** — schematic data (`testFootprints=false`) is not loaded, so footprint-vs-schematic checks are skipped.
- **No library parity provider** — `drc_test_provider_library_parity` is excluded (crashes in WASM static initialization due to a global `UNITS_PROVIDER`).
- **wxWidgets stubbed** — wxString and other wx types are minimal stubs; no GUI functionality is available.
- **Threading requires SharedArrayBuffer** — the browser must serve pages with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers.

## License

This project builds upon KiCad source code, which is licensed under the [GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.html). See the [KiCad project](https://www.kicad.org/) for details.
