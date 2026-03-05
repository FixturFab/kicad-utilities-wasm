/**
 * Stage 1 test: PCB geometry extraction for STEP export.
 *
 * Usage: node --experimental-wasm-threads test-step-geometry.mjs [path-to-kicad_pcb]
 */
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

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

console.log('=== Stage 1: PCB Geometry Extraction Test ===');
console.log('PCB file:', pcbPath);
console.log();

// Step 1: Load WASM module
console.log('[1/4] Loading WASM module...');
const mjsPath = resolve(__dirname, '../build-wasm-erc/kicad_drc.mjs');
const { default: createKicadDRC } = await import(mjsPath);

const Module = await createKicadDRC({
    print: (text) => {},  // suppress stdout
    printErr: (text) => {},  // suppress stderr
    locateFile: (path) => resolve(__dirname, '../build-wasm-erc/', path),
});
console.log('[1/4] Module loaded.');

// Step 2: Load PCB
console.log('[2/4] Loading PCB file...');
const pcbContent = readFileSync(pcbPath, 'utf8');
const len = Module.lengthBytesUTF8(pcbContent) + 1;
const ptr = Module._malloc(len);
Module.stringToUTF8(pcbContent, ptr, len);
const loadResult = Module._kicad_load_pcb(ptr, 0);
Module._free(ptr);

assert(loadResult === 0, `kicad_load_pcb should return 0, got ${loadResult}`);
console.log('[2/4] PCB loaded.');

// Step 3: Get geometry JSON
console.log('[3/4] Extracting PCB geometry...');
const jsonPtr = Module._kicad_get_pcb_geometry();
assert(jsonPtr !== 0, 'kicad_get_pcb_geometry should return non-null pointer');

const jsonStr = Module.UTF8ToString(jsonPtr);
assert(jsonStr.length > 0, 'Geometry JSON should not be empty');

const geometry = JSON.parse(jsonStr);

// Step 4: Validate JSON structure
console.log('[4/4] Validating geometry JSON...');
console.log('  JSON size:', jsonStr.length, 'bytes');

// Format version
assert(geometry.format_version === 1, 'format_version should be 1');
assert(geometry.units === 'mm', 'units should be mm');

// Board outline
assert(geometry.board !== undefined, 'board object should exist');
assert(geometry.board.outline !== undefined, 'board.outline should exist');
assert(Array.isArray(geometry.board.outline.polygons), 'board.outline.polygons should be array');
assert(geometry.board.outline.polygons.length > 0, 'Should have at least one outline polygon');

const firstPoly = geometry.board.outline.polygons[0];
assert(Array.isArray(firstPoly.outline), 'First polygon should have outline array');
assert(firstPoly.outline.length > 3, `Board outline should have >3 vertices, got ${firstPoly.outline.length}`);
assert(Array.isArray(firstPoly.holes), 'First polygon should have holes array');

// Verify outline vertices are [x, y] pairs in mm range
const v0 = firstPoly.outline[0];
assert(Array.isArray(v0) && v0.length === 2, 'Outline vertices should be [x, y] pairs');
assert(typeof v0[0] === 'number' && typeof v0[1] === 'number', 'Vertex coordinates should be numbers');

// Board thickness
assert(typeof geometry.board.thickness_mm === 'number', 'board.thickness_mm should be a number');
assert(geometry.board.thickness_mm > 0, `board.thickness_mm should be > 0, got ${geometry.board.thickness_mm}`);
console.log('  Board thickness:', geometry.board.thickness_mm, 'mm');

// Stackup
assert(Array.isArray(geometry.stackup), 'stackup should be array');
assert(geometry.stackup.length > 0, 'stackup should have at least one layer');

const copperLayers = geometry.stackup.filter(l => l.type === 'copper');
assert(copperLayers.length >= 2, `Should have at least 2 copper layers, got ${copperLayers.length}`);
console.log('  Stackup layers:', geometry.stackup.length);
console.log('  Copper layers:', copperLayers.length);

// Verify stackup layer structure
for (const layer of geometry.stackup) {
    assert(typeof layer.type === 'string', `Layer type should be string, got ${typeof layer.type}`);
    assert(typeof layer.thickness_mm === 'number', `Layer thickness should be number`);
    assert(typeof layer.z_offset_mm === 'number', `Layer z_offset should be number`);
}

// Copper layer count
assert(typeof geometry.copper_layer_count === 'number', 'copper_layer_count should be number');
assert(geometry.copper_layer_count >= 2, `copper_layer_count should be >= 2, got ${geometry.copper_layer_count}`);

// Components
assert(Array.isArray(geometry.components), 'components should be array');
console.log('  Components:', geometry.components.length);

if (geometry.components.length > 0) {
    const comp = geometry.components[0];
    assert(typeof comp.reference === 'string', 'Component reference should be string');
    assert(typeof comp.position === 'object', 'Component position should be object');
    assert(typeof comp.position.x_mm === 'number', 'Component x_mm should be number');
    assert(typeof comp.position.y_mm === 'number', 'Component y_mm should be number');
    assert(typeof comp.rotation_deg === 'number', 'Component rotation should be number');
    assert(comp.side === 'top' || comp.side === 'bottom', `Component side should be top/bottom, got ${comp.side}`);
    assert(Array.isArray(comp.models), 'Component models should be array');

    // Print first few component references
    const refs = geometry.components.slice(0, 5).map(c => c.reference);
    console.log('  First components:', refs.join(', '));
}

// Print outline bounding box
if (firstPoly.outline.length > 0) {
    const xs = firstPoly.outline.map(p => p[0]);
    const ys = firstPoly.outline.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    console.log(`  Board extents: ${(maxX - minX).toFixed(2)} x ${(maxY - minY).toFixed(2)} mm`);
}

// Cleanup
Module._kicad_cleanup();

console.log();
console.log(`=== RESULT: ${failed === 0 ? 'PASS' : 'FAIL'} (${passed} passed, ${failed} failed) ===`);

if (failed > 0) {
    process.exit(1);
}
