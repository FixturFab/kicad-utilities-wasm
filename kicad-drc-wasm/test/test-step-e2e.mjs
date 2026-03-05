/**
 * Stage 7: End-to-end STEP export test.
 *
 * Loads a .kicad_pcb → extracts geometry → builds full STEP (board + holes + copper + components)
 * → validates output.
 *
 * Usage: node test/test-step-e2e.mjs [path-to-kicad_pcb]
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

console.log('=== Stage 7: End-to-End STEP Export Test ===');
console.log('PCB file:', pcbPath);
console.log();

// Step 1: Load KiCad WASM module
console.log('[1/5] Loading KiCad WASM module...');
const mjsPath = resolve(__dirname, '../build-wasm-erc/kicad_drc.mjs');
const { default: createKicadDRC } = await import(mjsPath);

const Module = await createKicadDRC({
  print: () => {},
  printErr: () => {},
  locateFile: (path) => resolve(__dirname, '../build-wasm-erc/', path),
});
console.log('[1/5] Module loaded.');

// Step 2: Load PCB and extract geometry
console.log('[2/5] Loading PCB and extracting geometry...');
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

// Validate geometry structure
assert(geometry.format_version === 1, `format_version should be 1, got ${geometry.format_version}`);
assert(geometry.units === 'mm', `units should be "mm", got ${geometry.units}`);
assert(geometry.board !== undefined, 'Geometry should have board');
assert(geometry.board.outline.polygons.length > 0, 'Should have outline polygons');
assert(geometry.board.thickness_mm > 0, 'Board thickness should be > 0');
assert(Array.isArray(geometry.stackup), 'Should have stackup array');
assert(Array.isArray(geometry.copper_layers), 'Should have copper_layers array');
assert(Array.isArray(geometry.holes), 'Should have holes array');
assert(Array.isArray(geometry.components), 'Should have components array');

const outlineVerts = geometry.board.outline.polygons[0].outline.length;
assert(outlineVerts >= 3, `Board outline should have >= 3 vertices, got ${outlineVerts}`);
console.log(`  Board: ${outlineVerts} outline vertices, ${geometry.board.thickness_mm}mm thick`);
console.log(`  Stackup: ${geometry.stackup.length} layers`);
console.log(`  Copper layers: ${geometry.copper_layers.length}`);
console.log(`  Holes: ${geometry.holes.length}`);
console.log(`  Components: ${geometry.components.length}`);

// Step 3: Build STEP with all features
console.log('[3/5] Building full STEP file (board + holes + copper)...');
const { exportPcbToStep } = await import('../src/step-export/index.mjs');

const stepData = await exportPcbToStep(geometry, {
  includeDrillHoles: true,
  includeCopperLayers: true,
  includeComponents: false, // No model resolver in this test
});

assert(stepData instanceof Uint8Array, 'exportPcbToStep should return Uint8Array');
assert(stepData.length > 1000, `STEP should be >1KB, got ${stepData.length} bytes`);
console.log(`  STEP file size: ${stepData.length} bytes`);

// Step 4: Validate STEP content
console.log('[4/5] Validating STEP file content...');
const stepText = new TextDecoder().decode(stepData);
assert(stepText.startsWith('ISO-10303-21'), 'STEP should start with ISO-10303-21');
assert(stepText.includes('HEADER'), 'STEP should contain HEADER section');
assert(stepText.includes('DATA'), 'STEP should contain DATA section');
assert(stepText.includes('END-ISO-10303-21'), 'STEP should end with END-ISO-10303-21');
assert(stepText.includes('CLOSED_SHELL'), 'STEP should contain CLOSED_SHELL (solid body)');
assert(stepText.includes('MANIFOLD_SOLID_BREP') || stepText.includes('BREP_WITH_VOIDS'),
  'STEP should contain solid brep entity');

// Count CLOSED_SHELLs — should have board body + copper layers
const shellCount = (stepText.match(/CLOSED_SHELL/g) || []).length;
console.log(`  CLOSED_SHELLs: ${shellCount}`);

// If copper layers have polygons, we expect more than 1 shell
const copperPolygonCount = geometry.copper_layers.reduce(
  (sum, l) => sum + (l.polygons ? l.polygons.length : 0), 0
);
if (copperPolygonCount > 0) {
  assert(shellCount > 1,
    `Should have >1 CLOSED_SHELL when copper present (got ${shellCount})`);
}

// If holes exist, should have cylindrical surfaces
if (geometry.holes.length > 0) {
  assert(stepText.includes('CYLINDRICAL_SURFACE'),
    'Should have CYLINDRICAL_SURFACE when holes present');
}

// Step 5: Verify board dimensions are reasonable
console.log('[5/5] Verifying board dimensions...');

// Extract approximate board dimensions from outline
const outline = geometry.board.outline.polygons[0].outline;
const xs = outline.map(v => v[0]);
const ys = outline.map(v => v[1]);
const boardWidth = Math.max(...xs) - Math.min(...xs);
const boardHeight = Math.max(...ys) - Math.min(...ys);
console.log(`  Board dimensions: ~${boardWidth.toFixed(1)} x ${boardHeight.toFixed(1)} mm`);
assert(boardWidth > 1 && boardWidth < 1000, `Board width should be 1-1000mm, got ${boardWidth}`);
assert(boardHeight > 1 && boardHeight < 1000, `Board height should be 1-1000mm, got ${boardHeight}`);

// STEP file size should be proportional to complexity
// A simple board with copper should be at least 5KB
assert(stepData.length > 5000, `Full STEP should be >5KB, got ${stepData.length}`);

// Compare with board-only export
const boardOnlyStep = await exportPcbToStep(geometry, {
  includeDrillHoles: false,
  includeCopperLayers: false,
  includeComponents: false,
});
assert(boardOnlyStep instanceof Uint8Array, 'Board-only STEP should be Uint8Array');

if (copperPolygonCount > 0 || geometry.holes.length > 0) {
  assert(stepData.length > boardOnlyStep.length,
    `Full STEP (${stepData.length}) should be larger than board-only (${boardOnlyStep.length})`);
}
console.log(`  Board-only: ${boardOnlyStep.length} bytes, Full: ${stepData.length} bytes`);

// Optionally write to disk
if (process.env.WRITE_STEP) {
  const outPath = resolve(__dirname, 'output-e2e.step');
  writeFileSync(outPath, stepData);
  console.log(`  Written to: ${outPath}`);
}

// Cleanup
Module._kicad_cleanup();

console.log();
console.log(`=== RESULT: ${failed === 0 ? 'PASS' : 'FAIL'} (${passed} passed, ${failed} failed) ===`);

if (failed > 0) {
  process.exit(1);
}
