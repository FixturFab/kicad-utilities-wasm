/**
 * Stage 3+4 test: Board body STEP generation + drill holes from PCB geometry.
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

console.log('=== Stage 3+4: Board Body + Drill Holes STEP Test ===');
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

console.log();
console.log(`=== RESULT: ${failed === 0 ? 'PASS' : 'FAIL'} (${passed} passed, ${failed} failed) ===`);

if (failed > 0) {
  process.exit(1);
}
