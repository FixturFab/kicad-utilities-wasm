# KiCad STEP Export via WASM - Product Requirements Document

## Overview

**Project Goal**: Extract PCB geometry from KiCad's BOARD as JSON via WASM, then construct 3D STEP files in TypeScript using `opencascade.js`.

**Architecture**: Two-layer approach:
1. **C API** (WASM) — `kicad_get_pcb_geometry()` extracts board outline, stackup, copper, holes, and component placement as JSON
2. **TypeScript** — `opencascade.js` constructs 3D geometry from JSON and writes STEP files

**Why not compile KiCad's STEP exporter directly?** KiCad's native STEP exporter (`step_pcb_model.cpp`) has 183+ OpenCASCADE Technology (OCCT) class references deeply coupled to C++. Compiling OCCT to WASM is impractical. Instead, we extract geometry data and use the existing `opencascade.js` npm package.

**Target Environments**: Browser and Node.js (same as DRC/ERC)

---

## Reference Code

| Source File | Purpose |
|-------------|---------|
| `kicad-test/kicad-src/pcbnew/exporters/step/exporter_step.cpp` | Main export logic, geometry extraction flow |
| `kicad-test/kicad-src/pcbnew/exporters/step/step_pcb_model.cpp` | 3D model construction, `getModelLocation()` |
| `kicad-test/kicad-src/pcbnew/board.h` | BOARD class, `GetBoardPolygonOutlines()`, `Footprints()` |
| `kicad-test/kicad-src/pcbnew/board_stackup_manager/board_stackup.h` | Stackup layer data |
| `kicad-test/kicad-src/libs/kimath/include/geometry/shape_poly_set.h` | Polygon data structure |
| `kicad-test/kicad-src/pcbnew/pad.h` | PAD class, hole data |

---

## JSON Geometry Schema

The `kicad_get_pcb_geometry()` function returns JSON with this structure:

```json
{
  "format_version": 1,
  "units": "mm",
  "board": {
    "outline": {
      "polygons": [
        {
          "outline": [[x, y], [x, y], ...],
          "holes": [[[x, y], [x, y], ...], ...]
        }
      ]
    },
    "thickness_mm": 1.6
  },
  "stackup": [
    {
      "type": "copper|dielectric|soldermask|silkscreen|solderpaste",
      "layer_id": "F.Cu",
      "thickness_mm": 0.035,
      "z_offset_mm": 0.0,
      "material": "copper",
      "epsilon_r": 4.5
    }
  ],
  "copper_layers": [
    {
      "layer_id": "F.Cu",
      "z_start_mm": 0.0,
      "thickness_mm": 0.035,
      "polygons": [
        {
          "net": "GND",
          "outline": [[x, y], ...],
          "holes": [[[x, y], ...]]
        }
      ]
    }
  ],
  "holes": [
    {
      "type": "pth|npth",
      "x_mm": 10.0,
      "y_mm": 20.0,
      "diameter_mm": 0.3,
      "top_layer": "F.Cu",
      "bottom_layer": "B.Cu",
      "plating_thickness_mm": 0.025
    }
  ],
  "components": [
    {
      "reference": "U1",
      "footprint": "Package_SO:SOIC-8",
      "position": { "x_mm": 50.0, "y_mm": 30.0 },
      "rotation_deg": 0.0,
      "side": "top|bottom",
      "models": [
        {
          "filename": "Package_SO.3dshapes/SOIC-8.step",
          "offset": { "x_mm": 0, "y_mm": 0, "z_mm": 0 },
          "rotation": { "x_deg": 0, "y_deg": 0, "z_deg": 0 },
          "scale": { "x": 1, "y": 1, "z": 1 }
        }
      ]
    }
  ]
}
```

---

## Stages

### Stage 1: C API — Board Outline + Stackup + Components

**Goal**: Add `kicad_get_pcb_geometry()` to the WASM API that extracts board outline, stackup, and component placement as JSON.

**Tasks**:
- [x] 1a. Add `kicad_get_pcb_geometry()` declaration to `kicad-drc-wasm/include/kicad_drc_api.h`
- [x] 1b. Implement board outline extraction in `kicad-drc-wasm/src/api.cpp`:
  - Call `g_board->GetBoardPolygonOutlines()` to get `SHAPE_POLY_SET`
  - Iterate `OutlineCount()` polygons, each with `CPolygon(idx)[0]` outline and `CPolygon(idx)[1..n]` holes
  - Convert `VECTOR2I` vertices to mm using `pcbIUScale.IUTomm()`
  - Output as JSON polygon arrays
