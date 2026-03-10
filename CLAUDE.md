# KiCad WASM Utilities

KiCad validation and export tools (DRC, ERC, STEP, Specctra) compiled to WebAssembly for browser/Node.js execution.

## Quick Start

```bash
# Native build (for reference)
cd kicad-src/build/release && ninja kicad-cli

# WASM build
cd build-wasm && emcmake cmake .. && emmake make

# Test WASM
node test/node-test.js
```

## Project Structure

```
kicad-cli-wasm/
├── src/
│   ├── api.cpp              # WASM API exports (kicad_load_*, kicad_run_*)
│   ├── kiplatform_wasm.cpp  # Platform stubs for WASM
│   └── pgm_base_wasm.cpp    # Program base stubs
├── stubs/
│   └── wx/                  # wxWidgets compatibility stubs
├── kicad-src/               # KiCad source checkout (submodule or clone)
├── build-wasm/              # WASM build directory
├── test/                    # Node.js test files
├── PRD.md                   # DRC implementation (active)
├── PRD-ERC.md               # ERC implementation (pending DRC completion)
└── progress.txt             # Iteration progress log
```

## Current Work

**Active**: PRD.md (DRC - Design Rules Check for PCB)

**Pending**: PRD-ERC.md (ERC - Electrical Rules Check for schematics)
- Prerequisite: DRC must reach Stage 5g (Node.js testing complete)
- When ready: Archive PRD.md, rename PRD-ERC.md to PRD.md

## Architecture

```
KiCad Source (C++)
       ↓
  Emscripten
       ↓
  WASM Module
       ↓
  JS/TS API
       ↓
Browser / Node.js
```

**Key components:**
- `kicommon_wasm` - Common infrastructure (~140 files)
- `gal_wasm` - Graphics abstraction subset
- `pcbnew_wasm` - PCB engine (for DRC)
- `eeschema_wasm` - Schematic engine (for ERC)

## API

```typescript
// DRC (PCB validation)
kicad_load_pcb(content: string): boolean;
kicad_run_drc(): boolean;
kicad_get_drc_results(): string; // JSON

// ERC (Schematic validation) - planned
kicad_load_schematic(content: string): boolean;
kicad_run_erc(): boolean;
kicad_get_erc_results(): string; // JSON
```

## Key Files

| File | Purpose |
|------|---------|
| `src/api.cpp` | WASM exported functions |
| `CMakeLists.txt` | Build configuration |
| `stubs/wx/*.h` | wxWidgets stub implementations |
| `what-doesnt-work.md` | Known issues and workarounds |
| `DEPENDENCY_ANALYSIS.md` | KiCad dependency mapping |

## Build Notes

- Requires Emscripten SDK (emsdk)
- KiCad source must be checked out to `kicad-src/`
- Build is memory-intensive (8GB+ recommended)
- Uses `NODE_OPTIONS="--max-old-space-size=8192"`

## Testing

```bash
# Run Node.js tests
node test/node-test.js sample.kicad_pcb

# Compare with native
./kicad-src/build/release/kicad-cli pcb drc --format json sample.kicad_pcb
```

## References

- [KiCad Source](https://gitlab.com/kicad/code/kicad)
- [Emscripten Docs](https://emscripten.org/docs/)
- [KiCad File Formats](https://dev-docs.kicad.org/en/file-formats/)
