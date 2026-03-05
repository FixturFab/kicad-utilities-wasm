/**
 * Stage 3+4+5 test: Board body STEP generation + drill holes + copper layers.
 *
 * Usage: node test-step-export.mjs [path-to-kicad_pcb]
 */
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pcbPath = process.argv[2] || resolve(__dirname, '../../samples/test.kicad_pcb');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

console.log('=== Stage 3+4+5: Board Body + Drill Holes + Copper Layers STEP Test ===');
console.log('PCB file:', pcbPath);
console.log();

// Step 1: Load KiCad WASM and extract geometry
console.log('[1/4] Loading KiCad WASM module...');
const mjsPath = resolve(__dirname, '../build-wasm-erc/kicad_drc.mjs');
const { default: createKicadDRC } = await import(mjsPath);

const Module = await createKicadDRC({
  print: () => {},
  printErr: () => {},
  locateFile: (path) => resolve(__dirname, '../build-wasm-erc/', path),
});
console.log('[1/4] Module loaded.');

// Step 2: Load PCB and get geometry
console.log('[2/4] Extracting PCB geometry...');
const pcbContent = readFileSync(pcbPath, 'utf8');
const len = Module.lengthBytesUTF8(pcbContent) + 1;
const ptr = Module._malloc(len);
Module.stringToUTF8(pcbContent, ptr, len);
const loadResult = Module._kicad_load_pcb(ptr, 0);
Module._free(ptr);
assert(loadResult === 0, `kicad_load_pcb should return 0, got ${loadResult}`);

const jsonPtr = Module._kicad_get_pcb_geometry();
assert(jsonPtr !== 0, 'kicad_get_pcb_geometry should return non-null');
const jsonStr = Module.UTF8ToString(jsonPtr);
const geometry = JSON.parse(jsonStr);
assert(geometry.board !== undefined, 'Geometry should have board');
assert(geometry.board.outline.polygons.length > 0, 'Should have outline polygons');
console.log('[2/4] Geometry extracted.');
console.log('  Board:', geometry.board.outline.polygons[0].outline.length, 'outline vertices');
console.log('  Thickness:', geometry.board.thickness_mm, 'mm');

// Step 3: Build STEP file
console.log('[3/4] Building STEP file with opencascade.js...');
const { exportPcbToStep } = await import('../src/step-export/index.mjs');
const stepData = await exportPcbToStep(geometry);

assert(stepData instanceof Uint8Array, 'exportPcbToStep should return Uint8Array');
assert(stepData.length > 1000, `STEP file should be >1KB, got ${stepData.length} bytes`);
console.log('  STEP file size:', stepData.length, 'bytes');

// Step 4: Validate STEP content
console.log('[4/4] Validating STEP file...');
const stepText = new TextDecoder().decode(stepData);
assert(stepText.startsWith('ISO-10303-21'), 'STEP should start with ISO-10303-21');
assert(stepText.includes('HEADER'), 'STEP should contain HEADER section');
assert(stepText.includes('DATA'), 'STEP should contain DATA section');
assert(stepText.includes('END-ISO-10303-21'), 'STEP should end with END-ISO-10303-21');
assert(stepText.includes('CLOSED_SHELL'), 'STEP should contain CLOSED_SHELL (solid body)');
assert(stepText.includes('MANIFOLD_SOLID_BREP') || stepText.includes('BREP_WITH_VOIDS'),
  'STEP should contain solid brep entity');

// Check reasonable file size (a simple board should be 5-50KB)
assert(stepData.length > 5000, `STEP should be >5KB for a board body, got ${stepData.length}`);

// Optionally write to disk for visual inspection
if (process.env.WRITE_STEP) {
  const outPath = resolve(__dirname, 'output-board.step');
  writeFileSync(outPath, stepData);
  console.log('  Written to:', outPath);
}

// Cleanup
Module._kicad_cleanup();

// =============================================
// Stage 4: Drill Holes Test (synthetic geometry)
// =============================================
console.log();
console.log('--- Stage 4: Drill Holes Test ---');

