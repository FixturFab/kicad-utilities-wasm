/**
 * Stage 1c: DRC Configuration API test.
 *
 * Tests that kicad_configure_drc() changes DRC behavior by overriding
 * board design settings (min track width, via size, drill size, edge clearance).
 *
 * Uses samples/drc-config-test.kicad_pcb which has:
 * - Tracks at 0.1mm, 0.15mm, 0.2mm, 0.25mm widths
 * - Vias at 0.4mm/0.2mm, 0.5mm/0.25mm, 0.6mm/0.3mm (diameter/drill)
 * - Track pairs with 0.1mm and 0.15mm edge clearance
 * - Track 0.1mm from board edge
 *
 * Usage: node test/test-drc-config.mjs
 */
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

let testsPassed = 0;
let testsFailed = 0;
const failures = [];

function assert(condition, message) {
    if (condition) {
        testsPassed++;
    } else {
        testsFailed++;
        failures.push(message);
        console.error(`  FAIL: ${message}`);
    }
}

function assertEq(actual, expected, message) {
    if (actual === expected) {
        testsPassed++;
    } else {
        testsFailed++;
        const msg = `${message}: expected ${expected}, got ${actual}`;
        failures.push(msg);
        console.error(`  FAIL: ${msg}`);
    }
}

// --- WASM module helpers ---

let Module;

async function initModule() {
    const mjsPath = resolve(__dirname, '../build-wasm-erc/kicad_drc.mjs');
    const { default: createKicadDRC } = await import(mjsPath);
    Module = await createKicadDRC({
        print: () => {},
        printErr: () => {},
        locateFile: (path) => resolve(__dirname, '../build-wasm-erc/', path),
    });
}

function allocString(str) {
    const len = Module.lengthBytesUTF8(str) + 1;
    const ptr = Module._malloc(len);
    Module.stringToUTF8(str, ptr, len);
    return ptr;
}

function loadPcb(content) {
    const ptr = allocString(content);
    const result = Module._kicad_load_pcb(ptr, 0);
    Module._free(ptr);
    return result;
}

function configureDrc(config) {
    const json = JSON.stringify(config);
    const ptr = allocString(json);
    const result = Module._kicad_configure_drc(ptr, 0);
    Module._free(ptr);
    return result;
}

function runDrc() {
    return Module._kicad_run_drc();
}

function getDrcResults() {
    const ptr = Module._kicad_get_drc_results();
    if (!ptr) return null;
    return JSON.parse(Module.UTF8ToString(ptr));
}

function countViolationsByType(results) {
    const counts = {};
    for (const v of (results?.violations || [])) {
        counts[v.type] = (counts[v.type] || 0) + 1;
    }
    return counts;
}

// --- Tests ---

console.log('=== DRC Configuration API Test ===\n');

await initModule();
console.log('Module loaded.\n');

const pcbPath = resolve(__dirname, '../samples/drc-config-test.kicad_pcb');
const pcbContent = readFileSync(pcbPath, 'utf8');

// Test 1: Load PCB
console.log('Test 1: Load test PCB');
assertEq(loadPcb(pcbContent), 0, 'PCB should load successfully');

// Test 2: Run DRC with defaults
console.log('Test 2: DRC with default settings');
const defaultCount = runDrc();
assert(defaultCount > 0, `Default DRC should find violations (got ${defaultCount})`);
const defaultResults = getDrcResults();
assert(defaultResults !== null, 'Should get DRC results JSON');
const defaultTypes = countViolationsByType(defaultResults);
console.log(`  Default violations: ${defaultCount}`);
console.log('  Types:', JSON.stringify(defaultTypes));

// Verify specific expected violation types exist in defaults
assert(defaultTypes['track_width'] > 0, 'Default should have track_width violations');
assert(defaultTypes['copper_edge_clearance'] > 0, 'Default should have edge clearance violations');

// Test 3: Configure with relaxed settings
console.log('\nTest 3: DRC with relaxed settings');
const relaxedCfgResult = configureDrc({
    design_settings: {
        min_track_width_mm: 0.05,
        min_via_diameter_mm: 0.3,
        min_via_drill_mm: 0.1,
        copper_edge_clearance_mm: 0.05,
    }
});
assertEq(relaxedCfgResult, 0, 'Configure (relaxed) should return 0');

const relaxedCount = runDrc();
const relaxedResults = getDrcResults();
const relaxedTypes = countViolationsByType(relaxedResults);
console.log(`  Relaxed violations: ${relaxedCount}`);
console.log('  Types:', JSON.stringify(relaxedTypes));

