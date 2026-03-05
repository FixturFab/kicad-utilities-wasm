/**
 * Stage 3 test: Board body STEP generation from PCB geometry.
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

console.log('=== Stage 3: Board Body STEP Generation Test ===');
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

console.log();
console.log(`=== RESULT: ${failed === 0 ? 'PASS' : 'FAIL'} (${passed} passed, ${failed} failed) ===`);

if (failed > 0) {
  process.exit(1);
}
