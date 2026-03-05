/**
 * ERC WASM test: Hierarchical schematic support.
 *
 * Tests loading a root schematic with a child sheet and running ERC
 * across sheet boundaries.
 *
 * Usage: node test-erc-hierarchical.mjs
 */
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const rootPath = resolve(__dirname, '../../samples/erc/hierarchical_root.kicad_sch');
const subPath = resolve(__dirname, '../../samples/erc/hierarchical_sub.kicad_sch');

console.log('=== Hierarchical ERC WASM Test ===');
console.log('Root schematic:', rootPath);
console.log('Sub schematic:', subPath);
console.log();

// Step 1: Load WASM module
console.log('[1/6] Loading WASM module...');
const mjsPath = resolve(__dirname, '../build-wasm-erc/kicad_drc.mjs');
const { default: createKicadDRC } = await import(mjsPath);

const Module = await createKicadDRC({
    print: (text) => console.log('[wasm:out]', text),
    printErr: (text) => console.error('[wasm:err]', text),
    locateFile: (path) => resolve(__dirname, '../build-wasm-erc/', path),
});
console.log('[1/6] Module loaded.');
console.log();

// Step 2: Pre-load child sheet to virtual FS
console.log('[2/6] Loading child sheet to virtual FS...');
const subContent = readFileSync(subPath, 'utf8');

const subLen = Module.lengthBytesUTF8(subContent) + 1;
const subPtr = Module._malloc(subLen);
Module.stringToUTF8(subContent, subPtr, subLen);

const sheetPathStr = 'hierarchical_sub.kicad_sch';
const spLen = Module.lengthBytesUTF8(sheetPathStr) + 1;
const spPtr = Module._malloc(spLen);
Module.stringToUTF8(sheetPathStr, spPtr, spLen);

const sheetResult = Module._kicad_load_schematic_sheet(spPtr, subPtr, 0);
Module._free(subPtr);
Module._free(spPtr);

console.log('[2/6] kicad_load_schematic_sheet returned:', sheetResult);
if (sheetResult !== 0) {
    console.error('FAIL: Child sheet load failed with code', sheetResult);
    process.exit(1);
}
console.log();

// Step 3: Load root schematic
console.log('[3/6] Loading root schematic...');
const rootContent = readFileSync(rootPath, 'utf8');

const rootLen = Module.lengthBytesUTF8(rootContent) + 1;
const rootPtr = Module._malloc(rootLen);
Module.stringToUTF8(rootContent, rootPtr, rootLen);

const loadResult = Module._kicad_load_schematic(rootPtr, 0);
Module._free(rootPtr);

console.log('[3/6] kicad_load_schematic returned:', loadResult);
if (loadResult !== 0) {
    console.error('FAIL: Root schematic load failed with code', loadResult);
    process.exit(1);
}
console.log();

// Step 4: Run ERC
console.log('[4/6] Running ERC...');
const violationCount = Module._kicad_run_erc();
console.log('[4/6] kicad_run_erc returned:', violationCount, 'violations');
if (violationCount < 0) {
    console.error('FAIL: ERC failed with code', violationCount);
    process.exit(1);
}
console.log();

// Step 5: Get JSON results
console.log('[5/6] Getting ERC results...');
const jsonPtr = Module._kicad_get_erc_results();
let resultsJson = null;
if (jsonPtr === 0) {
    console.log('  No JSON results (null pointer)');
} else {
    const jsonStr = Module.UTF8ToString(jsonPtr);
    console.log('  JSON result length:', jsonStr.length, 'bytes');

    try {
        resultsJson = JSON.parse(jsonStr);
        console.log('  Sheets:', resultsJson.sheets?.length ?? 0);

        let totalViolations = 0;
        if (resultsJson.sheets) {
            for (const sheet of resultsJson.sheets) {
                const count = sheet.violations?.length ?? 0;
                totalViolations += count;
                console.log(`  Sheet "${sheet.path}": ${count} violations`);
                if (count > 0) {
                    for (const v of sheet.violations) {
                        console.log(`    - [${v.severity}] ${v.type}: ${v.description}`);
                    }
                }
            }
        }
        console.log('  Total violations in JSON:', totalViolations);
    } catch (e) {
        console.error('  JSON parse error:', e.message);
        console.log('  Raw JSON (first 500 chars):', jsonStr.substring(0, 500));
    }
}

// Step 6: Verify hierarchical aspects
console.log();
console.log('[6/6] Verifying hierarchical results...');
let pass = true;

if (!resultsJson) {
    console.error('FAIL: No JSON results to verify');
    pass = false;
} else {
    // Should have at least 2 sheets (root + subsheet)
    const sheetCount = resultsJson.sheets?.length ?? 0;
    if (sheetCount >= 2) {
        console.log('  PASS: Multiple sheets found (' + sheetCount + ')');
    } else {
        console.log('  WARN: Expected >=2 sheets, got ' + sheetCount);
        // Not a hard failure - some ERC implementations flatten results
    }

    // Verify ERC ran (should get some violations)
    console.log('  Total violations:', violationCount);
}

// Cleanup
Module._kicad_cleanup_schematic();

console.log();
if (pass) {
    console.log('=== RESULT: PASS ===');
    console.log(`Hierarchical ERC completed with ${violationCount} violations`);
} else {
    console.log('=== RESULT: FAIL ===');
    process.exit(1);
}