assert(relaxedCount < defaultCount, `Relaxed (${relaxedCount}) should have fewer violations than default (${defaultCount})`);
assert(!relaxedTypes['track_width'], 'Relaxed should have no track_width violations');
assert(!relaxedTypes['copper_edge_clearance'], 'Relaxed should have no edge clearance violations');
assert(!relaxedTypes['via_diameter'], 'Relaxed should have no via_diameter violations');

// Test 4: Configure with strict settings
console.log('\nTest 4: DRC with strict settings');

// Reload PCB to reset state
assertEq(loadPcb(pcbContent), 0, 'PCB reload should succeed');

const strictCfgResult = configureDrc({
    design_settings: {
        min_track_width_mm: 0.25,
        min_via_diameter_mm: 0.6,
        min_via_drill_mm: 0.3,
        copper_edge_clearance_mm: 0.5,
    }
});
assertEq(strictCfgResult, 0, 'Configure (strict) should return 0');

const strictCount = runDrc();
const strictResults = getDrcResults();
const strictTypes = countViolationsByType(strictResults);
console.log(`  Strict violations: ${strictCount}`);
console.log('  Types:', JSON.stringify(strictTypes));

assert(strictCount > relaxedCount, `Strict (${strictCount}) should have more violations than relaxed (${relaxedCount})`);
assert(strictTypes['track_width'] > 0, 'Strict should have track_width violations');
assert(strictTypes['copper_edge_clearance'] > 0, 'Strict should have edge clearance violations');

// The strict config sets min_track_width to 0.25mm, so tracks at 0.1, 0.15, 0.2mm all violate
// That's the 0.1mm track + all five 0.15mm tracks + the 0.2mm track = more than default
assert(strictTypes['track_width'] >= defaultTypes['track_width'],
    `Strict track_width count (${strictTypes['track_width']}) >= default (${defaultTypes['track_width']})`);

// Test 5: Three configurations produce different violation counts
console.log('\nTest 5: All three configs produce different violation counts');
const allDifferent = (relaxedCount !== defaultCount) &&
                     (defaultCount !== strictCount) &&
                     (relaxedCount !== strictCount);
assert(allDifferent,
    `All three counts should be different: relaxed=${relaxedCount}, default=${defaultCount}, strict=${strictCount}`);
assert(relaxedCount < defaultCount && defaultCount <= strictCount,
    `Should be ordered: relaxed(${relaxedCount}) < default(${defaultCount}) <= strict(${strictCount})`);

// Test 6: Error handling
console.log('\nTest 6: Error handling');

// Null board
Module._kicad_cleanup();
const noBoard = configureDrc({ design_settings: { min_track_width_mm: 0.1 } });
assertEq(noBoard, -1, 'Configure without loaded board should return -1');

// Reload and test invalid JSON
assertEq(loadPcb(pcbContent), 0, 'PCB reload for error test');
const badJsonPtr = allocString('not valid json{{{');
const badResult = Module._kicad_configure_drc(badJsonPtr, 0);
Module._free(badJsonPtr);
assertEq(badResult, -3, 'Invalid JSON should return -3');

// Test 7: Partial configuration (only some fields)
console.log('\nTest 7: Partial configuration');
assertEq(loadPcb(pcbContent), 0, 'PCB reload for partial config test');

const partialResult = configureDrc({
    design_settings: {
        min_track_width_mm: 0.05,
    }
});
assertEq(partialResult, 0, 'Partial config should succeed');

const partialCount = runDrc();
const partialTypes = countViolationsByType(getDrcResults());
console.log(`  Partial config violations: ${partialCount}`);
assert(!partialTypes['track_width'], 'After relaxing track_width, no track_width violations');
assert(partialTypes['copper_edge_clearance'] > 0, 'Edge clearance violations should remain (not overridden)');

// Test 8: Empty config (no changes)
console.log('\nTest 8: Empty config');
assertEq(loadPcb(pcbContent), 0, 'PCB reload for empty config test');

const emptyResult = configureDrc({});
assertEq(emptyResult, 0, 'Empty config should succeed');

const emptyCount = runDrc();
assertEq(emptyCount, defaultCount, `Empty config should match default count (${defaultCount})`);

// --- Summary ---
console.log(`\n=== Results: ${testsPassed} passed, ${testsFailed} failed ===`);

if (testsFailed > 0) {
    console.log('\nFailures:');
    for (const f of failures) {
        console.log(`  - ${f}`);
    }
    process.exit(1);
} else {
    console.log('\nAll tests passed.');
}