// Create synthetic geometry with a rectangular board and 3 drill holes
const syntheticGeometry = {
  format_version: 1,
  units: 'mm',
  board: {
    outline: {
      polygons: [{
        outline: [[0, 0], [50, 0], [50, 30], [0, 30]],
        holes: []
      }]
    },
    thickness_mm: 1.6
  },
  stackup: [],
  copper_layers: [],
  holes: [
    { type: 'pth', x_mm: 10, y_mm: 15, diameter_mm: 1.0, top_layer: 'F.Cu', bottom_layer: 'B.Cu', plating_thickness_mm: 0.025 },
    { type: 'pth', x_mm: 25, y_mm: 15, diameter_mm: 0.8, top_layer: 'F.Cu', bottom_layer: 'B.Cu', plating_thickness_mm: 0.025 },
    { type: 'npth', x_mm: 40, y_mm: 15, diameter_mm: 3.2, top_layer: 'F.Cu', bottom_layer: 'B.Cu', plating_thickness_mm: 0 },
  ],
  components: []
};

console.log('[5/7] Building STEP with drill holes...');
const stepWithHoles = await exportPcbToStep(syntheticGeometry, { includeDrillHoles: true });
assert(stepWithHoles instanceof Uint8Array, 'STEP with holes should be Uint8Array');
assert(stepWithHoles.length > 1000, `STEP with holes should be >1KB, got ${stepWithHoles.length} bytes`);
console.log('  STEP with holes size:', stepWithHoles.length, 'bytes');

const holeStepText = new TextDecoder().decode(stepWithHoles);
assert(holeStepText.startsWith('ISO-10303-21'), 'STEP with holes should start with ISO-10303-21');
assert(holeStepText.includes('CLOSED_SHELL'), 'STEP with holes should contain CLOSED_SHELL');

// Build same board without holes for comparison
console.log('[6/7] Building STEP without drill holes (comparison)...');
const stepNoHoles = await exportPcbToStep(syntheticGeometry, { includeDrillHoles: false });
assert(stepNoHoles instanceof Uint8Array, 'STEP without holes should be Uint8Array');
console.log('  STEP without holes size:', stepNoHoles.length, 'bytes');

// STEP with holes should have more geometry entities than without
assert(stepWithHoles.length > stepNoHoles.length,
  `STEP with holes (${stepWithHoles.length}) should be larger than without (${stepNoHoles.length})`);

// Check that holes introduced BREP_WITH_VOIDS or additional CLOSED_SHELLs
const shellCountWithHoles = (holeStepText.match(/CLOSED_SHELL/g) || []).length;
const noHoleStepText = new TextDecoder().decode(stepNoHoles);
const shellCountNoHoles = (noHoleStepText.match(/CLOSED_SHELL/g) || []).length;
assert(shellCountWithHoles >= shellCountNoHoles,
  `Should have >= CLOSED_SHELLs with holes (${shellCountWithHoles}) vs without (${shellCountNoHoles})`);

// Verify the STEP file with holes contains cylindrical surface entities
assert(holeStepText.includes('CYLINDRICAL_SURFACE'),
  'STEP with holes should contain CYLINDRICAL_SURFACE for drill holes');

// Test with 0 holes (should still work fine)
console.log('[7/7] Verifying 0-hole board still works...');
const noHoleGeom = { ...syntheticGeometry, holes: [] };
const stepZeroHoles = await exportPcbToStep(noHoleGeom, { includeDrillHoles: true });
assert(stepZeroHoles instanceof Uint8Array, 'STEP with 0 holes should be Uint8Array');
assert(stepZeroHoles.length > 1000, 'STEP with 0 holes should be >1KB');

if (process.env.WRITE_STEP) {
  const outHoles = resolve(__dirname, 'output-board-holes.step');
  writeFileSync(outHoles, stepWithHoles);
  console.log('  Written to:', outHoles);
}

// =============================================
// Stage 5: Copper Layers Test (synthetic geometry)
// =============================================
console.log();
console.log('--- Stage 5: Copper Layers Test ---');

// Create synthetic geometry with board + 2 copper layers + 2 holes
const copperGeometry = {
  format_version: 1,
  units: 'mm',
  board: {
    outline: {
      polygons: [{
        outline: [[0, 0], [50, 0], [50, 30], [0, 30]],
        holes: []
      }]
    },
    thickness_mm: 1.6
  },
  stackup: [],
  copper_layers: [
    {
      layer_id: 'F.Cu',
      z_start_mm: 0.0,
      thickness_mm: 0.035,
      polygons: [
        {
          net: 'GND',
          outline: [[5, 5], [45, 5], [45, 25], [5, 25]],
          holes: [[[10, 10], [15, 10], [15, 15], [10, 15]]]  // clearance hole
        }
      ]
    },
    {
      layer_id: 'B.Cu',
      z_start_mm: -1.6,
      thickness_mm: 0.035,
      polygons: [
        {
          net: 'VCC',
          outline: [[2, 2], [48, 2], [48, 28], [2, 28]],
          holes: []
        }
      ]
    }
  ],
  holes: [
    { type: 'pth', x_mm: 12.5, y_mm: 12.5, diameter_mm: 1.0, top_layer: 'F.Cu', bottom_layer: 'B.Cu', plating_thickness_mm: 0.025 },
    { type: 'npth', x_mm: 40, y_mm: 15, diameter_mm: 3.2, top_layer: 'F.Cu', bottom_layer: 'B.Cu', plating_thickness_mm: 0 },
  ],
  components: []
};

