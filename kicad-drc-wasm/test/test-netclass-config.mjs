/**
 * Stage 2d: Netclass Configuration API test.
 *
 * Tests that netclass definitions and assignments in kicad_configure_drc()
 * change DRC behavior by applying per-netclass clearance constraints.
 *
 * Uses samples/netclass-test.kicad_pcb which has:
 * - GND, VCC, SIG nets with 0.2mm wide tracks
 * - VCC↔GND close pair with 0.15mm edge-to-edge gap (x=112/112.35)
 * - SIG↔GND close pair with 0.15mm edge-to-edge gap (x=115/115.35)
 *
 * Usage: node test/test-netclass-config.mjs
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
    const result = Module._kicad_configure_drc(ptr);
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

function getViolationsOfType(results, type) {
    return (results?.violations || []).filter(v => v.type === type);
}

// Relaxed base settings that produce no clearance violations on their own
const relaxedBase = {
    design_settings: {
        min_clearance_mm: 0.05,
        min_track_width_mm: 0.05,
        copper_edge_clearance_mm: 0.0,
    },
    netclasses: {
        Default: { clearance_mm: 0.05 },
    },
};

// --- Tests ---

console.log('=== Netclass Configuration API Test ===\n');

await initModule();
console.log('Module loaded.\n');

const pcbPath = resolve(__dirname, '../samples/netclass-test.kicad_pcb');
const pcbContent = readFileSync(pcbPath, 'utf8');

// Test 1: Baseline with relaxed Default netclass
console.log('Test 1: Baseline - Default netclass clearance 0.05mm (gaps are 0.15mm)');
assertEq(loadPcb(pcbContent), 0, 'PCB should load');
assertEq(configureDrc(relaxedBase), 0, 'Config should succeed');
const baselineCount = runDrc();
const baselineClearance = getViolationsOfType(getDrcResults(), 'clearance');
console.log(`  Total: ${baselineCount}, clearance: ${baselineClearance.length}`);
assertEq(baselineClearance.length, 0, 'No clearance violations with 0.05mm Default netclass');

// Test 2: Power netclass with high clearance, VCC assigned
console.log('\nTest 2: Power netclass clearance=0.25mm, VCC assigned');
assertEq(loadPcb(pcbContent), 0, 'PCB reload');
assertEq(configureDrc({
    ...relaxedBase,
    netclasses: {
        Default: { clearance_mm: 0.05 },
        Power: { clearance_mm: 0.25 },
    },
    netclass_assignments: { VCC: ['Power'] },
}), 0, 'Config should succeed');
const powerHighCount = runDrc();
const powerHighClearance = getViolationsOfType(getDrcResults(), 'clearance');
console.log(`  Total: ${powerHighCount}, clearance: ${powerHighClearance.length}`);
assertEq(powerHighClearance.length, 1,
    'VCC→Power@0.25mm should cause 1 clearance violation (VCC-GND pair at 0.15mm gap)');

// Test 3: Lower Power clearance below gap
console.log('\nTest 3: Power netclass clearance=0.05mm (below gap)');
assertEq(loadPcb(pcbContent), 0, 'PCB reload');
assertEq(configureDrc({
    ...relaxedBase,
    netclasses: {
        Default: { clearance_mm: 0.05 },
        Power: { clearance_mm: 0.05 },
    },
    netclass_assignments: { VCC: ['Power'] },
}), 0, 'Config should succeed');
const powerLowCount = runDrc();
const powerLowClearance = getViolationsOfType(getDrcResults(), 'clearance');
console.log(`  Total: ${powerLowCount}, clearance: ${powerLowClearance.length}`);
assertEq(powerLowClearance.length, 0,
    'VCC→Power@0.05mm should have no clearance violations (gap 0.15mm > 0.05mm)');

// Test 4: Both VCC and GND assigned to Power
console.log('\nTest 4: Both VCC and GND assigned to Power netclass');
assertEq(loadPcb(pcbContent), 0, 'PCB reload');
assertEq(configureDrc({
    ...relaxedBase,
    netclasses: {
        Default: { clearance_mm: 0.05 },
        Power: { clearance_mm: 0.25 },
    },
    netclass_assignments: { VCC: ['Power'], GND: ['Power'] },
}), 0, 'Config should succeed');
const bothCount = runDrc();
const bothClearance = getViolationsOfType(getDrcResults(), 'clearance');
console.log(`  Total: ${bothCount}, clearance: ${bothClearance.length}`);
assertEq(bothClearance.length, 2,
    'VCC+GND→Power should cause 2 clearance violations (VCC-GND and SIG-GND pairs)');
assert(bothClearance.length > powerHighClearance.length,
    `Both-assigned (${bothClearance.length}) > VCC-only (${powerHighClearance.length})`);

// Test 5: Netclass pattern assignment
console.log('\nTest 5: Pattern-based assignment (VCC → Power)');
assertEq(loadPcb(pcbContent), 0, 'PCB reload');
assertEq(configureDrc({
    ...relaxedBase,
    netclasses: {
        Default: { clearance_mm: 0.05 },
        Power: { clearance_mm: 0.25 },
    },
    netclass_patterns: [{ pattern: 'VCC', netclass: 'Power' }],
}), 0, 'Config should succeed');
const patternCount = runDrc();
const patternClearance = getViolationsOfType(getDrcResults(), 'clearance');
console.log(`  Total: ${patternCount}, clearance: ${patternClearance.length}`);
assertEq(patternClearance.length, 1,
    'Pattern-matched VCC→Power should cause 1 clearance violation');

// Test 6: Default netclass clearance override affects all nets
console.log('\nTest 6: Default netclass clearance=0.25mm (affects all nets)');
assertEq(loadPcb(pcbContent), 0, 'PCB reload');
assertEq(configureDrc({
    design_settings: {
        min_clearance_mm: 0.05,
        min_track_width_mm: 0.05,
        copper_edge_clearance_mm: 0.0,
    },
    netclasses: { Default: { clearance_mm: 0.25 } },
}), 0, 'Config should succeed');
const defaultHighCount = runDrc();
const defaultHighClearance = getViolationsOfType(getDrcResults(), 'clearance');
console.log(`  Total: ${defaultHighCount}, clearance: ${defaultHighClearance.length}`);
assertEq(defaultHighClearance.length, 2,
    'Default@0.25mm should cause 2 clearance violations (both close pairs)');

// Test 7: Verify violation counts differ meaningfully between configs
console.log('\nTest 7: Violation count differences');
assert(baselineClearance.length < powerHighClearance.length,
    `Baseline clearance (${baselineClearance.length}) < VCC-Power (${powerHighClearance.length})`);
assert(powerHighClearance.length < bothClearance.length,
    `VCC-Power (${powerHighClearance.length}) < Both-Power (${bothClearance.length})`);
assertEq(bothClearance.length, defaultHighClearance.length,
    `Both-Power (${bothClearance.length}) == Default-high (${defaultHighClearance.length})`);

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