- [x] 1c. Implement stackup extraction:
  - Call `g_board->GetStackupOrDefault()` to get `BOARD_STACKUP`
  - Iterate `GetCount()` items, extracting type, layer_id, thickness, material, epsilon_r
  - Get total board thickness from `BuildBoardThicknessFromStackup()`
  - Calculate Z offsets for each layer (accumulate from top)
  - Include copper layer count from `g_board->GetCopperLayerCount()`
- [x] 1d. Implement component extraction:
  - Iterate `g_board->Footprints()` for each `FOOTPRINT*`
  - Extract: `GetReference()`, `GetPosition()` (convert to mm), `GetOrientation().AsDegrees()`, `GetLayer()` (top/bottom)
  - For each `footprint->Models()`: extract `m_Filename`, `m_Offset`, `m_Rotation`, `m_Scale`, `m_Show`
- [x] 1e. Add `"_kicad_get_pcb_geometry"` to EXPORTED_FUNCTIONS in CMakeLists.txt line 733
- [x] 1f. Build WASM and verify compilation succeeds
- [x] 1g. Create `test/test-step-geometry.mjs` — Node.js test that:
  - Loads a sample .kicad_pcb file
  - Calls `kicad_get_pcb_geometry()`
  - Validates JSON structure (outline exists, stackup has layers, components listed)
  - Validates board outline has >3 vertices
  - Validates stackup has at least 2 copper layers
  - Run: `node --experimental-wasm-threads test/test-step-geometry.mjs`

**Key KiCad APIs**:
```cpp
// Board outline
bool BOARD::GetBoardPolygonOutlines(SHAPE_POLY_SET& aOutlines, ...);

// Stackup
BOARD_STACKUP BOARD::GetStackupOrDefault();
int BOARD::GetCopperLayerCount() const;
int BOARD_STACKUP::BuildBoardThicknessFromStackup() const;

// Components
const FOOTPRINTS& BOARD::Footprints() const;
const std::vector<FP_3DMODEL>& FOOTPRINT::Models();

// Unit conversion
double pcbIUScale.IUTomm(int aValue);
```

**Success Criteria**:
- [x] `kicad_get_pcb_geometry()` returns valid JSON with board outline, stackup, and components
- [x] Test passes: `node test/test-step-geometry.mjs` (56 assertions)
- [x] ERC regression: `node test/test-erc-suite.mjs` still passes (155 assertions)

---

### Stage 2: C API — Copper Polygons + Holes

**Goal**: Extend `kicad_get_pcb_geometry()` to include copper layer polygons and drill holes.

**Tasks**:
- [x] 2a. Implement copper polygon extraction in `api.cpp`:
  - For each copper layer (F.Cu, In1.Cu, ..., B.Cu):
    - Call `pad->TransformShapeToPolygon()` for all pads on this layer
    - Call `track->TransformShapeToPolygon()` for all tracks on this layer
    - Call `zone->TransformSolidAreasShapesToPolygon()` for filled zones
    - Merge into `SHAPE_POLY_SET`, call `Simplify()`
    - Serialize polygon outlines + holes as JSON arrays
  - Group polygons by net name using `pad->GetNetname()`, `track->GetNetname()`, `zone->GetNetname()`
  - Calculate Z start position and thickness for each copper layer from stackup
- [x] 2b. Implement drill hole extraction:
  - Iterate pads: `pad->HasHole()`, `pad->GetEffectiveHoleShape()`, `pad->GetDrillSizeX()`
  - Iterate vias: same hole extraction, plus `via->GetTopLayer()`, `via->GetBottomLayer()`
  - Classify as PTH vs NPTH from `pad->GetAttribute()`
  - Extract plating thickness (default 0.025mm for PTH)
  - Output hole center (x,y in mm), diameter, layer span, type
- [x] 2c. Update test to validate:
  - Copper layer polygons exist and have vertices
  - Hole data present with valid diameters
  - At least one PTH hole if board has through-hole components
  - Net names associated with copper polygons

