/**
 * ERC WASM test: Load schematic and run ERC.
 *
 * Usage: node test-erc.mjs [path-to-kicad_sch]
 */
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schPath = process.argv[2] || resolve(__dirname, '../../samples/erc/with_errors.kicad_sch');

console.log('=== ERC WASM Test ===');
console.log('Schematic file:', schPath);
console.log();

// Step 1: Load WASM module
console.log('[1/5] Loading WASM module...');
const mjsPath = resolve(__dirname, '../build-wasm-erc/kicad_drc.mjs');
const { default: createKicadDRC } = await import(mjsPath);

const Module = await createKicadDRC({
    print: (text) => console.log('[wasm:out]', text),
    printErr: (text) => console.error('[wasm:err]', text),
    locateFile: (path) => resolve(__dirname, '../build-wasm-erc/', path),
});
console.log('[1/5] Module loaded successfully.');
console.log();

// Step 2: Verify diag_ping
console.log('[2/5] Testing diag_ping...');
const pingResult = Module._diag_ping();
console.log('[2/5] diag_ping returned:', pingResult);
if (pingResult !== 42) {
    console.error('FAIL: Expected 42, got', pingResult);
    process.exit(1);
}
console.log();

// Step 3: Load schematic file
console.log('[3/5] Loading schematic file...');
const schContent = readFileSync(schPath, 'utf8');
console.log('  Schematic file size:', schContent.length, 'bytes');

const len = Module.lengthBytesUTF8(schContent) + 1;
const ptr = Module._malloc(len);
Module.stringToUTF8(schContent, ptr, len);

const loadResult = Module._kicad_load_schematic(ptr, 0);
Module._free(ptr);

console.log('[3/5] kicad_load_schematic returned:', loadResult);
if (loadResult !== 0) {
    console.error('FAIL: Schematic load failed with code', loadResult);
    process.exit(1);
}
console.log();

// Step 4: Run ERC
console.log('[4/5] Running ERC...');
const violationCount = Module._kicad_run_erc();
console.log('[4/5] kicad_run_erc returned:', violationCount, 'violations');
if (violationCount < 0) {
    console.error('FAIL: ERC failed with code', violationCount);
    process.exit(1);
}
console.log();

// Step 5: Get JSON results
console.log('[5/5] Getting ERC results...');
const jsonPtr = Module._kicad_get_erc_results();
if (jsonPtr === 0) {
    console.log('  No JSON results (null pointer) - may be expected if no report generated');
} else {
    const jsonStr = Module.UTF8ToString(jsonPtr);
    console.log('  JSON result length:', jsonStr.length, 'bytes');

    try {
        const results = JSON.parse(jsonStr);
        console.log('  Schema:', results.$schema || '(none)');
        console.log('  Coordinate units:', results.coordinate_units);
        console.log('  Sheets:', results.sheets?.length ?? 0);

        let totalViolations = 0;
        if (results.sheets) {
            for (const sheet of results.sheets) {
                const count = sheet.violations?.length ?? 0;
                totalViolations += count;
                console.log(`  Sheet "${sheet.path}": ${count} violations`);
            }
        }
        console.log('  Total violations in JSON:', totalViolations);
    } catch (e) {
        console.log('  Raw JSON (first 500 chars):', jsonStr.substring(0, 500));
    }
}

// Cleanup
Module._kicad_cleanup_schematic();

console.log('\n=== RESULT: PASS ===');
console.log(`ERC completed with ${violationCount} violations in WASM`);
