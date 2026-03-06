/**
 * Stage 6a: Manufacturer rule set integration tests.
 *
 * Tests that the same PCB produces different DRC results when configured
 * with different manufacturer DRC rules (JLCPCB, OSH Park, PCBWay).
 *
 * Uses samples/drc-config-test.kicad_pcb which has:
 * - Tracks at 0.1mm, 0.15mm, 0.2mm, 0.25mm widths
 * - Vias at 0.4mm/0.2mm, 0.5mm/0.25mm, 0.6mm/0.3mm (diameter/drill)
 * - Track pairs with 0.1mm and 0.15mm edge clearance
 * - Track 0.1mm from board edge
 *
 * Usage: node test/test-manufacturer-rules.mjs
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

// --- Manufacturer DRC configs ---

const JLCPCB_CONFIG = {
    design_settings: {
        min_track_width_mm: 0.127,          // 5mil
        min_clearance_mm: 0.127,            // 5mil
        min_via_diameter_mm: 0.45,
        min_via_drill_mm: 0.3,
        copper_edge_clearance_mm: 0.3,
        min_hole_to_hole_mm: 0.254,
        min_annular_width_mm: 0.125,
    }
};

const OSHPARK_CONFIG = {
    design_settings: {
        min_track_width_mm: 0.152,          // 6mil
        min_clearance_mm: 0.152,            // 6mil
        min_via_diameter_mm: 0.508,         // 20mil (drill + 2x annular ring)
        min_via_drill_mm: 0.254,            // 10mil
        copper_edge_clearance_mm: 0.508,    // 20mil
        min_hole_to_hole_mm: 0.381,         // 15mil
        min_annular_width_mm: 0.127,        // 5mil annular ring
    }
};

const PCBWAY_CONFIG = {
    design_settings: {
        min_track_width_mm: 0.1,            // 4mil (advanced)
        min_clearance_mm: 0.1,
        min_via_diameter_mm: 0.3,
        min_via_drill_mm: 0.15,
        copper_edge_clearance_mm: 0.25,
        min_hole_to_hole_mm: 0.254,
    }
};

// --- Tests ---

console.log('=== Manufacturer Rule Set Integration Tests ===\n');

await initModule();
console.log('Module loaded.\n');

const pcbPath = resolve(__dirname, '../samples/drc-config-test.kicad_pcb');
const pcbContent = readFileSync(pcbPath, 'utf8');

// Test 1: JLCPCB rules
console.log('Test 1: JLCPCB 2-layer standard rules');
assertEq(loadPcb(pcbContent), 0, 'PCB should load');
assertEq(configureDrc(JLCPCB_CONFIG), 0, 'JLCPCB config should apply');
const jlcCount = runDrc();
const jlcResults = getDrcResults();
const jlcTypes = countViolationsByType(jlcResults);
console.log(`  JLCPCB violations: ${jlcCount}`);
console.log('  By type:', JSON.stringify(jlcTypes));

assert(jlcCount > 0, 'JLCPCB should find violations');
// JLCPCB has 5mil min track, so only the 0.1mm track (< 0.127mm) fails
assertEq(jlcTypes['track_width'], 1, 'JLCPCB: only 0.1mm track violates 5mil min');
// JLCPCB has 0.3mm min drill — 0.2mm and 0.25mm drills fail
assertEq(jlcTypes['drill_out_of_range'], 2, 'JLCPCB: 2 drill violations (0.2mm and 0.25mm)');

// Test 2: OSH Park rules (strictest)
console.log('\nTest 2: OSH Park 2-layer rules');
assertEq(loadPcb(pcbContent), 0, 'PCB should load');
assertEq(configureDrc(OSHPARK_CONFIG), 0, 'OSH Park config should apply');
const oshCount = runDrc();
const oshResults = getDrcResults();
const oshTypes = countViolationsByType(oshResults);
console.log(`  OSH Park violations: ${oshCount}`);
console.log('  By type:', JSON.stringify(oshTypes));

assert(oshCount > 0, 'OSH Park should find violations');
// OSH Park has 6mil min track, so 0.1mm and all 0.15mm tracks fail
assertEq(oshTypes['track_width'], 6, 'OSH Park: 0.1mm + 0.15mm tracks violate 6mil min');
// OSH Park has 20mil (0.508mm) min via — both 0.4mm and 0.5mm vias fail
assertEq(oshTypes['via_diameter'], 2, 'OSH Park: 2 via diameter violations');
// OSH Park has annular width check — small vias fail
assert(oshTypes['annular_width'] >= 1, 'OSH Park: should have annular width violations');

// Test 3: PCBWay rules (most relaxed)
console.log('\nTest 3: PCBWay advanced 2-layer rules');
assertEq(loadPcb(pcbContent), 0, 'PCB should load');
assertEq(configureDrc(PCBWAY_CONFIG), 0, 'PCBWay config should apply');
const pcbwayCount = runDrc();
const pcbwayResults = getDrcResults();
const pcbwayTypes = countViolationsByType(pcbwayResults);
console.log(`  PCBWay violations: ${pcbwayCount}`);
console.log('  By type:', JSON.stringify(pcbwayTypes));

// PCBWay has 4mil min track = 0.1mm, so even the 0.1mm track is at the limit
assert(!pcbwayTypes['track_width'], 'PCBWay: no track width violations with 4mil min');
// PCBWay has 0.15mm min drill — all drills pass
assert(!pcbwayTypes['drill_out_of_range'], 'PCBWay: no drill violations');
// PCBWay has 0.3mm min via — all vias pass
assert(!pcbwayTypes['via_diameter'], 'PCBWay: no via diameter violations');

// Test 4: Different manufacturers produce different violation counts
console.log('\nTest 4: Manufacturer configs produce different violation counts');
const allDifferent = (jlcCount !== oshCount) && (oshCount !== pcbwayCount) && (jlcCount !== pcbwayCount);
assert(allDifferent,
    `All three should differ: JLCPCB=${jlcCount}, OSH Park=${oshCount}, PCBWay=${pcbwayCount}`);

// PCBWay (most relaxed) < JLCPCB (moderate) < OSH Park (strictest)
assert(pcbwayCount < jlcCount,
    `PCBWay (${pcbwayCount}) < JLCPCB (${jlcCount})`);
assert(jlcCount < oshCount,
    `JLCPCB (${jlcCount}) < OSH Park (${oshCount})`);

// Test 5: Same violations appear across all configs (structural issues unaffected by settings)
console.log('\nTest 5: Structural violations consistent across manufacturers');
// Dangling tracks and vias are structural — they should appear in all configs
assert(jlcTypes['track_dangling'] > 0, 'JLCPCB: has dangling track violations');
assert(oshTypes['track_dangling'] > 0, 'OSH Park: has dangling track violations');
assert(pcbwayTypes['track_dangling'] > 0, 'PCBWay: has dangling track violations');
assertEq(jlcTypes['track_dangling'], oshTypes['track_dangling'],
    'Dangling track count same for JLCPCB and OSH Park');
assertEq(oshTypes['track_dangling'], pcbwayTypes['track_dangling'],
    'Dangling track count same for OSH Park and PCBWay');

assert(jlcTypes['via_dangling'] > 0, 'JLCPCB: has dangling via violations');
assert(oshTypes['via_dangling'] > 0, 'OSH Park: has dangling via violations');
assert(pcbwayTypes['via_dangling'] > 0, 'PCBWay: has dangling via violations');
assertEq(jlcTypes['via_dangling'], oshTypes['via_dangling'],
    'Dangling via count same for JLCPCB and OSH Park');
assertEq(oshTypes['via_dangling'], pcbwayTypes['via_dangling'],
    'Dangling via count same for OSH Park and PCBWay');

// Test 6: Manufacturer configs with severity overrides
console.log('\nTest 6: JLCPCB config with severity overrides');
assertEq(loadPcb(pcbContent), 0, 'PCB should load');
assertEq(configureDrc({
    ...JLCPCB_CONFIG,
    severities: {
        dangling_track: 'ignore',
        dangling_via: 'ignore',
        silk_edge_clearance: 'ignore',
    }
}), 0, 'JLCPCB + severity config should apply');
const jlcFilteredCount = runDrc();
const jlcFilteredResults = getDrcResults();
const jlcFilteredTypes = countViolationsByType(jlcFilteredResults);
console.log(`  JLCPCB (filtered) violations: ${jlcFilteredCount}`);
console.log('  By type:', JSON.stringify(jlcFilteredTypes));

assert(!jlcFilteredTypes['track_dangling'], 'Ignored dangling_track should not appear');
assert(!jlcFilteredTypes['via_dangling'], 'Ignored dangling_via should not appear');
assert(!jlcFilteredTypes['silk_edge_clearance'], 'Ignored silk_edge_clearance should not appear');
assert(jlcFilteredCount < jlcCount,
    `Filtered (${jlcFilteredCount}) < unfiltered (${jlcCount})`);

// Test 7: Manufacturer config combined with netclass
console.log('\nTest 7: OSH Park config with netclass override');
assertEq(loadPcb(pcbContent), 0, 'PCB should load');
assertEq(configureDrc({
    ...OSHPARK_CONFIG,
    netclasses: {
        Default: {
            clearance_mm: 0.05,  // Very relaxed default clearance
        }
    }
}), 0, 'OSH Park + netclass config should apply');
const oshNetclassCount = runDrc();
const oshNetclassResults = getDrcResults();
const oshNetclassTypes = countViolationsByType(oshNetclassResults);
console.log(`  OSH Park (with netclass) violations: ${oshNetclassCount}`);
console.log('  By type:', JSON.stringify(oshNetclassTypes));

// Clearance violations may change with netclass override
// But design setting violations (track_width, via) should remain
assertEq(oshNetclassTypes['track_width'], oshTypes['track_width'],
    'Track width violations unchanged by netclass');

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
