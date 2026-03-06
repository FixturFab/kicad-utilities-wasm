/**
 * Stage 6e: Netclass priority test.
 *
 * Tests that when a net has multiple netclass assignments, the correct
 * precedence rules apply:
 * - Lower priority number = higher precedence (wins)
 * - Default netclass has lowest priority (fallback for unset parameters)
 * - Same priority: alphabetically earlier name wins
 * - Non-conflicting parameters from multiple netclasses all apply
 * - Label + pattern assignments both contribute to resolved netclasses
 *
 * Uses samples/netclass-test.kicad_pcb which has:
 * - GND, VCC, SIG nets with 0.2mm wide tracks
 * - VCC↔GND close pair with 0.15mm edge-to-edge gap (x=112/112.35)
 * - SIG↔GND close pair with 0.15mm edge-to-edge gap (x=115/115.35)
 *
 * Usage: node test/test-netclass-priority.mjs
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

// Relaxed base that produces no clearance/track violations
const relaxedBase = {
    design_settings: {
        min_clearance_mm: 0.05,
        min_track_width_mm: 0.05,
        copper_edge_clearance_mm: 0.0,
    },
};

// --- Tests ---

console.log('=== Netclass Priority Tests ===\n');

await initModule();
console.log('Module loaded.\n');

const pcbPath = resolve(__dirname, '../samples/netclass-test.kicad_pcb');
const pcbContent = readFileSync(pcbPath, 'utf8');

// =========================================================
// Test 1: Single netclass — baseline behavior
// =========================================================
console.log('Test 1: Single netclass assignment — VCC → Power (strict clearance)');
assertEq(loadPcb(pcbContent), 0, 'PCB load');
assertEq(configureDrc({
    ...relaxedBase,
    netclasses: {
        Default: { clearance_mm: 0.05 },
        Power: { clearance_mm: 0.25 },
    },
    netclass_assignments: { VCC: ['Power'] },
}), 0, 'Config should succeed');
const test1Count = runDrc();
const test1Clearance = getViolationsOfType(getDrcResults(), 'clearance');
console.log(`  Clearance violations: ${test1Clearance.length}`);
assertEq(test1Clearance.length, 1,
    'Single Power@0.25mm on VCC → 1 clearance violation (VCC-GND pair at 0.15mm)');

// =========================================================
// Test 2: Two netclasses with conflicting clearance — alphabetical tiebreak
// Both "AStrict" and "BRelaxed" have priority -1 (default for new netclasses).
// At same priority, alphabetically earlier name wins ("AStrict" < "BRelaxed").
// =========================================================
console.log('\nTest 2: Two netclasses, same priority, alphabetical tiebreak');
assertEq(loadPcb(pcbContent), 0, 'PCB load');
assertEq(configureDrc({
    ...relaxedBase,
    netclasses: {
        Default: { clearance_mm: 0.05 },
        AStrict: { clearance_mm: 0.25 },   // strict — would cause violation
        BRelaxed: { clearance_mm: 0.05 },   // relaxed — would not cause violation
    },
    netclass_assignments: { VCC: ['AStrict', 'BRelaxed'] },
}), 0, 'Config with dual assignment');
const test2Count = runDrc();
const test2Clearance = getViolationsOfType(getDrcResults(), 'clearance');
console.log(`  Clearance violations: ${test2Clearance.length}`);
// "AStrict" is alphabetically earlier → its clearance (0.25mm) wins → 1 violation
assertEq(test2Clearance.length, 1,
    'Alphabetically earlier AStrict wins — 0.25mm clearance → 1 violation');

// =========================================================
// Test 3: Reverse alphabetical order — "XRelaxed" before "YStrict"
// "XRelaxed" is alphabetically earlier, so its relaxed clearance should win.
// =========================================================
console.log('\nTest 3: Reverse alphabetical — relaxed name wins');
assertEq(loadPcb(pcbContent), 0, 'PCB load');
assertEq(configureDrc({
    ...relaxedBase,
    netclasses: {
        Default: { clearance_mm: 0.05 },
        XRelaxed: { clearance_mm: 0.05 },  // relaxed — would not cause violation
        YStrict: { clearance_mm: 0.25 },    // strict — would cause violation
    },
    netclass_assignments: { VCC: ['XRelaxed', 'YStrict'] },
}), 0, 'Config with reverse-alpha dual assignment');
const test3Count = runDrc();
const test3Clearance = getViolationsOfType(getDrcResults(), 'clearance');
console.log(`  Clearance violations: ${test3Clearance.length}`);
// "XRelaxed" alphabetically earlier → its clearance (0.05mm) wins → 0 violations
assertEq(test3Clearance.length, 0,
    'Alphabetically earlier XRelaxed wins — 0.05mm clearance → 0 violations');

// =========================================================
// Test 4: One netclass with clearance set, another without
// "WithClearance" sets clearance, "NoClearance" has no clearance.
// The effective netclass should use WithClearance's value since
// NoClearance doesn't provide one.
// =========================================================
console.log('\nTest 4: Netclass with clearance + netclass without clearance');
assertEq(loadPcb(pcbContent), 0, 'PCB load');
assertEq(configureDrc({
    ...relaxedBase,
    netclasses: {
        Default: { clearance_mm: 0.05 },
        NoClearance: { via_diameter_mm: 0.8 },    // no clearance set
        WithClearance: { clearance_mm: 0.25 },     // strict clearance
    },
    netclass_assignments: { VCC: ['NoClearance', 'WithClearance'] },
}), 0, 'Config with one netclass providing clearance');
const test4Count = runDrc();
const test4Results = getDrcResults();
const test4Clearance = getViolationsOfType(test4Results, 'clearance');
console.log(`  Clearance violations: ${test4Clearance.length}`);
// WithClearance's clearance (0.25mm) should apply since NoClearance has no clearance
assertEq(test4Clearance.length, 1,
    'WithClearance 0.25mm applies (NoClearance has none) → 1 violation');

// =========================================================
// Test 5: Specific netclass overrides Default for assigned net
// Default has strict clearance, but assigned net's netclass has relaxed clearance.
// =========================================================
console.log('\nTest 5: Specific netclass overrides Default');
assertEq(loadPcb(pcbContent), 0, 'PCB load');
assertEq(configureDrc({
    ...relaxedBase,
    netclasses: {
        Default: { clearance_mm: 0.25 },    // strict Default
        Relaxed: { clearance_mm: 0.05 },     // relaxed specific
    },
    netclass_assignments: { VCC: ['Relaxed'] },
}), 0, 'Config with Default strict, Relaxed specific');
const test5Count = runDrc();
const test5Clearance = getViolationsOfType(getDrcResults(), 'clearance');
console.log(`  Clearance violations: ${test5Clearance.length}`);
// VCC has Relaxed netclass (0.05mm) → VCC-GND pair should NOT violate from VCC side
// GND has Default (0.25mm) → SIG-GND pair AND VCC-GND pair may violate from GND side
// The effective clearance between two nets is the max of both nets' netclass clearances
// (clearance check uses the stricter of the two endpoints)
assert(test5Clearance.length >= 1,
    'Default@0.25mm on GND → at least 1 clearance violation (GND-adjacent pairs)');

// Compare with all-Default strict
assertEq(loadPcb(pcbContent), 0, 'PCB reload');
assertEq(configureDrc({
    ...relaxedBase,
    netclasses: { Default: { clearance_mm: 0.25 } },
}), 0, 'All nets strict Default');
const test5bCount = runDrc();
const test5bClearance = getViolationsOfType(getDrcResults(), 'clearance');
console.log(`  All-Default strict clearance violations: ${test5bClearance.length}`);
assertEq(test5bClearance.length, 2,
    'All-Default@0.25mm → 2 clearance violations (both close pairs)');
// The assigned-Relaxed case should have same or fewer violations as all-Default
assert(test5Clearance.length <= test5bClearance.length,
    `Relaxed on VCC (${test5Clearance.length}) <= all-Default (${test5bClearance.length})`);

// =========================================================
// Test 6: Label + pattern both contribute netclasses
// VCC assigned to "LabelClass" via label, also matches "PatternClass" via pattern.
// Both resolve for VCC. "LabelClass" < "PatternClass" alphabetically → LabelClass wins.
// =========================================================
console.log('\nTest 6: Label + pattern both contribute netclasses');
assertEq(loadPcb(pcbContent), 0, 'PCB load');
assertEq(configureDrc({
    ...relaxedBase,
    netclasses: {
        Default: { clearance_mm: 0.05 },
        LabelClass: { clearance_mm: 0.05 },      // relaxed clearance (label)
        PatternClass: { clearance_mm: 0.25 },     // strict clearance (pattern)
    },
    netclass_assignments: { VCC: ['LabelClass'] },
    netclass_patterns: [{ pattern: 'VCC', netclass: 'PatternClass' }],
}), 0, 'Config with label + pattern');
const test6Count = runDrc();
const test6Results = getDrcResults();
const test6Clearance = getViolationsOfType(test6Results, 'clearance');
console.log(`  Clearance violations: ${test6Clearance.length}`);
// Both LabelClass and PatternClass resolve for VCC.
// "LabelClass" is alphabetically earlier → its clearance (0.05mm) wins → 0 violations
assertEq(test6Clearance.length, 0,
    'LabelClass (alpha-first) clearance 0.05mm wins over PatternClass 0.25mm → 0 violations');

// =========================================================
// Test 7: Unassigned net falls back to Default netclass
// Only VCC is assigned to a custom netclass; GND and SIG use Default.
// =========================================================
console.log('\nTest 7: Unassigned nets use Default netclass');
assertEq(loadPcb(pcbContent), 0, 'PCB load');
assertEq(configureDrc({
    ...relaxedBase,
    netclasses: {
        Default: { clearance_mm: 0.25 },    // strict Default → violations on unassigned nets
        CustomRelaxed: { clearance_mm: 0.05 },
    },
    netclass_assignments: { VCC: ['CustomRelaxed'] },
}), 0, 'Config with VCC relaxed, Default strict');
const test7Count = runDrc();
const test7Clearance = getViolationsOfType(getDrcResults(), 'clearance');
console.log(`  Clearance violations: ${test7Clearance.length}`);
// GND and SIG use Default@0.25mm, so:
// - SIG-GND pair at 0.15mm → clearance violation (both use Default)
// - VCC-GND pair: VCC uses CustomRelaxed@0.05, GND uses Default@0.25 → violation from GND side
assert(test7Clearance.length >= 1,
    'Unassigned nets use Default@0.25mm → clearance violations');

// Now assign GND to CustomRelaxed too — should reduce VCC-GND violations
assertEq(loadPcb(pcbContent), 0, 'PCB reload');
assertEq(configureDrc({
    ...relaxedBase,
    netclasses: {
        Default: { clearance_mm: 0.25 },
        CustomRelaxed: { clearance_mm: 0.05 },
    },
    netclass_assignments: { VCC: ['CustomRelaxed'], GND: ['CustomRelaxed'] },
}), 0, 'VCC+GND both relaxed');
runDrc();
const test7bResults = getDrcResults();
const test7bClear = getViolationsOfType(test7bResults, 'clearance');
console.log(`  VCC+GND relaxed clearance violations: ${test7bClear.length}`);
// VCC-GND pair: both CustomRelaxed@0.05mm → no violation
// SIG-GND pair: SIG uses Default@0.25mm, GND uses CustomRelaxed@0.05mm → violation from SIG side
// So fewer violations than test 7
assert(test7bClear.length < test7Clearance.length || test7bClear.length <= 1,
    'More relaxed assignments → fewer or equal violations');

// =========================================================
// Test 8: Three netclasses on one net — alphabetical tiebreak among all
// =========================================================
console.log('\nTest 8: Three netclasses with same priority');
assertEq(loadPcb(pcbContent), 0, 'PCB load');
assertEq(configureDrc({
    ...relaxedBase,
    netclasses: {
        Default: { clearance_mm: 0.05 },
        AAFirst: { clearance_mm: 0.25 },    // alphabetically first → wins clearance
        BBMiddle: { clearance_mm: 0.10 },
        CCLast: { clearance_mm: 0.05 },
    },
    netclass_assignments: { VCC: ['AAFirst', 'BBMiddle', 'CCLast'] },
}), 0, 'Config with three netclasses');
const test8Count = runDrc();
const test8Clearance = getViolationsOfType(getDrcResults(), 'clearance');
console.log(`  Clearance violations: ${test8Clearance.length}`);
// AAFirst (0.25mm) wins → clearance violation (VCC-GND at 0.15mm gap)
assertEq(test8Clearance.length, 1,
    'AAFirst@0.25mm wins among three netclasses → 1 violation');

// =========================================================
// Test 9: Pattern-only assignment (no label) — single netclass via pattern
// =========================================================
console.log('\nTest 9: Pattern-only assignment');
assertEq(loadPcb(pcbContent), 0, 'PCB load');
assertEq(configureDrc({
    ...relaxedBase,
    netclasses: {
        Default: { clearance_mm: 0.05 },
        PowerPattern: { clearance_mm: 0.25 },
    },
    netclass_patterns: [
        { pattern: 'VCC', netclass: 'PowerPattern' },
        { pattern: 'GND', netclass: 'PowerPattern' },
    ],
}), 0, 'Config with pattern-only assignments');
const test9Count = runDrc();
const test9Clearance = getViolationsOfType(getDrcResults(), 'clearance');
console.log(`  Clearance violations: ${test9Clearance.length}`);
// Both VCC and GND get PowerPattern@0.25mm
// VCC-GND pair → violation (both strict)
// SIG-GND pair → violation (GND is strict)
assertEq(test9Clearance.length, 2,
    'Pattern assigns VCC+GND to strict netclass → 2 clearance violations');

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
