/**
 * Stage 4c: ERC Configuration API test.
 *
 * Tests that kicad_configure_erc() changes ERC behavior by overriding
 * severity settings and pin conflict matrix.
 *
 * Uses samples/erc/with_errors.kicad_sch which has known violations:
 * - power_pin_not_driven: 1
 * - wire_dangling: 1
 * - pin_not_connected: 5
 * - missing_unit: 1 (warning)
 * - missing_power_pin: 1
 *
 * Usage: node test/test-erc-config.mjs
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

function loadSchematic(content) {
    Module._kicad_cleanup_schematic();
    const ptr = allocString(content);
    const result = Module._kicad_load_schematic(ptr, 0);
    Module._free(ptr);
    return result;
}

function configureErc(config) {
    const json = JSON.stringify(config);
    const ptr = allocString(json);
    const result = Module._kicad_configure_erc(ptr, 0);
    Module._free(ptr);
    return result;
}

function runErc() {
    return Module._kicad_run_erc();
}

function getErcResults() {
    const ptr = Module._kicad_get_erc_results();
    if (!ptr) return null;
    return JSON.parse(Module.UTF8ToString(ptr));
}

function allViolations(results) {
    const violations = [];
    for (const sheet of (results?.sheets || [])) {
        violations.push(...(sheet?.violations || []));
    }
    return violations;
}

function countViolationsByType(results) {
    const counts = {};
    for (const v of allViolations(results)) {
        counts[v.type] = (counts[v.type] || 0) + 1;
    }
    return counts;
}

function getViolationsOfType(results, type) {
    return allViolations(results).filter(v => v.type === type);
}

// --- Tests ---

console.log('=== ERC Configuration API Test ===\n');

await initModule();
console.log('Module loaded.\n');

const schPath = resolve(__dirname, '../../samples/erc/with_errors.kicad_sch');
const schContent = readFileSync(schPath, 'utf8');

// Test 1: Baseline — get default violations
console.log('Test 1: Baseline ERC with default severities');
assertEq(loadSchematic(schContent), 0, 'Schematic should load');
const defaultCount = runErc();
const defaultResults = getErcResults();
const defaultTypes = countViolationsByType(defaultResults);
console.log(`  Total violations: ${defaultCount}`);
console.log('  By type:', JSON.stringify(defaultTypes));

assert(defaultCount > 0, 'Default ERC should find violations');
assertEq(defaultCount, 9, 'Should have 9 violations');

const defaultPinNotConnected = defaultTypes['pin_not_connected'] || 0;
const defaultWireDangling = defaultTypes['wire_dangling'] || 0;

// Test 2: Set pin_not_connected to "ignore" — those violations should disappear
console.log('\nTest 2: Set pin_not_connected to "ignore"');
assertEq(loadSchematic(schContent), 0, 'Schematic reload');
assertEq(configureErc({
    severities: { pin_not_connected: 'ignore' }
}), 0, 'Configure severity should succeed');

const ignorePinCount = runErc();
const ignorePinResults = getErcResults();
const ignorePinTypes = countViolationsByType(ignorePinResults);
console.log(`  Violations after ignoring pin_not_connected: ${ignorePinCount}`);
console.log('  By type:', JSON.stringify(ignorePinTypes));

assert(!ignorePinTypes['pin_not_connected'], 'pin_not_connected violations should be gone');
assertEq(ignorePinCount, defaultCount - defaultPinNotConnected,
    `Count should decrease by ${defaultPinNotConnected}`);

// Test 3: Set pin_not_connected to "warning" — violations should still appear as warnings
console.log('\nTest 3: Set pin_not_connected to "warning"');
assertEq(loadSchematic(schContent), 0, 'Schematic reload');
assertEq(configureErc({
    severities: { pin_not_connected: 'warning' }
}), 0, 'Configure severity should succeed');

const warningPinCount = runErc();
const warningPinResults = getErcResults();
const warningPinViolations = getViolationsOfType(warningPinResults, 'pin_not_connected');
console.log(`  Violations with pin_not_connected as warning: ${warningPinCount}`);
console.log('  pin_not_connected violations:', warningPinViolations.length);

assertEq(warningPinCount, defaultCount, 'Total count should stay the same');
assertEq(warningPinViolations.length, defaultPinNotConnected, 'Same number of pin_not_connected');

// Verify severity is "warning" in JSON output
for (const v of warningPinViolations) {
    assert(v.severity === 'warning',
        `pin_not_connected should be warning, got "${v.severity}"`);
}

// Test 4: Ignore multiple types
console.log('\nTest 4: Ignore multiple types');
assertEq(loadSchematic(schContent), 0, 'Schematic reload');
assertEq(configureErc({
    severities: {
        pin_not_connected: 'ignore',
        wire_dangling: 'ignore',
    }
}), 0, 'Configure multiple severities should succeed');

const ignoreMultiCount = runErc();
const ignoreMultiTypes = countViolationsByType(getErcResults());
console.log(`  Violations after ignoring pin_not_connected + wire_dangling: ${ignoreMultiCount}`);
console.log('  By type:', JSON.stringify(ignoreMultiTypes));

assert(!ignoreMultiTypes['pin_not_connected'], 'pin_not_connected should be gone');
assert(!ignoreMultiTypes['wire_dangling'], 'wire_dangling should be gone');
assertEq(ignoreMultiCount, defaultCount - defaultPinNotConnected - defaultWireDangling,
    'Count should decrease by both types');

// Test 5: Error handling
console.log('\nTest 5: Error handling');

// No schematic loaded
Module._kicad_cleanup_schematic();
const noSchematic = configureErc({ severities: { pin_not_connected: 'ignore' } });
assertEq(noSchematic, -1, 'Configure without loaded schematic should return -1');

// Invalid JSON
assertEq(loadSchematic(schContent), 0, 'Schematic reload for error test');
const badJsonPtr = allocString('not valid json{{{');
const badResult = Module._kicad_configure_erc(badJsonPtr, 0);
Module._free(badJsonPtr);
assertEq(badResult, -3, 'Invalid JSON should return -3');

// Test 6: Empty config (no changes)
console.log('\nTest 6: Empty config');
assertEq(loadSchematic(schContent), 0, 'Schematic reload');
assertEq(configureErc({}), 0, 'Empty config should succeed');
const emptyCount = runErc();
assertEq(emptyCount, defaultCount, 'Empty config should match default count');

// Test 7: Unknown severity names silently ignored
console.log('\nTest 7: Unknown severity names');
assertEq(loadSchematic(schContent), 0, 'Schematic reload');
assertEq(configureErc({
    severities: {
        nonexistent_check: 'ignore',
        another_fake: 'error',
    }
}), 0, 'Unknown names should not cause error');
const unknownCount = runErc();
assertEq(unknownCount, defaultCount, 'Unknown names should not affect count');

// Test 8: Ignore all known violation types
console.log('\nTest 8: Ignore all known types');
assertEq(loadSchematic(schContent), 0, 'Schematic reload');

// Map ERC JSON report type names to our severity API names
const typeMap = {
    'pin_not_connected': 'pin_not_connected',
    'pin_not_driven': 'pin_not_driven',
    'power_pin_not_driven': 'powerpin_not_driven',
    'wire_dangling': 'wire_dangling',
    'missing_unit': 'missing_unit',
    'missing_power_pin': 'missing_power_pin',
    'missing_input_pin': 'missing_input_pin',
    'missing_bidi_pin': 'missing_bidi_pin',
    'duplicate_sheet_name': 'duplicate_sheet_name',
    'endpoint_off_grid': 'endpoint_off_grid',
    'noconnect_connected': 'noconnect_connected',
    'noconnect_not_connected': 'noconnect_not_connected',
    'label_not_connected': 'label_not_connected',
    'similar_labels': 'similar_labels',
    'different_unit_footprint': 'different_unit_footprint',
    'different_unit_net': 'different_unit_net',
    'different_unit_value': 'different_unit_value',
    'unresolved_variable': 'unresolved_variable',
    'undefined_netclass': 'undefined_netclass',
    'unannotated': 'unannotated',
    'extra_units': 'extra_units',
    'duplicate_reference': 'duplicate_reference',
    'four_way_junction': 'four_way_junction',
    'hier_label_mismatch': 'hierachical_label',
};
const ignoreAll = {};
for (const type of Object.keys(defaultTypes)) {
    const apiName = typeMap[type] || type;
    ignoreAll[apiName] = 'ignore';
}

console.log('  Ignoring types:', Object.keys(ignoreAll).join(', '));
assertEq(configureErc({ severities: ignoreAll }), 0, 'Ignore-all should succeed');
const ignoreAllCount = runErc();
console.log(`  Violations after ignoring all: ${ignoreAllCount}`);
assertEq(ignoreAllCount, 0, 'Should have 0 violations after ignoring all');

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