**Key KiCad APIs**:
```cpp
// Pad polygon
void PAD::TransformShapeToPolygon(SHAPE_POLY_SET& aBuffer, PCB_LAYER_ID aLayer,
                                   int aClearance, int aMaxError, ERROR_LOC aLoc);

// Track polygon
void PCB_TRACK::TransformShapeToPolygon(SHAPE_POLY_SET& aBuffer, PCB_LAYER_ID aLayer,
                                         int aClearance, int aMaxError, ERROR_LOC aLoc);

// Zone fill polygons
void ZONE::TransformSolidAreasShapesToPolygon(PCB_LAYER_ID aLayer, SHAPE_POLY_SET& aBuffer);

// Hole data
bool PAD::HasHole() const;
std::shared_ptr<SHAPE_SEGMENT> PAD::GetEffectiveHoleShape();
int PAD::GetDrillSizeX() const;
PAD_ATTRIB PAD::GetAttribute() const; // PTH vs NPTH
```

**Success Criteria**:
- [x] JSON includes copper layer polygons (grouped per layer with z_start and thickness)
- [x] JSON includes drill hole data with positions and diameters
- [x] Test passes with expanded assertions (72 assertions)
- [x] ERC regression passes (155 assertions)

---

### Stage 3: TypeScript — Board Body STEP Generation

**Goal**: Create TypeScript module that takes geometry JSON and produces a STEP file of the board body using `opencascade.js`.

**Tasks**:
- [x] 3a. Add `opencascade.js` dependency:
  - `cd kicad-drc-wasm && npm install opencascade.js`
  - Create `src/step-export/` directory
- [x] 3b. Create `src/step-export/step-builder.mjs` — main builder class:
  - `StepBuilder` class that takes geometry JSON
  - Initialize opencascade.js WASM module
  - Method: `buildBoardBody()` → creates board solid from outline
- [x] 3c. Implement board outline → STEP solid:
  - Polygon vertices → `BRepBuilderAPI_MakeWire` (connect edges with `BRepBuilderAPI_MakeEdge` from `gp_Pnt` pairs)
  - Wire → face via `BRepBuilderAPI_MakeFace`
  - Face → solid prism via `BRepPrimAPI_MakePrism` with board thickness as height vector `gp_Vec(0, 0, thickness_mm)`
  - Handle outline holes: create hole wires, add as inner wires to face
- [x] 3d. Create `src/step-export/index.mjs` — public API:
  ```typescript
  export async function exportPcbToStep(geometryJson: PcbGeometry): Promise<Uint8Array>
  ```
- [x] 3e. Create `test/test-step-export.mjs` — test that:
  - Loads a .kicad_pcb, gets geometry JSON, builds STEP
  - Verifies output is valid STEP file (starts with "ISO-10303-21")
  - Verifies file size is reasonable (>1KB)
  - Run: `node test/test-step-export.mjs`

**Key opencascade.js APIs**:
```typescript
import initOpenCascade from 'opencascade.js';
const oc = await initOpenCascade();

// Point
const pt = new oc.gp_Pnt_3(x, y, z);

// Edge from two points
const edge = new oc.BRepBuilderAPI_MakeEdge_24(pt1, pt2);

// Wire from edges
const wireMaker = new oc.BRepBuilderAPI_MakeWire_1();
wireMaker.Add_1(edge.Edge());
const wire = wireMaker.Wire();

// Face from wire
const faceMaker = new oc.BRepBuilderAPI_MakeFace_15(wire, true);
const face = faceMaker.Face();

// Prism (extrude face along vector)
const vec = new oc.gp_Vec_4(0, 0, thickness);
const prism = new oc.BRepPrimAPI_MakePrism_1(face, vec, false, true);
const solid = prism.Shape();

// Write STEP
const writer = new oc.STEPControl_Writer_1();
writer.Transfer(solid, oc.STEPControl_StepModelType.STEPControl_AsIs, true);
writer.Write("output.step");
// Read from virtual FS: oc.FS.readFile("output.step")
```

**Success Criteria**:
- [x] Board body STEP file generated from geometry JSON (15.5KB)
- [x] STEP file is valid (starts with ISO-10303-21 header)
- [x] Board outline shape matches input polygon
- [x] Test passes (13 assertions)

---

### Stage 4: TypeScript — Drill Holes

**Goal**: Boolean-cut drill holes from the board body.

**Tasks**:
- [x] 4a. Implement cylinder creation for each hole:
  - `BRepPrimAPI_MakeCylinder` with hole radius and full board height
  - Position cylinder at hole center using `gp_Ax2` (axis at hole x,y, direction along Z)
  - Handle blind/buried vias: cylinder height matches layer span, not full board
