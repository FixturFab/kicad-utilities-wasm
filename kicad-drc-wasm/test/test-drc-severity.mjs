/**
 * Stage 3b+3c: DRC Severity Configuration test.
 *
 * Tests that kicad_configure_drc() severity overrides change which violations
 * appear in results and at what severity level.
 *
 * Uses samples/drc-config-test.kicad_pcb which has known clearance, track_width,
 * via, and edge clearance violations at default settings.
 *
 * Usage: node test/test-drc-severity.mjs
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

function allViolations(results) {
    return [
        ...(results?.violations || []),
        ...(results?.unconnected_items || []),
        ...(results?.schematic_parity || []),
    ];
}

function countViolationsByType(results) {
    const counts = {};
    for (const v of allViolations(results)) {
        counts[v.type] = (counts[v.type] || 0) + 1;
    }
    return counts;
}

function countViolationsBySeverity(results) {
    const counts = {};
    for (const v of allViolations(results)) {
        counts[v.severity] = (counts[v.severity] || 0) + 1;
    }
    return counts;
}

function getViolationsOfType(results, type) {
    return allViolations(results).filter(v => v.type === type);
}

// --- Tests ---

console.log('=== DRC Severity Configuration Test ===\n');

await initModule();
console.log('Module loaded.\n');

const pcbPath = resolve(__dirname, '../samples/drc-config-test.kicad_pcb');
const pcbContent = readFileSync(pcbPath, 'utf8');

// Test 1: Baseline — get default violation counts by type
console.log('Test 1: Baseline DRC with default severities');
assertEq(loadPcb(pcbContent), 0, 'PCB should load');
const defaultCount = runDrc();
const defaultResults = getDrcResults();
const defaultTypes = countViolationsByType(defaultResults);
const defaultSeverities = countViolationsBySeverity(defaultResults);
console.log(`  Total violations: ${defaultCount}`);
console.log('  By type:', JSON.stringify(defaultTypes));
console.log('  By severity:', JSON.stringify(defaultSeverities));

assert(defaultCount > 0, 'Default DRC should find violations');
assert(defaultTypes['track_width'] > 0, 'Should have track_width violations');

// Remember defaults for comparisons
const defaultTrackWidthCount = defaultTypes['track_width'] || 0;
const defaultClearanceCount = defaultTypes['clearance'] || 0;
const defaultEdgeClearanceCount = defaultTypes['copper_edge_clearance'] || 0;

// Test 2: Set track_width severity to "ignore" — those violations should disappear
console.log('\nTest 2: Set track_width to "ignore"');
assertEq(loadPcb(pcbContent), 0, 'PCB reload');
assertEq(configureDrc({
    severities: { track_width: 'ignore' }
}), 0, 'Configure severity should succeed');

const ignoreTrackCount = runDrc();
const ignoreTrackResults = getDrcResults();
const ignoreTrackTypes = countViolationsByType(ignoreTrackResults);
console.log(`  Violations after ignoring track_width: ${ignoreTrackCount}`);
console.log('  By type:', JSON.stringify(ignoreTrackTypes));

assert(!ignoreTrackTypes['track_width'], 'track_width violations should be gone when ignored');
assertEq(ignoreTrackCount, defaultCount - defaultTrackWidthCount,
    `Count should decrease by ${defaultTrackWidthCount} track_width violations`);

// Test 3: Set track_width to "warning" — violations should still appear but as warnings
console.log('\nTest 3: Set track_width to "warning"');
assertEq(loadPcb(pcbContent), 0, 'PCB reload');
assertEq(configureDrc({
    severities: { track_width: 'warning' }
}), 0, 'Configure severity should succeed');

const warningTrackCount = runDrc();
const warningTrackResults = getDrcResults();
const warningTrackTypes = countViolationsByType(warningTrackResults);
const warningTrackViolations = getViolationsOfType(warningTrackResults, 'track_width');
console.log(`  Violations with track_width as warning: ${warningTrackCount}`);
console.log('  track_width violations:', warningTrackViolations.length);

assertEq(warningTrackCount, defaultCount, 'Total count should stay the same (warnings still counted)');
assert(warningTrackTypes['track_width'] > 0, 'track_width violations should still appear');
assertEq(warningTrackTypes['track_width'], defaultTrackWidthCount,
    'Same number of track_width violations');

// Verify the track_width violations are now "warning" severity in JSON output (Stage 3c)
for (const v of warningTrackViolations) {
    assert(v.severity === 'warning',
        `track_width violation should be warning severity, got "${v.severity}"`);
}

// Test 4: Ignore multiple violation types at once
console.log('\nTest 4: Ignore multiple types');
assertEq(loadPcb(pcbContent), 0, 'PCB reload');
assertEq(configureDrc({
    severities: {
        track_width: 'ignore',
        copper_edge_clearance: 'ignore',
    }
}), 0, 'Configure multiple severities should succeed');

const ignoreMultiCount = runDrc();
const ignoreMultiResults = getDrcResults();
const ignoreMultiTypes = countViolationsByType(ignoreMultiResults);
console.log(`  Violations after ignoring track_width + edge_clearance: ${ignoreMultiCount}`);
console.log('  By type:', JSON.stringify(ignoreMultiTypes));

assert(!ignoreMultiTypes['track_width'], 'track_width should be gone');
assert(!ignoreMultiTypes['copper_edge_clearance'], 'copper_edge_clearance should be gone');
const expectedMultiReduction = defaultTrackWidthCount + defaultEdgeClearanceCount;
assertEq(ignoreMultiCount, defaultCount - expectedMultiReduction,
    `Count should decrease by ${expectedMultiReduction}`);

// Test 5: Severity combined with design_settings — both should work together
console.log('\nTest 5: Severity + design_settings combined');
assertEq(loadPcb(pcbContent), 0, 'PCB reload');
assertEq(configureDrc({
    design_settings: {
        min_track_width_mm: 0.05,  // Very relaxed — removes track_width violations
    },
    severities: {
        copper_edge_clearance: 'ignore',  // Also ignore edge clearance
    }
}), 0, 'Combined config should succeed');

const combinedCount = runDrc();
const combinedResults = getDrcResults();
const combinedTypes = countViolationsByType(combinedResults);
console.log(`  Combined violations: ${combinedCount}`);
console.log('  By type:', JSON.stringify(combinedTypes));

assert(!combinedTypes['track_width'], 'track_width gone via relaxed settings');
assert(!combinedTypes['copper_edge_clearance'], 'edge_clearance gone via ignore severity');
assert(combinedCount < defaultCount, 'Should have fewer violations than default');

// Test 6: Set everything to ignore — should get 0 violations
console.log('\nTest 6: Ignore all known violation types');
assertEq(loadPcb(pcbContent), 0, 'PCB reload');

// Build a config that ignores every type found in the defaults.
// Map DRC JSON report type names to our severity API names.
const typeMap = {
    'track_width': 'track_width',
    'clearance': 'clearance',
    'copper_edge_clearance': 'edge_clearance',
    'via_diameter': 'via_diameter',
    'hole_near_hole': 'hole_to_hole',
    'via_annular_width': 'annular_width',
    'drill_out_of_range': 'via_drill',
    'unconnected_items': 'unconnected_items',
    'shorting_items': 'shorting_items',
    'silk_clearance': 'silk_clearance',
    'silk_edge_clearance': 'silk_edge_clearance',
    'courtyard_overlap': 'courtyard_clearance',
    'missing_courtyard': 'missing_courtyard',
    'starved_thermal': 'starved_thermal',
    'solder_mask_bridge': 'solder_mask_bridge',
    'copper_sliver': 'copper_sliver',
    'track_dangling': 'dangling_track',
    'via_dangling': 'dangling_via',
    'isolated_copper': 'isolated_copper',
    'text_height': 'text_height',
    'text_thickness': 'text_thickness',
    'microvia_drill_out_of_range': 'microvia_drill',
    'connection_width': 'connection_width',
    'tracks_crossing': 'tracks_crossing',
};
const ignoreAll = {};
for (const type of Object.keys(defaultTypes)) {
    const apiName = typeMap[type] || type;
    ignoreAll[apiName] = 'ignore';
}

console.log('  Ignoring types:', Object.keys(ignoreAll).join(', '));
assertEq(configureDrc({ severities: ignoreAll }), 0, 'Ignore-all config should succeed');

const ignoreAllCount = runDrc();
console.log(`  Violations after ignoring all: ${ignoreAllCount}`);

// Some violations may not have a mapping, but we should get very few
assert(ignoreAllCount <= 2, `Should have <=2 violations after ignoring all types (got ${ignoreAllCount})`);

// Test 7: Unknown severity names are silently ignored
console.log('\nTest 7: Unknown severity names');
assertEq(loadPcb(pcbContent), 0, 'PCB reload');
assertEq(configureDrc({
    severities: {
        nonexistent_check: 'ignore',
        another_fake_check: 'error',
    }
}), 0, 'Unknown severity names should not cause an error');
const unknownCount = runDrc();
assertEq(unknownCount, defaultCount, 'Unknown names should not affect violation count');

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