// 5a: Build with copper layers enabled
console.log('[8/12] Building STEP with copper layers...');
const stepWithCopper = await exportPcbToStep(copperGeometry, {
  includeDrillHoles: true,
  includeCopperLayers: true
});
assert(stepWithCopper instanceof Uint8Array, 'STEP with copper should be Uint8Array');
assert(stepWithCopper.length > 1000, `STEP with copper should be >1KB, got ${stepWithCopper.length} bytes`);
console.log('  STEP with copper size:', stepWithCopper.length, 'bytes');

const copperStepText = new TextDecoder().decode(stepWithCopper);
assert(copperStepText.startsWith('ISO-10303-21'), 'STEP with copper should start with ISO-10303-21');
assert(copperStepText.includes('CLOSED_SHELL'), 'STEP with copper should contain CLOSED_SHELL');

// 5b: Build without copper for comparison
console.log('[9/12] Building STEP without copper (comparison)...');
const stepNoCu = await exportPcbToStep(copperGeometry, {
  includeDrillHoles: true,
  includeCopperLayers: false
});
assert(stepNoCu instanceof Uint8Array, 'STEP without copper should be Uint8Array');
console.log('  STEP without copper size:', stepNoCu.length, 'bytes');

// With copper should be larger (more geometry entities)
assert(stepWithCopper.length > stepNoCu.length,
  `STEP with copper (${stepWithCopper.length}) should be larger than without (${stepNoCu.length})`);

// 5c: Verify compound has multiple shapes
const shellCountCopper = (copperStepText.match(/CLOSED_SHELL/g) || []).length;
const noCuText = new TextDecoder().decode(stepNoCu);
const shellCountNoCu = (noCuText.match(/CLOSED_SHELL/g) || []).length;
assert(shellCountCopper > shellCountNoCu,
  `Should have more CLOSED_SHELLs with copper (${shellCountCopper}) vs without (${shellCountNoCu})`);
console.log(`  CLOSED_SHELLs: with copper=${shellCountCopper}, without=${shellCountNoCu}`);

// 5d: Verify copper with drill holes has cylindrical surfaces
assert(copperStepText.includes('CYLINDRICAL_SURFACE'),
  'STEP with copper+holes should contain CYLINDRICAL_SURFACE');

// 5e: Verify boards with empty copper still work
console.log('[10/12] Testing board with 0 copper polygons...');
const emptyCuGeom = { ...copperGeometry, copper_layers: [] };
const stepEmptyCu = await exportPcbToStep(emptyCuGeom, { includeCopperLayers: true });
assert(stepEmptyCu instanceof Uint8Array, 'STEP with empty copper should be Uint8Array');
assert(stepEmptyCu.length > 1000, 'STEP with empty copper should be >1KB');

// 5f: Test copper layers without drill holes
console.log('[11/12] Testing copper layers without drill holes...');
const noDrillCuGeom = { ...copperGeometry, holes: [] };
const stepCuNoDrill = await exportPcbToStep(noDrillCuGeom, {
  includeDrillHoles: true,
  includeCopperLayers: true
});
assert(stepCuNoDrill instanceof Uint8Array, 'STEP copper no-drill should be Uint8Array');
assert(stepCuNoDrill.length > 1000, 'STEP copper no-drill should be >1KB');
const cuNoDrillText = new TextDecoder().decode(stepCuNoDrill);
const cuNoDrillShells = (cuNoDrillText.match(/CLOSED_SHELL/g) || []).length;
// Board + 2 copper layers = at least 3 shells
assert(cuNoDrillShells >= 3,
  `Should have >= 3 CLOSED_SHELLs (board + 2 copper), got ${cuNoDrillShells}`);