- [x] 4b. Implement boolean subtraction:
  - `BRepAlgoAPI_Cut` to subtract each cylinder from board body
  - Process holes in batches to avoid performance issues
  - Fuse all hole cylinders first with `BRepAlgoAPI_Fuse`, then single cut operation
- [x] 4c. Update test to verify:
  - Board body has holes after boolean cut
  - STEP file size increases (more geometry)

**Key opencascade.js APIs**:
```typescript
// Cylinder at position
const axis = new oc.gp_Ax2_3(
    new oc.gp_Pnt_3(x, y, z_bottom),
    new oc.gp_Dir_4(0, 0, 1)
);
const cyl = new oc.BRepPrimAPI_MakeCylinder_2(axis, radius, height);

// Boolean cut
const cut = new oc.BRepAlgoAPI_Cut_3(boardSolid, cyl.Shape(), new oc.Message_ProgressRange_1());
const result = cut.Shape();

// Fuse multiple shapes
const fuse = new oc.BRepAlgoAPI_Fuse_3(shape1, shape2, new oc.Message_ProgressRange_1());
```

**Success Criteria**:
- [x] Holes are cut from board body
- [x] STEP file correctly shows through-holes
- [x] Test passes

---

### Stage 5: TypeScript — Copper Layers

**Goal**: Add copper layer extrusions to the STEP model.

**Tasks**:
- [x] 5a. Implement copper polygon → thin solid extrusion:
  - For each copper layer in geometry JSON:
    - Build wire from polygon vertices (same as board outline)
    - Create face from wire
    - Extrude with copper thickness (default 0.035mm) at correct Z offset
  - Handle polygon holes (pad clearances): add inner wires to face
- [x] 5b. Position copper layers at correct Z:
  - Use stackup Z offsets from geometry JSON
  - F.Cu at top of board, B.Cu at bottom
  - Inner copper at intermediate Z positions
- [x] 5c. Cut drill holes from copper layers:
  - Same cylinder subtraction as board body
  - Only cut layers that the hole spans
- [x] 5d. Assemble into compound:
  - `BRep_Builder` + `TopoDS_Compound` to combine board body + all copper layers
  - Each copper layer as a separate shape in compound (for per-layer coloring in STEP viewers)
- [x] 5e. Update test to verify:
  - Multiple shapes in STEP compound
  - Copper layer count matches input

**Success Criteria**:
- [x] Copper layers visible as thin extrusions at correct Z positions
- [x] Holes cut from copper where appropriate
- [x] All layers assembled in compound shape
- [x] Test passes (38 assertions)

---

### Stage 6: TypeScript — 3D Component Model Loading

**Goal**: Load component STEP files and place them at correct positions on the board.

