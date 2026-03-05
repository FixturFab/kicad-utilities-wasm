# GitLab Demo Pages — DRC + ERC + STEP Export

## Overview

Multi-page GitLab Pages demo showcasing all three KiCad WASM features: DRC, ERC, and STEP Export with 3D preview.

**Architecture**: Four HTML pages in `public/` sharing a nav bar and CSS design system. The STEP page uses opencascade.js for STEP construction + tessellation, three.js (CDN) for 3D rendering.

**Existing demo**: `public/index.html` is a single-page DRC-only demo (720 lines). The WASM binary in `public/` is outdated (DRC-only, 7.3MB). Current build at `kicad-drc-wasm/build-wasm-erc/` has DRC+ERC+geometry APIs (9.6MB).

---

## Key Files

| File | Purpose |
|------|---------|
| `public/index.html` | Current DRC demo → rewrite as hub page |
| `public/shared.css` | New — shared styles extracted from index.html |
| `public/nav.js` | New — shared nav bar injected via JS |
| `public/drc.html` | New — DRC demo (moved from index.html) |
| `public/erc.html` | New — ERC demo |
| `public/step.html` | New — STEP export with 3D preview |
| `public/kicad_drc.mjs` | Update from build-wasm-erc/ |
| `public/kicad_drc.wasm` | Update from build-wasm-erc/ |
| `public/opencascade.wasm.js` | Copy from node_modules/opencascade.js/dist/ |
| `public/opencascade.wasm.wasm` | Copy from node_modules/opencascade.js/dist/ (~63MB) |
| `public/sample.kicad_sch` | Copy from samples/erc/with_errors.kicad_sch |
| `public/sample.kicad_pcb` | Already exists |
| `public/coi-serviceworker.js` | Already exists (SharedArrayBuffer) |
| `public/_headers` | Already exists (COOP/COEP) |

## Design Tokens (from existing demo)

```css
--primary: #2563eb;  --primary-dark: #1d4ed8;
--success: #16a34a;  --warning: #ca8a04;  --error: #dc2626;
--bg: #f8fafc;  --card: #ffffff;  --text: #1e293b;
--text-muted: #64748b;  --border: #e2e8f0;
```

## WASM API Reference

```
DRC:  _kicad_load_pcb(ptr, 0), _kicad_run_drc(), _kicad_get_drc_results(), _kicad_cleanup()
ERC:  _kicad_load_schematic(ptr, 0), _kicad_run_erc(), _kicad_get_erc_results(), _kicad_cleanup_schematic()
STEP: _kicad_load_pcb(ptr, 0), _kicad_get_pcb_geometry(), _kicad_cleanup()
      + opencascade.js for STEP construction + tessellation
      + three.js for 3D rendering
```

## ERC JSON Structure (differs from DRC)

```json
{
  "sheets": [
    {
      "path": "/",
      "uuid_path": "/uuid",
      "violations": [
        { "type": "pin_not_connected", "severity": "error", "description": "...", "items": [...] }
      ]
    }
  ]
}
```

Note: ERC groups violations by sheet. DRC has flat `violations[]` array.

## STEP Page — Browser-Adapted Code

The existing `kicad-drc-wasm/src/step-export/step-builder.mjs` uses Node.js APIs (`createRequire`, `readFileSync`, `fs`). For the browser, inline adapted versions of:

- `initOpenCascade()` — use `import('./opencascade.wasm.js')` instead of `require()`
- `StepBuilder.buildWire()` — unchanged
- `StepBuilder.buildBoardBody()` — unchanged
- `StepBuilder.cutDrillHoles()` — unchanged
- `StepBuilder.buildCopperLayerSolids()` — unchanged
- `StepBuilder.writeStep()` — simplified, use `oc.FS` only (no Node.js fs fallback)

Skip component model loading for the demo (would need user to upload .step files).

## Tessellation for 3D Preview

After building the STEP shape, tessellate with opencascade.js and render with three.js:

```javascript
// Tessellate
new oc.BRepMesh_IncrementalMesh_2(shape, 0.1, false, 0.5, false);

// Extract triangles from each face
const explorer = new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
while (explorer.More()) {
    const face = oc.TopoDS.Face_1(explorer.Current());
    const location = new oc.TopLoc_Location_1();
    const triangulation = oc.BRep_Tool.Triangulation(face, location);
    if (!triangulation.IsNull()) {
        const tri = triangulation.get();
        // tri.NbNodes(), tri.Node(i) → vertices
        // tri.NbTriangles(), tri.Triangle(i) → indices
        // face.Orientation_1() → check if reversed
    }
    explorer.Next();
}
```

three.js setup:
```javascript
// Import via import map (no bundler)
// <script type="importmap">{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.175.0/build/three.module.js", "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.175.0/examples/jsm/" } }</script>
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Scene: dark background (#1e293b), ambient + 2 directional lights
// Material: green PCB (0x2d8a4e), MeshPhongMaterial
// Camera: PerspectiveCamera, fit to bounding box
// Controls: OrbitControls with damping
```

---

## Stages

### Stage 1: Shared CSS + Nav Bar + Hub Page

**Goal**: Extract shared styles, create nav bar component, rewrite index.html as hub.

**Tasks**:
- [x] 1a. Create `public/shared.css` — extract all CSS from current `public/index.html` `<style>` block, add nav bar styles:
  ```css
  .nav { display: flex; gap: 0; background: var(--card); border-bottom: 1px solid var(--border); margin-bottom: 2rem; border-radius: 12px 12px 0 0; overflow: hidden; }
  .nav a { padding: 0.75rem 1.5rem; text-decoration: none; color: var(--text-muted); font-weight: 500; font-size: 0.95rem; border-bottom: 2px solid transparent; transition: all 0.2s; }
  .nav a:hover { color: var(--text); background: var(--bg); }
  .nav a.active { color: var(--primary); border-bottom-color: var(--primary); }
  ```
- [x] 1b. Create `public/nav.js` — injects nav bar at top of `.container`, highlights active page. Pages: Overview (index.html), DRC (drc.html), ERC (erc.html), STEP Export (step.html).
- [x] 1c. Rewrite `public/index.html` as hub page:
  - Links to `shared.css`, loads `nav.js`
  - Title: "KiCad WASM Tools"
  - Subtitle: "PCB and schematic validation in the browser, powered by WebAssembly"
  - Three cards linking to DRC, ERC, STEP Export with icons and descriptions
  - Does NOT load any WASM module
- [x] 1d. Verify index.html loads correctly (no JS errors, nav renders)

**Success Criteria**:
- [x] `shared.css` contains all design tokens and component styles
- [x] `nav.js` renders nav with 4 links, highlights current page
- [x] `index.html` is a clean hub with no WASM loading

---

### Stage 2: DRC Demo Page

**Goal**: Move existing DRC demo to `drc.html` with shared nav.

**Tasks**:
- [x] 2a. Create `public/drc.html`:
  - Links to `shared.css`, loads `nav.js`
  - Title: "DRC Check — KiCad WASM Tools"
  - All DRC HTML structure from current index.html (drop zone, buttons, results, violations list)
  - All DRC JavaScript from current index.html (loadModule, handleFile, runDRC, displayResults, escapeHtml)
  - Module status shows "Loading WASM module (9.6 MB)..."
  - Uses `./kicad_drc.mjs` for module import, `./` + path for locateFile
- [x] 2b. Verify DRC works: load page, click "Use Sample PCB", run DRC, see violations

**Success Criteria**:
- [x] DRC page loads module, runs DRC on sample PCB, displays violations
- [x] Nav bar present and highlights "DRC"

---

### Stage 3: ERC Demo Page

**Goal**: Create ERC demo page.

