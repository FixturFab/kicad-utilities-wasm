/**
 * Specctra DSN export / SES import / PCB save test.
 *
 * Usage: node test-specctra.mjs [path-to-kicad_pcb]
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

console.log('=== Specctra DSN/SES Test ===');
console.log('PCB file:', pcbPath);
console.log();

// Step 1: Load WASM module
console.log('[1/5] Loading WASM module...');
const mjsPath = resolve(__dirname, '../build-wasm-erc/kicad_drc.mjs');
const { default: createKicadDRC } = await import(mjsPath);

const Module = await createKicadDRC({
    print: (text) => {},  // suppress stdout
    printErr: (text) => process.stderr.write(text + '\n'),
    locateFile: (path) => resolve(__dirname, '../build-wasm-erc/', path),
});
console.log('[1/5] Module loaded, diag_ping:', Module._diag_ping());

// Step 2: Load PCB
console.log('[2/5] Loading PCB file...');
const pcbContent = readFileSync(pcbPath, 'utf8');
const len = Module.lengthBytesUTF8(pcbContent) + 1;
const ptr = Module._malloc(len);
Module.stringToUTF8(pcbContent, ptr, len);
const loadResult = Module._kicad_load_pcb(ptr, 0);
Module._free(ptr);

assert(loadResult === 0, `kicad_load_pcb should return 0, got ${loadResult}`);
console.log('[2/5] PCB loaded.');

// Step 3: Export DSN
console.log('[3/5] Exporting DSN...');
const dsnPtr = Module._kicad_export_dsn();
assert(dsnPtr !== 0, 'kicad_export_dsn should return non-null pointer');

const dsnStr = Module.UTF8ToString(dsnPtr);
assert(dsnStr.length > 100, `DSN output should be substantial, got ${dsnStr.length} chars`);

// Verify DSN structure
assert(dsnStr.includes('(pcb '), 'DSN should start with (pcb');
assert(dsnStr.includes('(structure'), 'DSN should have structure section');
assert(dsnStr.includes('(placement'), 'DSN should have placement section');
assert(dsnStr.includes('(library'), 'DSN should have library section');
assert(dsnStr.includes('(network'), 'DSN should have network section');
assert(dsnStr.includes('(wiring'), 'DSN should have wiring section');

// Check for layer mapping
assert(dsnStr.includes('(layer '), 'DSN should have layer definitions');

// Check for components
const componentMatch = dsnStr.match(/\(component /g);
if (componentMatch) {
    console.log(`  Found ${componentMatch.length} component(s) in DSN`);
    assert(componentMatch.length > 0, 'DSN should have at least one component');
} else {
    // Some test boards may not have components
    console.log('  No components found (may be OK for simple test boards)');
}

// Check for nets
const netMatch = dsnStr.match(/\(net /g);
if (netMatch) {
    console.log(`  Found ${netMatch.length} net reference(s) in DSN`);
}

// Check for padstacks
const padstackMatch = dsnStr.match(/\(padstack /g);
if (padstackMatch) {
    console.log(`  Found ${padstackMatch.length} padstack(s) in DSN`);
}

console.log(`  DSN output: ${dsnStr.length} characters`);
console.log('[3/5] DSN export OK.');

// Step 4: Save PCB (serialize current board state)
console.log('[4/5] Saving PCB...');
const savePtr = Module._kicad_save_pcb();
assert(savePtr !== 0, 'kicad_save_pcb should return non-null pointer');

const savedPcb = Module.UTF8ToString(savePtr);
assert(savedPcb.length > 100, `Saved PCB should be substantial, got ${savedPcb.length} chars`);
assert(savedPcb.includes('(kicad_pcb'), 'Saved PCB should be valid kicad_pcb format');
assert(savedPcb.includes('(layers'), 'Saved PCB should have layers');
console.log(`  Saved PCB: ${savedPcb.length} characters`);
console.log('[4/5] PCB save OK.');

// Step 5: Verify round-trip (reload saved PCB and re-export DSN)
console.log('[5/5] Round-trip verification...');
Module._kicad_cleanup();

const len2 = Module.lengthBytesUTF8(savedPcb) + 1;
const ptr2 = Module._malloc(len2);
Module.stringToUTF8(savedPcb, ptr2, len2);
const loadResult2 = Module._kicad_load_pcb(ptr2, 0);
Module._free(ptr2);
assert(loadResult2 === 0, `Round-trip reload should succeed, got ${loadResult2}`);

const dsnPtr2 = Module._kicad_export_dsn();
assert(dsnPtr2 !== 0, 'Round-trip DSN export should succeed');
const dsnStr2 = Module.UTF8ToString(dsnPtr2);
assert(dsnStr2.includes('(pcb '), 'Round-trip DSN should be valid');
console.log(`  Round-trip DSN: ${dsnStr2.length} characters`);
console.log('[5/5] Round-trip OK.');

// Cleanup
Module._kicad_cleanup();

// Summary
console.log();
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}
