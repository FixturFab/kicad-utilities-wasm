/**
 * STEP Export Parity Regression Tests
 *
 * Compares WASM STEP output against native kicad-cli STEP export to verify
 * geometric parity. Uses samples/parity-test.kicad_pcb which exercises:
 * - Board outline with slot cutout
 * - PTH pads (drill 1.0mm)
 * - NPTH mounting hole (drill 3.2mm)
 * - Vias (drill 0.4mm)
 * - Copper layers (F.Cu, B.Cu)
 * - SMD pads (should NOT create holes)
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

function assertClose(actual, expected, tolerance, msg) {
  const diff = Math.abs(actual - expected);
  assert(diff <= tolerance, `${msg} (actual=${actual}, expected=${expected}, diff=${diff}, tol=${tolerance})`);
}

function countEntities(stepContent, entityName) {
  const regex = new RegExp(entityName, 'g');
  return (stepContent.match(regex) || []).length;
}

// ── Load WASM module ──
console.log('Loading WASM module...');
const mjsPath = resolve(__dirname, '../build-wasm-erc/kicad_drc.mjs');
const { default: createKicadDRC } = await import(mjsPath);
const Module = await createKicadDRC({
  print: () => {},
  printErr: () => {},
  locateFile: (path) => resolve(__dirname, '../build-wasm-erc/', path),
});

// ── Load test PCB ──
const pcbPath = resolve(__dirname, '../../samples/parity-test.kicad_pcb');
const pcbContent = readFileSync(pcbPath, 'utf-8');

const len = Module.lengthBytesUTF8(pcbContent) + 1;
const ptr = Module._malloc(len);
Module.stringToUTF8(pcbContent, ptr, len);
const rc = Module._kicad_load_pcb(ptr, 0);
Module._free(ptr);

assert(rc === 0, 'WASM loads parity-test.kicad_pcb');

// ── Extract geometry JSON ──
const geoPtr = Module._kicad_get_pcb_geometry();
const geoStr = Module.UTF8ToString(geoPtr);
const geo = JSON.parse(geoStr);

// ══════════════════════════════════════════════════════════════════
// [1/5] Geometry JSON Validation
// ══════════════════════════════════════════════════════════════════
console.log('\n[1/5] Geometry JSON validation...');

assert(geo.board.thickness_mm === 1.6, 'Board thickness is 1.6mm');

const outline = geo.board.outline.polygons[0];
const xs = outline.outline.map(p => p[0]);
const ys = outline.outline.map(p => p[1]);
const boardWidth = Math.max(...xs) - Math.min(...xs);
const boardHeight = Math.max(...ys) - Math.min(...ys);
assertClose(boardWidth, 50, 0.1, 'Board width ~50mm');
assertClose(boardHeight, 35, 0.1, 'Board height ~35mm');

assert(outline.holes && outline.holes.length >= 1, 'Board outline has slot cutout');

// Holes
const validHoles = geo.holes.filter(h => h.diameter_mm >= 0.02);
assert(validHoles.length === 5, `5 valid drill holes (got ${validHoles.length})`);

const pthHoles = validHoles.filter(h => h.type === 'pth');
const npthHoles = validHoles.filter(h => h.type === 'npth');
assert(pthHoles.length === 4, `4 PTH holes (2 pads + 2 vias) (got ${pthHoles.length})`);
assert(npthHoles.length === 1, `1 NPTH hole (mounting) (got ${npthHoles.length})`);

const d1mm = validHoles.filter(h => Math.abs(h.diameter_mm - 1.0) < 0.01);
const d04mm = validHoles.filter(h => Math.abs(h.diameter_mm - 0.4) < 0.01);
const d32mm = validHoles.filter(h => Math.abs(h.diameter_mm - 3.2) < 0.01);
assert(d1mm.length === 2, `2 holes with d=1.0mm (got ${d1mm.length})`);
assert(d04mm.length === 2, `2 holes with d=0.4mm (got ${d04mm.length})`);
assert(d32mm.length === 1, `1 hole with d=3.2mm (got ${d32mm.length})`);

// No degenerate holes
const degenerateHoles = geo.holes.filter(h => h.diameter_mm > 0 && h.diameter_mm < 0.02);
assert(degenerateHoles.length === 0, `No degenerate holes (d<0.02mm) (got ${degenerateHoles.length})`);

// Copper layers
assert(geo.copper_layer_count === 2, 'Two copper layers');
assert(geo.copper_layers.length === 2, 'Two copper layer polygon sets');
const fCuPolys = geo.copper_layers.find(l => l.layer_id === 'F.Cu')?.polygons?.length || 0;
const bCuPolys = geo.copper_layers.find(l => l.layer_id === 'B.Cu')?.polygons?.length || 0;
assert(fCuPolys > 0, `F.Cu has copper polygons (${fCuPolys})`);
assert(bCuPolys > 0, `B.Cu has copper polygons (${bCuPolys})`);

// ══════════════════════════════════════════════════════════════════
// [2/5] WASM STEP Generation — Board Only
// ══════════════════════════════════════════════════════════════════
console.log('\n[2/5] WASM STEP generation (board only)...');

const { initOpenCascade, StepBuilder } = await import(
  resolve(__dirname, '../src/step-export/step-builder.mjs')
);
const oc = await initOpenCascade();
const builder = new StepBuilder(oc, geo);

let boardShape = builder.buildBoardBody();
assert(boardShape != null, 'Board body built');

boardShape = builder.cutDrillHoles(boardShape);
assert(boardShape != null, 'Drill holes cut');

const wasmBoardStep = builder.writeStep(boardShape);
assert(wasmBoardStep.length > 0, 'WASM board-only STEP has content');

const wasmBoardStepStr = new TextDecoder().decode(wasmBoardStep);
assert(wasmBoardStepStr.startsWith('ISO-10303-21'), 'WASM STEP starts with ISO-10303-21');

const wasmBoardShells = countEntities(wasmBoardStepStr, 'CLOSED_SHELL');
const wasmBoardFaces = countEntities(wasmBoardStepStr, 'ADVANCED_FACE');
const wasmBoardCylinders = countEntities(wasmBoardStepStr, 'CYLINDRICAL_SURFACE');
const wasmBoardPlanes = countEntities(wasmBoardStepStr, 'PLANE');

console.log(`  WASM board-only: ${wasmBoardStep.length}b, shells=${wasmBoardShells}, faces=${wasmBoardFaces}, cylinders=${wasmBoardCylinders}, planes=${wasmBoardPlanes}`);

assert(wasmBoardShells === 1, `Board-only has 1 CLOSED_SHELL (got ${wasmBoardShells})`);
assert(wasmBoardCylinders === validHoles.length,
  `Board has ${validHoles.length} cylindrical surfaces for holes (got ${wasmBoardCylinders})`);

// ══════════════════════════════════════════════════════════════════
// [3/5] WASM STEP Generation — Full (Board + Copper)
// ══════════════════════════════════════════════════════════════════
console.log('\n[3/5] WASM STEP generation (full with copper)...');

const copperSolids = builder.buildAllCopperLayers();
assert(copperSolids.length > 0, `Copper solids built (${copperSolids.length})`);

const compound = new oc.TopoDS_Compound();
const bld = new oc.BRep_Builder();
bld.MakeCompound(compound);
bld.Add(compound, boardShape);
for (const solid of copperSolids) {
  bld.Add(compound, solid);
}

const wasmFullStep = builder.writeStep(compound);
assert(wasmFullStep.length > wasmBoardStep.length, 'Full STEP is larger than board-only');

const wasmFullStepStr = new TextDecoder().decode(wasmFullStep);
const wasmFullShells = countEntities(wasmFullStepStr, 'CLOSED_SHELL');
const wasmFullFaces = countEntities(wasmFullStepStr, 'ADVANCED_FACE');
const wasmFullCylinders = countEntities(wasmFullStepStr, 'CYLINDRICAL_SURFACE');

console.log(`  WASM full: ${wasmFullStep.length}b, shells=${wasmFullShells}, faces=${wasmFullFaces}, cylinders=${wasmFullCylinders}`);

assert(wasmFullShells > 1, `Full STEP has >1 shells (board + copper) (got ${wasmFullShells})`);
assert(wasmFullShells === 1 + copperSolids.length,
  `Full shells = 1 board + ${copperSolids.length} copper (got ${wasmFullShells})`);

Module._kicad_cleanup();

// ══════════════════════════════════════════════════════════════════
// [4/5] Native KiCad STEP Export
// ══════════════════════════════════════════════════════════════════
console.log('\n[4/5] Native KiCad STEP export...');

let nativeBoardStepStr = '';
let nativeFullStepStr = '';
let nativeAvailable = false;

try {
  execSync('kicad-cli --version', { stdio: 'pipe' });
  nativeAvailable = true;
} catch (e) {
  console.log('  SKIP: kicad-cli not available, skipping native comparison');
}

if (nativeAvailable) {
  // Board-only
  const nativeBoardOut = execSync(
    `kicad-cli pcb export step --board-only --force -o /tmp/parity-native-board.step "${pcbPath}" 2>&1`
  ).toString();

  // Parse native log for hole count
  const holeMatch = nativeBoardOut.match(/holes? \((\d+) hole/);
  const nativeHoleCount = holeMatch ? parseInt(holeMatch[1]) : -1;
  console.log(`  Native board-only log: ${nativeHoleCount} holes reported`);

  nativeBoardStepStr = readFileSync('/tmp/parity-native-board.step', 'utf-8');
  assert(nativeBoardStepStr.startsWith('ISO-10303-21'), 'Native STEP starts with ISO-10303-21');

  const nativeBoardShells = countEntities(nativeBoardStepStr, 'CLOSED_SHELL');
  const nativeBoardFaces = countEntities(nativeBoardStepStr, 'ADVANCED_FACE');
  const nativeBoardCylinders = countEntities(nativeBoardStepStr, 'CYLINDRICAL_SURFACE');

  console.log(`  Native board-only: ${nativeBoardStepStr.length}b, shells=${nativeBoardShells}, faces=${nativeBoardFaces}, cylinders=${nativeBoardCylinders}`);

  assert(nativeBoardShells === 1, `Native board-only has 1 CLOSED_SHELL (got ${nativeBoardShells})`);

  // Full (with tracks/zones)
  const nativeFullOut = execSync(
    `kicad-cli pcb export step --board-only --include-tracks --include-zones --force -o /tmp/parity-native-full.step "${pcbPath}" 2>&1`
  ).toString();

  nativeFullStepStr = readFileSync('/tmp/parity-native-full.step', 'utf-8');
  const nativeFullShells = countEntities(nativeFullStepStr, 'CLOSED_SHELL');
  const nativeFullFaces = countEntities(nativeFullStepStr, 'ADVANCED_FACE');
  const nativeFullCylinders = countEntities(nativeFullStepStr, 'CYLINDRICAL_SURFACE');

  console.log(`  Native full: ${nativeFullStepStr.length}b, shells=${nativeFullShells}, faces=${nativeFullFaces}, cylinders=${nativeFullCylinders}`);
}

// ══════════════════════════════════════════════════════════════════
// [5/5] Parity Comparison
// ══════════════════════════════════════════════════════════════════
console.log('\n[5/5] Parity comparison...');

if (nativeAvailable) {
  const nativeBoardShells = countEntities(nativeBoardStepStr, 'CLOSED_SHELL');
  const nativeBoardCylinders = countEntities(nativeBoardStepStr, 'CYLINDRICAL_SURFACE');
  const nativeFullShells = countEntities(nativeFullStepStr, 'CLOSED_SHELL');

  // Both should have 1 shell for board-only
  assert(wasmBoardShells === nativeBoardShells,
    `Board shell count matches: WASM=${wasmBoardShells}, native=${nativeBoardShells}`);

  // WASM should have at least as many cylindrical surfaces as native
  // (native may handle some holes as outline cutouts instead of cylinders)
  assert(wasmBoardCylinders >= nativeBoardCylinders,
    `WASM cylinders (${wasmBoardCylinders}) >= native cylinders (${nativeBoardCylinders})`);

  // Both board-only files should be valid and non-trivial
  assert(wasmBoardStep.length > 1000, `WASM board-only is non-trivial (${wasmBoardStep.length}b)`);
  assert(nativeBoardStepStr.length > 1000, `Native board-only is non-trivial (${nativeBoardStepStr.length}b)`);

  // Full STEP should have more shells than board-only for both
  assert(wasmFullShells > wasmBoardShells,
    `WASM full has more shells than board-only (${wasmFullShells} > ${wasmBoardShells})`);
  assert(nativeFullShells >= nativeBoardShells,
    `Native full has >= shells than board-only (${nativeFullShells} >= ${nativeBoardShells})`);

  // Verify all holes appear as cylinders in WASM output
  // Native may model holes differently (outline cutouts vs boolean cylinders)
  assert(wasmBoardCylinders === 5,
    `WASM has exactly 5 cylinders for 5 drill holes (got ${wasmBoardCylinders})`);

  // File size ratio sanity: WASM should be within 10x of native
  const sizeRatio = wasmBoardStep.length / nativeBoardStepStr.length;
  assert(sizeRatio > 0.1 && sizeRatio < 10,
    `Board-only size ratio is reasonable (${sizeRatio.toFixed(2)}x, WASM=${wasmBoardStep.length}b, native=${nativeBoardStepStr.length}b)`);
} else {
  // Without native, just verify WASM output is self-consistent
  assert(wasmBoardCylinders === 5, `WASM has 5 cylinders for 5 drill holes (got ${wasmBoardCylinders})`);
  assert(wasmFullShells > wasmBoardShells, `Full has more shells than board-only`);
}

// ══════════════════════════════════════════════════════════════════
// Summary
// ══════════════════════════════════════════════════════════════════
console.log(`\n=== RESULT: ${failed === 0 ? 'PASS' : 'FAIL'} (${passed} passed, ${failed} failed) ===`);
process.exit(failed > 0 ? 1 : 0);