**Tasks**:
- [x] 3a. Copy sample schematic: `cp samples/erc/with_errors.kicad_sch public/sample.kicad_sch`
- [x] 3b. Create `public/erc.html`:
  - Links to `shared.css`, loads `nav.js`
  - Title: "ERC Check — KiCad WASM Tools"
  - Same layout as DRC but accepts `.kicad_sch` files
  - "Use Sample Schematic" button loads `sample.kicad_sch`
  - Uses ERC WASM API: `_kicad_load_schematic`, `_kicad_run_erc`, `_kicad_get_erc_results`, `_kicad_cleanup_schematic`
  - Results grouped by sheet: render sheet path header, then violations under each sheet
  - Violation display same card format as DRC (severity indicator, type, description, items with positions)
  - "Show raw JSON" toggle like DRC page
- [x] 3c. Verify ERC works: load page, use sample schematic, run ERC, see violations grouped by sheet

**Success Criteria**:
- [x] ERC page loads module, runs ERC on sample schematic, displays violations by sheet
- [x] Nav bar present and highlights "ERC"

---

### Stage 4: Update WASM Binary + Copy opencascade.js

**Goal**: Update public/ with current WASM build and add opencascade.js dist files.

**Tasks**:
- [x] 4a. Copy updated WASM:
  ```bash
  cp kicad-drc-wasm/build-wasm-erc/kicad_drc.mjs public/
  cp kicad-drc-wasm/build-wasm-erc/kicad_drc.wasm public/
  cp kicad-drc-wasm/build-wasm-erc/kicad_drc.worker.mjs public/ 2>/dev/null || true
  ```
- [x] 4b. Copy opencascade.js dist:
  ```bash
  cp kicad-drc-wasm/node_modules/opencascade.js/dist/opencascade.wasm.js public/
  cp kicad-drc-wasm/node_modules/opencascade.js/dist/opencascade.wasm.wasm public/
  ```
- [x] 4c. Verify sizes: kicad_drc.wasm ~9.6MB, opencascade.wasm.wasm ~63MB
- [x] 4d. Verify DRC page still works with updated WASM binary
- [x] 4e. Verify ERC page works with updated WASM binary

**Success Criteria**:
- [x] Updated WASM binary in public/
- [x] opencascade.js dist files in public/
- [x] DRC and ERC pages still functional

---

### Stage 5: STEP Page — Layout + Geometry Extraction

**Goal**: Create STEP page with file drop and geometry stats display.

**Tasks**:
- [x] 5a. Create `public/step.html` with layout:
  - Links to `shared.css`, loads `nav.js`
  - Title: "STEP Export — KiCad WASM Tools"
  - Two status bars: "KiCad WASM" (loads immediately) + "opencascade.js" (shows "will load on demand")
  - Drop zone for `.kicad_pcb` files, "Use Sample PCB" button
  - Stats panel (hidden initially): board dimensions, thickness, copper layers, holes, components
  - 3D viewer canvas (hidden initially): 500px height, dark background
  - Action buttons: "Generate STEP" (hidden until file loaded), "Download .step" (hidden until built)
- [x] 5b. Implement KiCad WASM loading + geometry extraction:
  - Same WASM loading pattern as DRC/ERC pages
  - On file load: `_kicad_load_pcb()` then `_kicad_get_pcb_geometry()`
  - Parse geometry JSON, show stats (board W x H mm, thickness, N copper layers, N holes, N components)
  - Show "Generate STEP" button after geometry extracted
- [x] 5c. Verify: drop sample.kicad_pcb, stats populate correctly

**Success Criteria**:
- [x] STEP page loads, accepts .kicad_pcb files
- [x] Geometry stats display correctly
- [x] "Generate STEP" button appears after file loaded

---

### Stage 6: STEP Page — 3D Construction + Preview

**Goal**: Add opencascade.js STEP construction and three.js 3D preview.

**Tasks**:
- [x] 6a. Add three.js import map to step.html:
  ```html
  <script type="importmap">
  { "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.175.0/build/three.module.js", "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.175.0/examples/jsm/" } }
  </script>
  ```
