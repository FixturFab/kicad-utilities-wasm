/**
 * Stage 6c: Invalid JSON handling test.
 *
 * Tests error handling for malformed JSON, unknown fields, out-of-range values,
 * and type mismatches in kicad_configure_drc() and kicad_configure_erc().
 *
 * Return codes:
 *   0  = success
 *  -1  = no board/schematic loaded
 *  -2  = null config pointer
 *  -3  = JSON parse error
 *  -4  = other exception
 *
 * Usage: node test/test-invalid-json.mjs
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

function configureDrcRaw(jsonStr) {
    const ptr = allocString(jsonStr);
    const result = Module._kicad_configure_drc(ptr, 0);
    Module._free(ptr);
    return result;
}

function configureDrc(config) {
    return configureDrcRaw(JSON.stringify(config));
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

function loadSchematic(content) {
    Module._kicad_cleanup_schematic();
    const ptr = allocString(content);
    const result = Module._kicad_load_schematic(ptr, 0);
    Module._free(ptr);
    return result;
}

function configureErcRaw(jsonStr) {
    const ptr = allocString(jsonStr);
    const result = Module._kicad_configure_erc(ptr, 0);
    Module._free(ptr);
    return result;
}

function configureErc(config) {
    return configureErcRaw(JSON.stringify(config));
}

function runErc() {
    return Module._kicad_run_erc();
}

function getErcResults() {
    const ptr = Module._kicad_get_erc_results();
    if (!ptr) return null;
    return JSON.parse(Module.UTF8ToString(ptr));
}

function allErcViolations(results) {
    const violations = [];
    for (const sheet of (results?.sheets || [])) {
        violations.push(...(sheet?.violations || []));
    }
    return violations;
}

// --- Tests ---

console.log('=== Invalid JSON Handling Tests (Stage 6c) ===\n');

await initModule();
console.log('Module loaded.\n');

const pcbPath = resolve(__dirname, '../samples/drc-config-test.kicad_pcb');
const pcbContent = readFileSync(pcbPath, 'utf8');

const schPath = resolve(__dirname, '../../samples/erc/with_errors.kicad_sch');
const schContent = readFileSync(schPath, 'utf8');

// =========================================================
// Test 1: Malformed JSON — DRC
// =========================================================
console.log('Test 1: Malformed JSON — DRC');

assertEq(loadPcb(pcbContent), 0, 'PCB load');

// Completely invalid JSON
assertEq(configureDrcRaw('not json at all'), -3, 'Plain text should return -3');
assertEq(configureDrcRaw('{invalid json}'), -3, 'Invalid JSON object should return -3');
assertEq(configureDrcRaw('{"unclosed": '), -3, 'Unclosed JSON should return -3');
assertEq(configureDrcRaw(''), -3, 'Empty string should return -3');
assertEq(configureDrcRaw('{{{'), -3, 'Triple braces should return -3');

// Valid JSON but not an object (array, number, string, null, boolean)
assertEq(configureDrcRaw('[]'), 0, 'Empty array is valid JSON — no fields to process, returns 0');
assertEq(configureDrcRaw('42'), 0, 'Number is valid JSON — no fields to process, returns 0');
assertEq(configureDrcRaw('"hello"'), 0, 'String is valid JSON — no fields to process, returns 0');
assertEq(configureDrcRaw('null'), 0, 'null is valid JSON — no fields to process, returns 0');
assertEq(configureDrcRaw('true'), 0, 'boolean is valid JSON — no fields to process, returns 0');

// =========================================================
// Test 2: Malformed JSON — ERC
// =========================================================
console.log('\nTest 2: Malformed JSON — ERC');

assertEq(loadSchematic(schContent), 0, 'Schematic load');

assertEq(configureErcRaw('not json at all'), -3, 'ERC: plain text should return -3');
assertEq(configureErcRaw('{bad}'), -3, 'ERC: invalid JSON should return -3');
assertEq(configureErcRaw(''), -3, 'ERC: empty string should return -3');

// =========================================================
// Test 3: Unknown fields in DRC config — silently ignored
// =========================================================
console.log('\nTest 3: Unknown fields — DRC');

assertEq(loadPcb(pcbContent), 0, 'PCB reload');

// Get baseline violation count
const baselineCount = runDrc();
assert(baselineCount > 0, `Baseline should have violations (got ${baselineCount})`);

// Configure with completely unknown top-level fields
assertEq(configureDrc({
    unknown_field: 'value',
    another_unknown: 42,
    nested_unknown: { foo: 'bar' }
}), 0, 'Unknown top-level fields should be silently ignored');

const afterUnknownCount = runDrc();
assertEq(afterUnknownCount, baselineCount,
    `Unknown fields should not change violations (${afterUnknownCount} vs ${baselineCount})`);

// =========================================================
// Test 4: Unknown fields inside design_settings
// =========================================================
console.log('\nTest 4: Unknown fields inside design_settings');

assertEq(loadPcb(pcbContent), 0, 'PCB reload');

assertEq(configureDrc({
    design_settings: {
        totally_fake_setting: 999,
        min_track_width_mm: 0.05,
        nonexistent_mm: 1.0,
    }
}), 0, 'Unknown design_settings fields should be ignored, known ones applied');

const afterPartialCount = runDrc();
const afterPartialTypes = countViolationsByType(getDrcResults());
assert(!afterPartialTypes['track_width'],
    'Known field (min_track_width_mm=0.05) should take effect — no track_width violations');

// =========================================================
// Test 5: Unknown severity names — silently ignored
// =========================================================
console.log('\nTest 5: Unknown severity names');

assertEq(loadPcb(pcbContent), 0, 'PCB reload');

assertEq(configureDrc({
    severities: {
        nonexistent_check: 'ignore',
        fake_check_type: 'error',
        clearance: 'ignore',
    }
}), 0, 'Unknown severity names should be ignored, known ones applied');

const afterSevCount = runDrc();
const afterSevTypes = countViolationsByType(getDrcResults());
assert(!afterSevTypes['clearance'], 'Known severity (clearance=ignore) should take effect');

// =========================================================
// Test 6: Invalid severity values — silently ignored
// =========================================================
console.log('\nTest 6: Invalid severity values');

assertEq(loadPcb(pcbContent), 0, 'PCB reload');

assertEq(configureDrc({
    severities: {
        track_width: 'not_a_severity',
        clearance: 'ERROR_UPPERCASE',
    }
}), 0, 'Invalid severity values should be silently ignored');

const afterBadSevCount = runDrc();
assertEq(afterBadSevCount, baselineCount,
    `Invalid severity values should not change violations (${afterBadSevCount} vs ${baselineCount})`);

// =========================================================
// Test 7: Unknown ERC severity and pin_map entries
// =========================================================
console.log('\nTest 7: Unknown ERC severity and pin_map entries');

assertEq(loadSchematic(schContent), 0, 'Schematic reload');

const ercBaseline = runErc();
assert(ercBaseline > 0, `ERC baseline should have violations (got ${ercBaseline})`);

assertEq(configureErc({
    severities: {
        fake_erc_check: 'ignore',
        nonexistent_check: 'warning',
    }
}), 0, 'Unknown ERC severity names should be silently ignored');

const ercAfterUnknown = runErc();
assertEq(ercAfterUnknown, ercBaseline,
    `Unknown ERC severities should not change violations (${ercAfterUnknown} vs ${ercBaseline})`);

// Unknown pin_map entries
assertEq(configureErc({
    pin_map: {
        fake_to_fake: 'error',
        input_to_nonexistent: 'warning',
        bad_format_no_to: 'ok',
    }
}), 0, 'Unknown pin_map entries should be silently ignored');

// =========================================================
// Test 8: Type mismatches in design_settings values
// =========================================================
console.log('\nTest 8: Type mismatches in design_settings');

assertEq(loadPcb(pcbContent), 0, 'PCB reload');

// String where number expected — nlohmann::json will throw on get<double>()
const typeMismatchResult = configureDrc({
    design_settings: {
        min_track_width_mm: 'not_a_number',
    }
});
// nlohmann::json throws type_error when calling get<double>() on a string
assertEq(typeMismatchResult, -3, 'String where number expected should return -3 (type error)');

// DRC should still work after type mismatch error
const afterTypeError = runDrc();
assertEq(afterTypeError, baselineCount,
    `DRC should still work after type error (${afterTypeError} vs ${baselineCount})`);

// =========================================================
// Test 9: Out-of-range values (negative, very large, zero)
// =========================================================
console.log('\nTest 9: Out-of-range values');

assertEq(loadPcb(pcbContent), 0, 'PCB reload');

// Negative value — should be accepted (KiCad doesn't validate range)
assertEq(configureDrc({
    design_settings: { min_track_width_mm: -1.0 }
}), 0, 'Negative mm value should be accepted (no range validation)');

// Very large value
assertEq(loadPcb(pcbContent), 0, 'PCB reload');
assertEq(configureDrc({
    design_settings: { min_track_width_mm: 999999.0 }
}), 0, 'Very large mm value should be accepted');

const veryLargeCount = runDrc();
const veryLargeTypes = countViolationsByType(getDrcResults());
assert(veryLargeTypes['track_width'] > 0,
    'Very large min_track_width should cause all tracks to violate');

// Zero value
assertEq(loadPcb(pcbContent), 0, 'PCB reload');
assertEq(configureDrc({
    design_settings: { min_track_width_mm: 0 }
}), 0, 'Zero mm value should be accepted');

const zeroCount = runDrc();
const zeroTypes = countViolationsByType(getDrcResults());
assert(!zeroTypes['track_width'], 'Zero min_track_width should cause no track_width violations');

// =========================================================
// Test 10: No board/schematic loaded — configure returns -1
// =========================================================
console.log('\nTest 10: No board/schematic loaded');

Module._kicad_cleanup();
assertEq(configureDrc({ design_settings: { min_track_width_mm: 0.1 } }), -1,
    'DRC configure without board should return -1');

Module._kicad_cleanup_schematic();
assertEq(configureErc({ severities: { pin_not_connected: 'ignore' } }), -1,
    'ERC configure without schematic should return -1');

// =========================================================
// Test 11: DRC still works correctly after error recovery
// =========================================================
console.log('\nTest 11: Recovery after errors');

assertEq(loadPcb(pcbContent), 0, 'PCB reload for recovery test');

// Trigger a JSON parse error
assertEq(configureDrcRaw('!!!'), -3, 'JSON parse error');

// Now configure validly — should still work
assertEq(configureDrc({
    design_settings: { min_track_width_mm: 0.05 }
}), 0, 'Valid config after error should succeed');

const recoveryCount = runDrc();
const recoveryTypes = countViolationsByType(getDrcResults());
assert(!recoveryTypes['track_width'],
    'After recovery, relaxed track_width should take effect');

// =========================================================
// Test 12: Netclass with unknown fields
// =========================================================
console.log('\nTest 12: Netclass with unknown fields');

assertEq(loadPcb(pcbContent), 0, 'PCB reload');

assertEq(configureDrc({
    netclasses: {
        Default: {
            clearance_mm: 0.05,
            fake_property_mm: 99.0,
        }
    }
}), 0, 'Unknown netclass fields should be silently ignored');

// =========================================================
// Test 13: Empty sub-objects
// =========================================================
console.log('\nTest 13: Empty sub-objects');

assertEq(loadPcb(pcbContent), 0, 'PCB reload');

assertEq(configureDrc({
    design_settings: {},
    netclasses: {},
    netclass_assignments: {},
    netclass_patterns: [],
    severities: {},
}), 0, 'All empty sub-objects should succeed');

const emptySubCount = runDrc();
assertEq(emptySubCount, baselineCount,
    `Empty sub-objects should not change violations (${emptySubCount} vs ${baselineCount})`);

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
