/**
 * Stage 6d: Partial configuration test.
 *
 * Verifies that when only some fields are overridden in a configuration,
 * all other fields retain their PCB/schematic-embedded defaults.
 *
 * Uses samples/drc-config-test.kicad_pcb and samples/erc/with_errors.kicad_sch.
 *
 * Usage: node test/test-partial-config.mjs
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

function allErcViolations(results) {
    const violations = [];
    for (const sheet of (results?.sheets || [])) {
        violations.push(...(sheet?.violations || []));
    }
    return violations;
}

function countErcViolationsByType(results) {
    const counts = {};
    for (const v of allErcViolations(results)) {
        counts[v.type] = (counts[v.type] || 0) + 1;
    }
    return counts;
}

// --- Tests ---

console.log('=== Partial Configuration Tests ===\n');

await initModule();
console.log('Module loaded.\n');

const pcbPath = resolve(__dirname, '../samples/drc-config-test.kicad_pcb');
const pcbContent = readFileSync(pcbPath, 'utf8');

const netclassPcbPath = resolve(__dirname, '../samples/netclass-test.kicad_pcb');
const netclassPcbContent = readFileSync(netclassPcbPath, 'utf8');

const schPath = resolve(__dirname, '../../samples/erc/with_errors.kicad_sch');
const schContent = readFileSync(schPath, 'utf8');

// =========================================================
// Capture baselines
// =========================================================
console.log('Capturing baselines...');

assertEq(loadPcb(pcbContent), 0, 'PCB load for DRC baseline');
const drcBaselineCount = runDrc();
const drcBaselineResults = getDrcResults();
const drcBaselineTypes = countViolationsByType(drcBaselineResults);
console.log(`  DRC baseline: ${drcBaselineCount} violations`);
console.log('  Types:', JSON.stringify(drcBaselineTypes));

assertEq(loadSchematic(schContent), 0, 'Schematic load for ERC baseline');
const ercBaselineCount = runErc();
const ercBaselineResults = getErcResults();
const ercBaselineTypes = countErcViolationsByType(ercBaselineResults);
console.log(`  ERC baseline: ${ercBaselineCount} violations`);
console.log('  Types:', JSON.stringify(ercBaselineTypes));

// =========================================================
// Test 1: Override only min_track_width — other design_settings keep defaults
// =========================================================
console.log('\nTest 1: Override only min_track_width_mm');

assertEq(loadPcb(pcbContent), 0, 'PCB load');
assertEq(configureDrc({
    design_settings: {
        min_track_width_mm: 0.05,  // Very relaxed — removes track_width violations
    }
}), 0, 'Partial design_settings config');

const test1Count = runDrc();
const test1Types = countViolationsByType(getDrcResults());
console.log(`  Violations: ${test1Count}`);
console.log('  Types:', JSON.stringify(test1Types));

// Track width violations should disappear
assert(!test1Types['track_width'], 'track_width violations removed by override');
// Edge clearance violations should remain (we didn't override copper_edge_clearance_mm)
assertEq(test1Types['copper_edge_clearance'], drcBaselineTypes['copper_edge_clearance'],
    'copper_edge_clearance unchanged (not overridden)');
// Via violations should remain (we didn't override via settings)
assertEq(test1Types['via_diameter'] || 0, drcBaselineTypes['via_diameter'] || 0,
    'via_diameter unchanged (not overridden)');
// Total should decrease by exactly the track_width violations
assertEq(test1Count, drcBaselineCount - (drcBaselineTypes['track_width'] || 0),
    'Total should decrease by track_width violation count only');

// =========================================================
// Test 2: Override only copper_edge_clearance — other fields keep defaults
// =========================================================
console.log('\nTest 2: Override only copper_edge_clearance_mm');

assertEq(loadPcb(pcbContent), 0, 'PCB load');
assertEq(configureDrc({
    design_settings: {
        copper_edge_clearance_mm: 0.01,  // Very relaxed — removes edge clearance violations
    }
}), 0, 'Partial edge clearance config');

const test2Count = runDrc();
const test2Types = countViolationsByType(getDrcResults());
console.log(`  Violations: ${test2Count}`);

// Edge clearance should disappear
assert(!test2Types['copper_edge_clearance'], 'edge clearance violations removed');
// Track width should remain at baseline
assertEq(test2Types['track_width'] || 0, drcBaselineTypes['track_width'] || 0,
    'track_width unchanged (not overridden)');
assertEq(test2Count, drcBaselineCount - (drcBaselineTypes['copper_edge_clearance'] || 0),
    'Total should decrease by edge_clearance count only');

// =========================================================
// Test 3: Override only severities — design_settings keep PCB defaults
// =========================================================
console.log('\nTest 3: Override only severities (no design_settings)');

assertEq(loadPcb(pcbContent), 0, 'PCB load');
assertEq(configureDrc({
    severities: {
        track_width: 'ignore',
    }
}), 0, 'Severity-only config');

const test3Count = runDrc();
const test3Types = countViolationsByType(getDrcResults());
console.log(`  Violations: ${test3Count}`);

// track_width ignored in output
assert(!test3Types['track_width'], 'track_width filtered by severity');
// All other violation types should match baseline counts
assertEq(test3Types['copper_edge_clearance'] || 0, drcBaselineTypes['copper_edge_clearance'] || 0,
    'copper_edge_clearance unchanged by severity override');
assertEq(test3Types['via_diameter'] || 0, drcBaselineTypes['via_diameter'] || 0,
    'via_diameter unchanged by severity override');
assertEq(test3Count, drcBaselineCount - (drcBaselineTypes['track_width'] || 0),
    'Total decrease equals ignored track_width count');

// =========================================================
// Test 4: Override design_settings + severities together, partially
// =========================================================
console.log('\nTest 4: Partial design_settings + partial severities combined');

assertEq(loadPcb(pcbContent), 0, 'PCB load');
assertEq(configureDrc({
    design_settings: {
        min_track_width_mm: 0.05,  // Relax track width
    },
    severities: {
        copper_edge_clearance: 'ignore',  // Ignore edge clearance
    }
}), 0, 'Combined partial config');

const test4Count = runDrc();
const test4Types = countViolationsByType(getDrcResults());
console.log(`  Violations: ${test4Count}`);

// Both track_width and copper_edge_clearance should be gone
assert(!test4Types['track_width'], 'track_width removed by design_settings override');
assert(!test4Types['copper_edge_clearance'], 'edge clearance removed by severity ignore');
// Via violations should remain
assertEq(test4Types['via_diameter'] || 0, drcBaselineTypes['via_diameter'] || 0,
    'via_diameter unchanged');
const expectedRemoved = (drcBaselineTypes['track_width'] || 0) +
                         (drcBaselineTypes['copper_edge_clearance'] || 0);
assertEq(test4Count, drcBaselineCount - expectedRemoved,
    'Total decrease equals sum of both removed types');

// =========================================================
// Test 5: Override only netclasses — design_settings keep PCB defaults
// =========================================================
console.log('\nTest 5: Override only netclasses (no design_settings)');

// Use the netclass PCB with relaxed design_settings + relaxed Default netclass baseline
assertEq(loadPcb(netclassPcbContent), 0, 'Netclass PCB load');
assertEq(configureDrc({
    design_settings: { min_clearance_mm: 0.0, copper_edge_clearance_mm: 0.0 },
    netclasses: { Default: { clearance_mm: 0.05 } },
}), 0, 'Relaxed baseline config');
const netRelaxedCount = runDrc();
const netRelaxedTypes = countViolationsByType(getDrcResults());
console.log(`  Relaxed baseline: ${netRelaxedCount}, clearance: ${netRelaxedTypes['clearance'] || 0}`);
assertEq(netRelaxedTypes['clearance'] || 0, 0, 'No clearance violations at relaxed baseline');

// Now override ONLY the netclass clearance (strict) — not design_settings
// We still need to keep design_settings relaxed since those come from the PCB file
assertEq(loadPcb(netclassPcbContent), 0, 'Netclass PCB reload');
assertEq(configureDrc({
    design_settings: { min_clearance_mm: 0.0, copper_edge_clearance_mm: 0.0 },
    netclasses: { Default: { clearance_mm: 0.25 } },
}), 0, 'Strict netclass config');
const test5Count = runDrc();
const test5Types = countViolationsByType(getDrcResults());
console.log(`  Strict netclass: ${test5Count}, clearance: ${test5Types['clearance'] || 0}`);

// Clearance violations should appear from strict netclass
assert((test5Types['clearance'] || 0) > 0, 'Strict netclass creates clearance violations');
// Structural violations (dangling track) should remain the same
assertEq(test5Types['track_dangling'] || 0, netRelaxedTypes['track_dangling'] || 0,
    'Structural violations unchanged by netclass change');

// =========================================================
// Test 6: Override only some ERC severities — rest keep schematic defaults
// =========================================================
console.log('\nTest 6: Partial ERC severity override');

assertEq(loadSchematic(schContent), 0, 'Schematic load');

// Ignore only pin_not_connected
assertEq(configureErc({
    severities: { pin_not_connected: 'ignore' }
}), 0, 'Partial ERC severity config');

const test6Count = runErc();
const test6Types = countErcViolationsByType(getErcResults());
console.log(`  ERC violations: ${test6Count}`);

// pin_not_connected removed
assert(!test6Types['pin_not_connected'], 'pin_not_connected removed');
// All other ERC types should retain baseline counts
for (const [type, count] of Object.entries(ercBaselineTypes)) {
    if (type === 'pin_not_connected') continue;
    assertEq(test6Types[type] || 0, count,
        `ERC type "${type}" unchanged (not overridden)`);
}
assertEq(test6Count, ercBaselineCount - (ercBaselineTypes['pin_not_connected'] || 0),
    'ERC total decrease equals ignored type count');

// =========================================================
// Test 7: Override only one of two related design_settings — other stays default
// =========================================================
console.log('\nTest 7: Override via_diameter but not via_drill');

assertEq(loadPcb(pcbContent), 0, 'PCB load');

// Relax only via diameter, leave via drill at PCB default
assertEq(configureDrc({
    design_settings: {
        min_via_diameter_mm: 0.1,  // Very relaxed
        // min_via_drill_mm NOT specified — keeps PCB default
    }
}), 0, 'Partial via config');

const test7Count = runDrc();
const test7Types = countViolationsByType(getDrcResults());
console.log(`  Violations: ${test7Count}`);

// via_diameter violations should disappear since we relaxed it
assert(!test7Types['via_diameter'] || test7Types['via_diameter'] === 0,
    'via_diameter violations removed by relaxed override');
// track_width should stay at baseline
assertEq(test7Types['track_width'] || 0, drcBaselineTypes['track_width'] || 0,
    'track_width unchanged');
// edge clearance should stay at baseline
assertEq(test7Types['copper_edge_clearance'] || 0, drcBaselineTypes['copper_edge_clearance'] || 0,
    'copper_edge_clearance unchanged');

// =========================================================
// Test 8: Strict override of one field should not affect unrelated fields
// =========================================================
console.log('\nTest 8: Strict override on one field, verify others unchanged');

assertEq(loadPcb(pcbContent), 0, 'PCB load');

// Make track width very strict (everything < 0.3mm violates)
assertEq(configureDrc({
    design_settings: {
        min_track_width_mm: 0.3,
    }
}), 0, 'Strict track width config');

const test8Count = runDrc();
const test8Types = countViolationsByType(getDrcResults());
console.log(`  Violations: ${test8Count}`);

// track_width should increase (more tracks violate)
assert((test8Types['track_width'] || 0) >= (drcBaselineTypes['track_width'] || 0),
    'Strict track_width produces more or equal violations');
// Other types should be unchanged
assertEq(test8Types['copper_edge_clearance'] || 0, drcBaselineTypes['copper_edge_clearance'] || 0,
    'copper_edge_clearance unaffected by track_width change');
assertEq(test8Types['via_diameter'] || 0, drcBaselineTypes['via_diameter'] || 0,
    'via_diameter unaffected by track_width change');

// =========================================================
// Test 9: Partial ERC — override wire_dangling, pin_not_connected keeps default
// =========================================================
console.log('\nTest 9: Partial ERC — ignore wire_dangling only');

assertEq(loadSchematic(schContent), 0, 'Schematic load');
assertEq(configureErc({
    severities: { wire_dangling: 'ignore' }
}), 0, 'Partial ERC wire_dangling ignore');

const test9Count = runErc();
const test9Types = countErcViolationsByType(getErcResults());
console.log(`  ERC violations: ${test9Count}`);

// wire_dangling removed
assert(!test9Types['wire_dangling'], 'wire_dangling removed');
// pin_not_connected should still be at baseline
assertEq(test9Types['pin_not_connected'] || 0, ercBaselineTypes['pin_not_connected'] || 0,
    'pin_not_connected unchanged');
assertEq(test9Count, ercBaselineCount - (ercBaselineTypes['wire_dangling'] || 0),
    'ERC total decrease equals ignored wire_dangling count');

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