console.log(`  CLOSED_SHELLs (no drill): ${cuNoDrillShells}`);

// 5g: Test with real PCB geometry (if copper polygons available)
console.log('[12/12] Testing with real PCB copper data...');
if (geometry.copper_layers && geometry.copper_layers.some(l => l.polygons.length > 0)) {
  const stepRealCu = await exportPcbToStep(geometry, {
    includeDrillHoles: true,
    includeCopperLayers: true
  });
  assert(stepRealCu instanceof Uint8Array, 'Real PCB STEP with copper should be Uint8Array');
  assert(stepRealCu.length > stepData.length,
    `Real STEP with copper (${stepRealCu.length}) should be larger than board only (${stepData.length})`);
  console.log('  Real PCB STEP with copper:', stepRealCu.length, 'bytes');

  if (process.env.WRITE_STEP) {
    const outCu = resolve(__dirname, 'output-board-copper.step');
    writeFileSync(outCu, stepRealCu);
    console.log('  Written to:', outCu);
  }
} else {
  console.log('  (skipped: no copper polygons on real board)');
}

if (process.env.WRITE_STEP) {
  const outCu = resolve(__dirname, 'output-copper.step');
  writeFileSync(outCu, stepWithCopper);
  console.log('  Written to:', outCu);
}

// =============================================
// Stage 6a: Component STEP Model Reader Test
// =============================================
console.log();
console.log('--- Stage 6a: Component STEP Model Reader Test ---');

// First, create a synthetic component STEP model (a small box) using opencascade.js
console.log('[13/18] Creating synthetic component STEP model...');
const { initOpenCascade, StepBuilder } = await import('../src/step-export/step-builder.mjs');

// We need the oc instance - get it by calling exportPcbToStep once to warm it up,
// then create a builder to access oc
const dummyGeom = {
  format_version: 1, units: 'mm',
  board: { outline: { polygons: [{ outline: [[0,0],[10,0],[10,10],[0,10]], holes: [] }] }, thickness_mm: 1.6 },
  stackup: [], copper_layers: [], holes: [], components: []
};
const { exportPcbToStep: exportFn } = await import('../src/step-export/index.mjs');
// Initialize OC by doing a dummy export
await exportFn(dummyGeom, { includeCopperLayers: false, includeDrillHoles: false, includeComponents: false });

// Now get oc instance from initOpenCascade (it caches)
const oc = await initOpenCascade();

// Create a component STEP model: a 5x3x2mm box at origin
const compPt = new oc.gp_Pnt_3(0, 0, 0);
const compBox = new oc.BRepPrimAPI_MakeBox_2(compPt, 5, 3, 2);
const compWriter = new oc.STEPControl_Writer_1();
compWriter.Transfer(compBox.Shape(), oc.STEPControl_StepModelType.STEPControl_AsIs, true);
try { oc.FS.mkdir('/home'); } catch(e) {}
try { oc.FS.mkdir('/home/web_user'); } catch(e) {}
oc.FS.chdir('/home/web_user');
compWriter.Write('m.step');
compWriter.delete();
compBox.delete();
const componentStepData = new Uint8Array(oc.FS.readFile('/home/web_user/m.step'));
oc.FS.unlink('/home/web_user/m.step');
console.log('  Component STEP model size:', componentStepData.length, 'bytes');
assert(componentStepData.length > 1000, 'Component STEP model should be >1KB');

// 6a-1: Test readStepModel directly
console.log('[14/18] Testing readStepModel() with valid STEP data...');
const testBuilder = new StepBuilder(oc, dummyGeom);
const loadedShape = testBuilder.readStepModel(componentStepData);
assert(loadedShape !== null, 'readStepModel should return a shape for valid STEP data');
assert(!loadedShape.IsNull(), 'Loaded shape should not be null');
console.log('  Shape loaded successfully');

// 6a-2: Test readStepModel with invalid data
console.log('[15/18] Testing readStepModel() with invalid data...');
const invalidData = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0xFF]);
const badShape = testBuilder.readStepModel(invalidData);
assert(badShape === null, 'readStepModel should return null for invalid STEP data');
console.log('  Invalid data handled gracefully');

