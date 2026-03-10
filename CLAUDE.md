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
├── kicad-drc-wasm/
│   ├── src/api.cpp          # WASM API exports (kicad_load_*, kicad_run_*)
│   ├── src/config/          # JS configuration helpers
│   ├── src/specctra/        # Specctra DSN/SES helpers
│   ├── src/step-export/     # STEP export helpers
│   ├── stubs/wx/            # wxWidgets compatibility stubs
│   ├── test/                # Node.js test files
│   └── types/               # TypeScript definitions
├── public/                  # Demo pages (GitHub Pages)
├── scripts/                 # Build and release scripts
├── docs/internal/           # Archived development docs
└── kicad-src/               # KiCad source checkout (for building)
```

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
| `kicad-drc-wasm/src/api.cpp` | WASM exported functions |
| `kicad-drc-wasm/CMakeLists.txt` | Build configuration |
| `kicad-drc-wasm/stubs/wx/*.h` | wxWidgets stub implementations |
| `docs/internal/what-doesnt-work.md` | Known issues and workarounds |
| `docs/internal/DEPENDENCY_ANALYSIS.md` | KiCad dependency mapping |

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