**Tasks**:
- [x] 6a. Implement STEP model reader:
  - `STEPControl_Reader` to load component .step files
  - `ModelResolver` interface for callers to provide STEP file data:
    ```typescript
    interface ModelResolver {
      resolve(filename: string): Promise<Uint8Array | null>;
    }
    ```
  - Handle missing models gracefully (skip, don't fail)
- [ ] 6b. Implement placement transform replicating `getModelLocation()` from step_pcb_model.cpp:
  - Translation to footprint position on board (x, y, z_surface)
  - Rotation by footprint angle
  - Flip for bottom-side components (180deg X rotation)
  - Apply model offset (x, y, z)
  - Apply model rotation (z, y, x — Euler order)
  - Apply model scale
  - KiCad Y-axis inversion: negate Y in position
  - Z-position: top surface for top-side, bottom surface for bottom-side
- [ ] 6c. Add placed models to compound:
  - Transform each model shape with `BRepBuilderAPI_Transform`
  - Add to the compound alongside board body and copper

**Key transform order** (from `step_pcb_model.cpp:getModelLocation`):
1. Position: `gp_Trsf.SetTranslation(gp_Vec(x, -y, z_surface))`
2. Board rotation: `gp_Trsf.SetRotation(gp_Ax1(origin, gp_Dir(0,0,1)), angle_rad)`
3. Bottom flip: `gp_Trsf.SetRotation(gp_Ax1(origin, gp_Dir(0,1,0)), PI)` if bottom
4. Model offset: `gp_Trsf.SetTranslation(gp_Vec(offset_x, offset_y, offset_z))`
5. Model rotation Z: around Z axis
6. Model rotation Y: around Y axis
7. Model rotation X: around X axis

**Success Criteria**:
- [ ] Component STEP models load and place correctly
- [ ] Bottom-side components are flipped
- [ ] Missing models are skipped without error
- [ ] Test passes with at least one component model

---

### Stage 7: Public API + Integration

**Goal**: Clean public API, update types, end-to-end test.

**Tasks**:
- [ ] 7a. Create clean `exportPcbToStep()` public API in `src/step-export/index.ts`:
  ```typescript
  export interface StepExportOptions {
    /** Resolve 3D model filenames to STEP file data. Optional. */
    modelResolver?: ModelResolver;
    /** Include copper layers. Default: true. */
    includeCopperLayers?: boolean;
    /** Include drill holes. Default: true. */
    includeDrillHoles?: boolean;
    /** Include 3D component models. Default: true. */
    includeComponents?: boolean;
  }

  export async function exportPcbToStep(
    geometryJson: PcbGeometry,
    options?: StepExportOptions
  ): Promise<Uint8Array>;
  ```
- [ ] 7b. Update `types/kicad-wasm.d.ts`:
  - Add `_kicad_get_pcb_geometry` to `KicadWasmModule`
  - Add `PcbGeometry` JSON types
  - Add `StepExportOptions`, `ModelResolver` types
  - Add `exportPcbToStep` function type
- [ ] 7c. Update `package.json`:
  - Add `opencascade.js` to dependencies
  - Add `step-export` to exports map
  - Add test script for step tests
- [ ] 7d. Create end-to-end test `test/test-step-e2e.mjs`:
  - Load .kicad_pcb → get geometry → build full STEP (board + holes + copper)
  - Verify STEP file is valid and >10KB
  - Verify board dimensions roughly match PCB size
  - Run regression: `node --experimental-wasm-threads test/test-erc-suite.mjs`
- [ ] 7e. Commit all changes

**Success Criteria**:
- [ ] `exportPcbToStep()` produces valid STEP from .kicad_pcb
- [ ] TypeScript types are complete
- [ ] End-to-end test passes
- [ ] ERC regression passes
- [ ] All previous tests still pass

---

## Verification Commands

```bash
# Stage 1-2: Geometry extraction
node --experimental-wasm-threads test/test-step-geometry.mjs

# Stage 3-7: STEP generation
node --experimental-wasm-threads test/test-step-export.mjs

# Stage 7: End-to-end
node --experimental-wasm-threads test/test-step-e2e.mjs

# Regression
node --experimental-wasm-threads test/test-erc-suite.mjs
```

---

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Board connectivity not built before geometry extraction | HIGH | Reuse existing `kicad_load_pcb()` which calls `BuildConnectivity()` |
| Zone fills not available (zones need filling) | HIGH | Check if zones are filled after load; if not, call `zone->GetFilledPolysList()` which returns pre-filled data from the .kicad_pcb file |
| `opencascade.js` WASM size too large for browser | MEDIUM | Make STEP export an optional import; board body only needs ~5 OCCT classes |
| Copper polygon count too high (performance) | MEDIUM | Simplify polygons, merge by net, skip inner layers if option set |
| Component STEP model resolution | MEDIUM | ModelResolver interface lets callers provide models from any source |
| SHAPE_POLY_SET serialization with arcs | LOW | Call `ClearArcs()` before serialization to convert arcs to line segments |

---

## Out of Scope

- Solder mask / silkscreen 3D shapes (can add later)
- Solder paste stencil shapes
- Board edge chamfers / fillets
- Copper trace individual shapes (merged by layer)
- Component courtyard / fabrication layer shapes
- VRML/glTF output (only STEP)
- Interactive 3D viewer (separate project)

---

## Constants

From KiCad source:
- `BOARD_THICKNESS_DEFAULT_MM = 1.6`
- `COPPER_THICKNESS_DEFAULT_MM = 0.035`
- `OCC_MAX_DISTANCE_TO_MERGE_POINTS = 0.001`
- KiCad IU: 1 mm = 1,000,000 IU (nanometer scale)
- `pcbIUScale.IUTomm(value)` for conversion

---

## Checkpoints

After each stage:
- [x] **Stage 1**: Board outline + stackup + components extracted as JSON
- [x] **Stage 2**: Copper polygons + drill holes in JSON
- [x] **Stage 3**: Board body STEP file generated
- [x] **Stage 4**: Drill holes cut from board
- [x] **Stage 5**: Copper layers added
- [ ] **Stage 6**: Component models placed
- [ ] **Stage 7**: Public API complete, end-to-end test passes