// 6a-3: Test ModelResolver with components
console.log('[16/18] Testing ModelResolver integration...');
const compGeometry = {
  format_version: 1, units: 'mm',
  board: {
    outline: { polygons: [{ outline: [[0,0],[50,0],[50,30],[0,30]], holes: [] }] },
    thickness_mm: 1.6
  },
  stackup: [],
  copper_layers: [],
  holes: [],
  components: [
    {
      reference: 'U1',
      footprint: 'Package_SO:SOIC-8',
      position: { x_mm: 25, y_mm: 15 },
      rotation_deg: 0,
      side: 'top',
      models: [
        {
          filename: 'Package_SO.3dshapes/SOIC-8.step',
          offset: { x_mm: 0, y_mm: 0, z_mm: 0 },
          rotation: { x_deg: 0, y_deg: 0, z_deg: 0 },
          scale: { x: 1, y: 1, z: 1 }
        }
      ]
    }
  ]
};

let resolveCallCount = 0;
let resolvedFilenames = [];
const modelResolver = {
  resolve: async (filename) => {
    resolveCallCount++;
    resolvedFilenames.push(filename);
    if (filename === 'Package_SO.3dshapes/SOIC-8.step') {
      return componentStepData;
    }
    return null;
  }
};

const stepWithModel = await exportFn(compGeometry, {
  includeDrillHoles: false,
  includeCopperLayers: false,
  includeComponents: true,
  modelResolver
});
assert(stepWithModel instanceof Uint8Array, 'STEP with component should be Uint8Array');
assert(resolveCallCount === 1, `ModelResolver should be called once, got ${resolveCallCount}`);
assert(resolvedFilenames[0] === 'Package_SO.3dshapes/SOIC-8.step',
  `Should resolve correct filename, got ${resolvedFilenames[0]}`);
console.log('  STEP with component size:', stepWithModel.length, 'bytes');

// Compare to board-only STEP
const stepBoardOnly = await exportFn(compGeometry, {
  includeDrillHoles: false, includeCopperLayers: false, includeComponents: false
});
assert(stepWithModel.length > stepBoardOnly.length,
  `STEP with model (${stepWithModel.length}) should be larger than board only (${stepBoardOnly.length})`);
console.log(`  Board only: ${stepBoardOnly.length} bytes, with model: ${stepWithModel.length} bytes`);

// Verify compound has the component shape
const modelStepText = new TextDecoder().decode(stepWithModel);
const modelShellCount = (modelStepText.match(/CLOSED_SHELL/g) || []).length;
const boardOnlyText = new TextDecoder().decode(stepBoardOnly);
const boardOnlyShellCount = (boardOnlyText.match(/CLOSED_SHELL/g) || []).length;
assert(modelShellCount > boardOnlyShellCount,
  `Should have more CLOSED_SHELLs with model (${modelShellCount}) vs without (${boardOnlyShellCount})`);

// 6a-4: Test missing model is skipped
console.log('[17/18] Testing missing model is skipped gracefully...');
const missingModelGeom = {
  ...compGeometry,
  components: [{
    reference: 'U2',
    footprint: 'Package_QFP:QFP-44',
    position: { x_mm: 10, y_mm: 10 },
    rotation_deg: 0,
    side: 'top',
    models: [{ filename: 'nonexistent.step', offset: { x_mm: 0, y_mm: 0, z_mm: 0 },
               rotation: { x_deg: 0, y_deg: 0, z_deg: 0 }, scale: { x: 1, y: 1, z: 1 } }]
  }]
};
const nullResolver = { resolve: async () => null };
const stepMissing = await exportFn(missingModelGeom, {
  includeDrillHoles: false, includeCopperLayers: false,
  includeComponents: true, modelResolver: nullResolver
});
assert(stepMissing instanceof Uint8Array, 'Should still produce STEP when model is missing');
assert(stepMissing.length > 1000, 'Board STEP should still be >1KB');
console.log('  Missing model handled gracefully');

// 6a-5: Test no modelResolver with includeComponents=true (should work, just skip components)
console.log('[18/18] Testing includeComponents=true with no modelResolver...');
const stepNoResolver = await exportFn(compGeometry, {
  includeDrillHoles: false, includeCopperLayers: false, includeComponents: true
});
assert(stepNoResolver instanceof Uint8Array, 'Should produce STEP without modelResolver');
assert(stepNoResolver.length > 1000, 'Board STEP should still be >1KB');
console.log('  No resolver handled gracefully');

console.log();
console.log(`=== RESULT: ${failed === 0 ? 'PASS' : 'FAIL'} (${passed} passed, ${failed} failed) ===`);

if (failed > 0) {
  process.exit(1);
}
