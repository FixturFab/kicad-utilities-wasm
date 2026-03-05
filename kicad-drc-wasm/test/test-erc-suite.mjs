/**
 * ERC WASM comprehensive test suite.
 *
 * Runs ERC on all sample schematics and validates results against
 * expected violation counts and types. Compares with native kicad-cli
 * where applicable (differences are documented).
 *
 * Usage: node test-erc-suite.mjs
 */
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Test infrastructure ---

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
        const msg = `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
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

function loadSchematicSheet(sheetPath, content) {
    const pathPtr = allocString(sheetPath);
    const contentPtr = allocString(content);
    const result = Module._kicad_load_schematic_sheet(pathPtr, contentPtr, 0);
    Module._free(pathPtr);
    Module._free(contentPtr);
    return result;
}

function loadSchematic(content) {
    const ptr = allocString(content);
    const result = Module._kicad_load_schematic(ptr, 0);
    Module._free(ptr);
    return result;
}

function runErc() {
    return Module._kicad_run_erc();
}

function getErcResults() {
    const jsonPtr = Module._kicad_get_erc_results();
    if (jsonPtr === 0) return null;
    return JSON.parse(Module.UTF8ToString(jsonPtr));
}

function cleanupSchematic() {
    Module._kicad_cleanup_schematic();
}

function getViolationTypes(results) {
    const types = [];
    if (results?.sheets) {
        for (const sheet of results.sheets) {
            for (const v of (sheet.violations || [])) {
                types.push(v.type);
            }
        }
    }
    return types.sort();
}

function countViolationsByType(results) {
    const counts = {};
    if (results?.sheets) {
        for (const sheet of results.sheets) {
            for (const v of (sheet.violations || [])) {
                counts[v.type] = (counts[v.type] || 0) + 1;
            }
        }
    }
    return counts;
}

// --- Test cases ---

async function testDiagPing() {
    console.log('Test: diag_ping');
    assertEq(Module._diag_ping(), 42, 'diag_ping should return 42');
}

async function testSimpleClean() {
    console.log('Test: simple_clean.kicad_sch');
    const content = readFileSync(resolve(__dirname, '../../samples/erc/simple_clean.kicad_sch'), 'utf8');

    assertEq(loadSchematic(content), 0, 'simple_clean: load should succeed');

    const violationCount = runErc();
    assert(violationCount >= 0, 'simple_clean: ERC should not fail');
    assertEq(violationCount, 2, 'simple_clean: should have 2 violations (power_pin_not_driven)');

    const results = getErcResults();
    assert(results !== null, 'simple_clean: should have JSON results');
    assertEq(results.$schema, 'https://schemas.kicad.org/erc.v1.json', 'simple_clean: schema URL');
    assertEq(results.coordinate_units, 'mm', 'simple_clean: coordinate units');
    assert(results.sheets?.length >= 1, 'simple_clean: should have at least 1 sheet');

    const counts = countViolationsByType(results);
    assertEq(counts.power_pin_not_driven, 2, 'simple_clean: 2x power_pin_not_driven');
    // Native kicad-cli also reports 3x lib_symbol_issues (skipped in WASM - no library access)

    // Verify violation structure
    const sheet = results.sheets[0];
    assertEq(sheet.path, '/', 'simple_clean: root sheet path');
    for (const v of sheet.violations) {
        assert(v.severity === 'error' || v.severity === 'warning', `simple_clean: valid severity "${v.severity}"`);
        assert(v.description?.length > 0, 'simple_clean: violation has description');
        assert(Array.isArray(v.items), 'simple_clean: violation has items array');
        for (const item of v.items) {
            assert(item.pos !== undefined, 'simple_clean: item has position');
            assert(typeof item.pos.x === 'number', 'simple_clean: item pos.x is number');
            assert(typeof item.pos.y === 'number', 'simple_clean: item pos.y is number');
        }
    }

    cleanupSchematic();
}

async function testWithErrors() {
    console.log('Test: with_errors.kicad_sch');
    const content = readFileSync(resolve(__dirname, '../../samples/erc/with_errors.kicad_sch'), 'utf8');

    assertEq(loadSchematic(content), 0, 'with_errors: load should succeed');

    const violationCount = runErc();
    assert(violationCount >= 0, 'with_errors: ERC should not fail');
    assertEq(violationCount, 9, 'with_errors: should have 9 violations');

    const results = getErcResults();
    assert(results !== null, 'with_errors: should have JSON results');

    const counts = countViolationsByType(results);
    // Expected WASM violations (matches native minus skipped tests):
    assertEq(counts.power_pin_not_driven, 1, 'with_errors: 1x power_pin_not_driven');
    assertEq(counts.wire_dangling, 1, 'with_errors: 1x wire_dangling');
    assertEq(counts.pin_not_connected, 5, 'with_errors: 5x pin_not_connected');
    assertEq(counts.missing_unit, 1, 'with_errors: 1x missing_unit');
    assertEq(counts.missing_power_pin, 1, 'with_errors: 1x missing_power_pin');
    // NOT present in WASM (skipped tests):
    // - 3x lib_symbol_issues (TestLibSymbolIssues skipped)
    // - 1x sim_model_issue (TestSimModelIssues skipped)

    // Verify severities
    for (const sheet of results.sheets) {
        for (const v of sheet.violations) {
            if (v.type === 'missing_unit') {
                assertEq(v.severity, 'warning', 'with_errors: missing_unit is warning');
            }
            if (v.type === 'pin_not_connected') {
                assertEq(v.severity, 'error', 'with_errors: pin_not_connected is error');
            }
        }
    }

    cleanupSchematic();
}

async function testHierarchical() {
    console.log('Test: hierarchical schematics');
    const rootContent = readFileSync(resolve(__dirname, '../../samples/erc/hierarchical_root.kicad_sch'), 'utf8');
    const subContent = readFileSync(resolve(__dirname, '../../samples/erc/hierarchical_sub.kicad_sch'), 'utf8');

    // Load child sheet FIRST (required by API)
    assertEq(loadSchematicSheet('hierarchical_sub.kicad_sch', subContent), 0, 'hierarchical: child sheet load');
    assertEq(loadSchematic(rootContent), 0, 'hierarchical: root load');

    const violationCount = runErc();
    assert(violationCount >= 0, 'hierarchical: ERC should not fail');
    assertEq(violationCount, 3, 'hierarchical: should have 3 violations');

    const results = getErcResults();
    assert(results !== null, 'hierarchical: should have JSON results');

    // Verify multiple sheets in output
    assert(results.sheets?.length >= 2, 'hierarchical: should have >=2 sheets in results');

    const counts = countViolationsByType(results);
    assertEq(counts.power_pin_not_driven, 2, 'hierarchical: 2x power_pin_not_driven');
    // v9 source reports hier_label_mismatch that v8 native doesn't
    assertEq(counts.hier_label_mismatch, 1, 'hierarchical: 1x hier_label_mismatch (v9 behavior)');

    // Verify sheet paths
    const paths = results.sheets.map(s => s.path);
    assert(paths.includes('/'), 'hierarchical: has root sheet /');
    assert(paths.some(p => p !== '/'), 'hierarchical: has child sheet path');

    cleanupSchematic();
}

async function testJsonStructure() {
    console.log('Test: JSON output structure compliance');
    const content = readFileSync(resolve(__dirname, '../../samples/erc/with_errors.kicad_sch'), 'utf8');

    assertEq(loadSchematic(content), 0, 'json: load should succeed');
    runErc();
    const results = getErcResults();
    assert(results !== null, 'json: should have results');

    // Top-level fields per schemas.kicad.org/erc.v1.json
    assertEq(results.$schema, 'https://schemas.kicad.org/erc.v1.json', 'json: $schema field');
    assertEq(results.coordinate_units, 'mm', 'json: coordinate_units field');
    assert(typeof results.source === 'string', 'json: source field is string');
    assert(Array.isArray(results.sheets), 'json: sheets is array');

    // Sheet structure
    for (const sheet of results.sheets) {
        assert(typeof sheet.path === 'string', 'json: sheet has path');
        assert(typeof sheet.uuid_path === 'string', 'json: sheet has uuid_path');
        assert(Array.isArray(sheet.violations), 'json: sheet has violations array');

        // Violation structure
        for (const v of sheet.violations) {
            assert(typeof v.type === 'string', 'json: violation has type');
            assert(typeof v.severity === 'string', 'json: violation has severity');
            assert(typeof v.description === 'string', 'json: violation has description');
            assert(Array.isArray(v.items), 'json: violation has items');
            assert(v.items.length >= 1, 'json: violation has at least 1 item');

            for (const item of v.items) {
                assert(typeof item.description === 'string', 'json: item has description');
                assert(item.pos !== undefined, 'json: item has pos');
                assert(typeof item.pos.x === 'number', 'json: item pos.x is number');
                assert(typeof item.pos.y === 'number', 'json: item pos.y is number');
                assert(typeof item.uuid === 'string', 'json: item has uuid');
            }
        }
    }

    cleanupSchematic();
}

async function testCleanupAndReload() {
    console.log('Test: cleanup and reload');
    const content = readFileSync(resolve(__dirname, '../../samples/erc/simple_clean.kicad_sch'), 'utf8');

    // First run
    assertEq(loadSchematic(content), 0, 'reload: first load');
    const count1 = runErc();
    assert(count1 >= 0, 'reload: first ERC');
    cleanupSchematic();

    // Second run (tests that cleanup properly frees resources)
    assertEq(loadSchematic(content), 0, 'reload: second load after cleanup');
    const count2 = runErc();
    assertEq(count2, count1, 'reload: same violation count on second run');
    cleanupSchematic();
}

// --- Main ---

console.log('=== ERC WASM Test Suite ===\n');

await initModule();
console.log('Module loaded.\n');

await testDiagPing();
await testSimpleClean();
await testWithErrors();
await testHierarchical();
await testJsonStructure();
await testCleanupAndReload();

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