- [x] 6b. Implement browser-adapted `initOpenCascade()`:
  - Import `./opencascade.wasm.js`
  - `locateFile: (path) => './' + path`
  - Update status bar during loading
- [x] 6c. Implement browser-adapted StepBuilder (inline in step.html):
  - `buildWire(vertices, z)` — same as step-builder.mjs
  - `buildBoardBody()` — same
  - `cutDrillHoles()` — same (fuse-then-cut)
  - `buildCopperLayerSolids()` — same (with degenerate edge skip)
  - `writeStep(shape)` — simplified for browser: write to `oc.FS`, read back, return Uint8Array
  - Skip component model loading for demo
- [x] 6d. Implement tessellation function:
  - `BRepMesh_IncrementalMesh_2(shape, 0.1, false, 0.5, false)` for tessellation
  - `TopExp_Explorer` to iterate faces
  - Extract vertices via `tri.Node(i)`, triangles via `tri.Triangle(i)`
  - Handle face orientation (reversed faces swap winding order)
- [x] 6e. Implement three.js 3D viewer:
  - Scene with dark background (#1e293b)
  - AmbientLight + 2 DirectionalLights
  - MeshPhongMaterial with green PCB color (0x2d8a4e)
  - PerspectiveCamera, fit to bounding box
  - OrbitControls with damping
  - Resize handler for canvas
  - Hint text: "Click and drag to rotate"
- [x] 6f. Connect "Generate STEP" button:
  - Lazy-load opencascade.js on first click
  - Build shape (board body + holes + copper)
  - Tessellate + display in viewer
  - Store STEP data for download
  - Show "Download .step" button
- [x] 6g. Implement download button:
  - Create Blob from STEP Uint8Array
  - Trigger download as `<filename>.step`
- [x] 6h. Verify: drop sample.kicad_pcb, click Generate STEP, 3D preview shows, download works

**Success Criteria**:
- [x] opencascade.js loads lazily on "Generate STEP" click
- [x] 3D preview shows green PCB board with holes and copper
- [x] OrbitControls work (rotate, zoom, pan)
- [x] Download produces valid .step file (starts with ISO-10303-21)

---

### Stage 7: Polish + Commit + Push

**Goal**: Final polish, commit everything, push.

**Tasks**:
- [x] 7a. Test all four pages work:
  - index.html — hub loads, nav works, links work
  - drc.html — module loads, sample PCB runs DRC, violations displayed
  - erc.html — module loads, sample schematic runs ERC, violations by sheet
  - step.html — module loads, geometry extracted, STEP built, 3D preview shows, download works
- [x] 7b. Fix any issues found
- [x] 7c. Commit all changes:
  ```bash
  git add public/ docs/plans/
  git commit -m "feat(demo): GitLab Pages with DRC, ERC, and STEP 3D preview demos"
  ```
- [x] 7d. Push:
  ```bash
  git push origin master
  ```

**Success Criteria**:
- [x] All pages functional
- [x] Committed and pushed
- [x] GitLab Pages will deploy on push

---

## Verification

After push, GitLab Pages deploys automatically. URLs:
- `https://henrybtroutman.gitlab.io/kicad-cli-wasm/` — hub
- `https://henrybtroutman.gitlab.io/kicad-cli-wasm/drc.html` — DRC
- `https://henrybtroutman.gitlab.io/kicad-cli-wasm/erc.html` — ERC
- `https://henrybtroutman.gitlab.io/kicad-cli-wasm/step.html` — STEP Export

---

## Checkpoints

- [x] **Stage 1**: Shared CSS + nav + hub page
- [x] **Stage 2**: DRC page works
- [x] **Stage 3**: ERC page works
- [x] **Stage 4**: WASM binaries updated
- [x] **Stage 5**: STEP page layout + geometry
- [x] **Stage 6**: STEP 3D preview works
- [x] **Stage 7**: All polished, committed, pushed
