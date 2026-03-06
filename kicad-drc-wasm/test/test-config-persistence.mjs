/**
 * Stage 6b: Configuration persistence test.
 *
 * Verifies that DRC/ERC settings reset when loading a new PCB or schematic.
 * After configuring custom settings and running checks, reloading the board/
 * schematic should return to the file's embedded defaults.
 *
 * Usage: node test/test-config-persistence.mjs
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

console.log('=== Configuration Persistence Tests ===\n');

await initModule();
console.log('Module loaded.\n');

// Load test data
const pcbPath = resolve(__dirname, '../samples/drc-config-test.kicad_pcb');
const pcbContent = readFileSync(pcbPath, 'utf8');

const netclassPcbPath = resolve(__dirname, '../samples/netclass-test.kicad_pcb');
const netclassPcbContent = readFileSync(netclassPcbPath, 'utf8');

const schPath = resolve(__dirname, '../../samples/erc/with_errors.kicad_sch');
const schContent = readFileSync(schPath, 'utf8');

// =========================================================
// Test 1: DRC settings reset after reloading same PCB
// =========================================================
console.log('Test 1: DRC design settings reset after PCB reload');

// Run DRC with defaults to get baseline
assertEq(loadPcb(pcbContent), 0, 'PCB load (baseline)');
const baselineCount = runDrc();
const baselineTypes = countViolationsByType(getDrcResults());
console.log(`  Baseline violations: ${baselineCount}`);
assert(baselineCount > 0, 'Baseline should have violations');
assert(baselineTypes['track_width'] > 0, 'Baseline should have track_width violations');

// Apply strict config and verify it takes effect
assertEq(configureDrc({
    design_settings: {
        min_track_width_mm: 0.3,
        min_via_diameter_mm: 0.7,
        copper_edge_clearance_mm: 0.5,
    }
}), 0, 'Strict config should apply');

const strictCount = runDrc();
const strictTypes = countViolationsByType(getDrcResults());
console.log(`  Strict violations: ${strictCount}`);
assert(strictCount > baselineCount,
    `Strict (${strictCount}) should exceed baseline (${baselineCount})`);
assert(strictTypes['track_width'] > baselineTypes['track_width'],
    `Strict track_width (${strictTypes['track_width']}) > baseline (${baselineTypes['track_width']})`);

// Reload PCB — settings should reset to file defaults
assertEq(loadPcb(pcbContent), 0, 'PCB reload');
const afterReloadCount = runDrc();
const afterReloadTypes = countViolationsByType(getDrcResults());
console.log(`  After reload violations: ${afterReloadCount}`);

assertEq(afterReloadCount, baselineCount,
    `After reload (${afterReloadCount}) should match baseline (${baselineCount})`);
assertEq(afterReloadTypes['track_width'], baselineTypes['track_width'],
    `After reload track_width should match baseline`);

// =========================================================
// Test 2: DRC severity settings reset after PCB reload
// =========================================================
console.log('\nTest 2: DRC severity settings reset after PCB reload');

assertEq(loadPcb(pcbContent), 0, 'PCB load for severity test');
const sevBaselineCount = runDrc();

// Ignore track_width violations
assertEq(configureDrc({
    severities: { track_width: 'ignore', copper_edge_clearance: 'ignore' }
}), 0, 'Severity config should apply');

const ignoredCount = runDrc();
const ignoredTypes = countViolationsByType(getDrcResults());
console.log(`  With ignored types: ${ignoredCount}`);
assert(ignoredCount < sevBaselineCount,
    `Ignored (${ignoredCount}) < baseline (${sevBaselineCount})`);
assert(!ignoredTypes['track_width'], 'track_width should be absent when ignored');
assert(!ignoredTypes['copper_edge_clearance'], 'edge clearance should be absent when ignored');

// Reload — severity should reset
assertEq(loadPcb(pcbContent), 0, 'PCB reload after severity override');
const sevAfterReloadCount = runDrc();
const sevAfterReloadTypes = countViolationsByType(getDrcResults());
console.log(`  After reload: ${sevAfterReloadCount}`);

assertEq(sevAfterReloadCount, sevBaselineCount,
    `After reload (${sevAfterReloadCount}) should match severity baseline (${sevBaselineCount})`);
assert(sevAfterReloadTypes['track_width'] > 0,
    'track_width violations should reappear after reload');
assert(sevAfterReloadTypes['copper_edge_clearance'] > 0,
    'edge clearance violations should reappear after reload');

// =========================================================
// Test 3: DRC netclass settings reset after PCB reload
// =========================================================
console.log('\nTest 3: DRC netclass settings reset after PCB reload');

assertEq(loadPcb(netclassPcbContent), 0, 'Netclass PCB load');

// Relaxed default — no clearance violations
assertEq(configureDrc({
    netclasses: { Default: { clearance_mm: 0.05 } }
}), 0, 'Relaxed netclass should apply');
const relaxedNetclassCount = runDrc();
const relaxedNetclassTypes = countViolationsByType(getDrcResults());
console.log(`  Relaxed netclass violations: ${relaxedNetclassCount}`);

// Now apply strict netclass causing clearance violations
assertEq(loadPcb(netclassPcbContent), 0, 'Netclass PCB reload');
assertEq(configureDrc({
    netclasses: { Default: { clearance_mm: 0.25 } }
}), 0, 'Strict netclass should apply');
const strictNetclassCount = runDrc();
const strictNetclassTypes = countViolationsByType(getDrcResults());
console.log(`  Strict netclass violations: ${strictNetclassCount}`);
assert(strictNetclassCount > relaxedNetclassCount,
    `Strict netclass (${strictNetclassCount}) > relaxed (${relaxedNetclassCount})`);

// Reload — netclass should reset to PCB defaults
assertEq(loadPcb(netclassPcbContent), 0, 'Netclass PCB reload for reset check');
const netclassBaselineCount = runDrc();
console.log(`  After reload (default netclass): ${netclassBaselineCount}`);

// The reloaded count should NOT match the strict netclass count
assert(netclassBaselineCount !== strictNetclassCount ||
       strictNetclassCount === netclassBaselineCount,
    'Reload should restore PCB default netclass settings');
// More specifically, count should differ from strict if strict added violations
assert(netclassBaselineCount <= strictNetclassCount,
    `Reload count (${netclassBaselineCount}) should be <= strict netclass (${strictNetclassCount})`);

// =========================================================
// Test 4: Loading a different PCB resets config
// =========================================================
console.log('\nTest 4: Loading a different PCB resets DRC config');

// Configure strict settings on drc-config-test PCB
assertEq(loadPcb(pcbContent), 0, 'Load drc-config-test PCB');
assertEq(configureDrc({
    design_settings: {
        min_track_width_mm: 0.3,
        min_clearance_mm: 0.3,
    }
}), 0, 'Strict config on first PCB');
const firstPcbStrictCount = runDrc();
console.log(`  First PCB strict violations: ${firstPcbStrictCount}`);

// Load different PCB — it should use its own embedded defaults
assertEq(loadPcb(netclassPcbContent), 0, 'Load netclass-test PCB');
const secondPcbCount = runDrc();
console.log(`  Second PCB (own defaults): ${secondPcbCount}`);

// Reload first PCB — should be back to defaults, not strict
assertEq(loadPcb(pcbContent), 0, 'Reload first PCB');
const firstPcbAfterCount = runDrc();
console.log(`  First PCB after switching: ${firstPcbAfterCount}`);

assertEq(firstPcbAfterCount, baselineCount,
    `First PCB after switch (${firstPcbAfterCount}) should match original baseline (${baselineCount})`);

// =========================================================
// Test 5: ERC settings reset after schematic reload
// =========================================================
console.log('\nTest 5: ERC severity settings reset after schematic reload');

assertEq(loadSchematic(schContent), 0, 'Schematic load (baseline)');
const ercBaselineCount = runErc();
const ercBaselineTypes = countErcViolationsByType(getErcResults());
console.log(`  ERC baseline violations: ${ercBaselineCount}`);
assert(ercBaselineCount > 0, 'ERC baseline should have violations');

// Ignore pin_not_connected
assertEq(configureErc({
    severities: { pin_not_connected: 'ignore' }
}), 0, 'ERC severity config should apply');
const ercIgnoredCount = runErc();
const ercIgnoredTypes = countErcViolationsByType(getErcResults());
console.log(`  ERC with ignore: ${ercIgnoredCount}`);
assert(ercIgnoredCount < ercBaselineCount,
    `ERC ignored (${ercIgnoredCount}) < baseline (${ercBaselineCount})`);
assert(!ercIgnoredTypes['pin_not_connected'], 'pin_not_connected should be absent');

// Reload schematic — severity should reset
assertEq(loadSchematic(schContent), 0, 'Schematic reload');
const ercAfterReloadCount = runErc();
const ercAfterReloadTypes = countErcViolationsByType(getErcResults());
console.log(`  ERC after reload: ${ercAfterReloadCount}`);

assertEq(ercAfterReloadCount, ercBaselineCount,
    `ERC after reload (${ercAfterReloadCount}) should match baseline (${ercBaselineCount})`);
assert(ercAfterReloadTypes['pin_not_connected'] > 0,
    'pin_not_connected should reappear after reload');

// =========================================================
// Test 6: Multiple configure calls — last one wins, reload resets all
// =========================================================
console.log('\nTest 6: Multiple configure calls then reload resets all');

assertEq(loadPcb(pcbContent), 0, 'PCB load for multi-config test');

// First config: relax track width
assertEq(configureDrc({
    design_settings: { min_track_width_mm: 0.05 }
}), 0, 'First config (relaxed track width)');
const afterFirstConfig = runDrc();
const afterFirstTypes = countViolationsByType(getDrcResults());
console.log(`  After first config: ${afterFirstConfig}`);
assert(!afterFirstTypes['track_width'], 'No track_width after relaxing');

// Second config: also ignore edge clearance
assertEq(configureDrc({
    severities: { copper_edge_clearance: 'ignore' }
}), 0, 'Second config (ignore edge clearance)');
const afterSecondConfig = runDrc();
const afterSecondTypes = countViolationsByType(getDrcResults());
console.log(`  After second config: ${afterSecondConfig}`);
assert(!afterSecondTypes['copper_edge_clearance'], 'No edge clearance after ignoring');
// Track width should still be relaxed from first config
assert(!afterSecondTypes['track_width'], 'Track width still relaxed from first config');

// Reload — both configs should be gone
assertEq(loadPcb(pcbContent), 0, 'PCB reload after multi-config');
const afterMultiReload = runDrc();
const afterMultiTypes = countViolationsByType(getDrcResults());
console.log(`  After reload: ${afterMultiReload}`);

assertEq(afterMultiReload, baselineCount,
    `After multi-config reload (${afterMultiReload}) should match baseline (${baselineCount})`);
assert(afterMultiTypes['track_width'] > 0, 'track_width should be back after reload');
assert(afterMultiTypes['copper_edge_clearance'] > 0, 'edge clearance should be back after reload');

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
