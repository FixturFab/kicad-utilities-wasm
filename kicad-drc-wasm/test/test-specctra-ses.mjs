/**
 * Specctra SES import test — full autorouting workflow.
 *
 * Tests: Load PCB → Export DSN → Import SES → Save PCB
 *
 * Usage: node test-specctra-ses.mjs [path-to-kicad_pcb]
 */
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pcbPath = process.argv[2] || resolve(__dirname, '../../samples/test.kicad_pcb');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
    if (condition) {
        passed++;
    } else {
        failed++;
        console.error(`  FAIL: ${msg}`);
    }
}

console.log('=== Specctra SES Import Test ===');
console.log('PCB file:', pcbPath);
console.log();

// Load WASM module
console.log('[1/6] Loading WASM module...');
const mjsPath = resolve(__dirname, '../build-wasm-erc/kicad_drc.mjs');
const { default: createKicadDRC } = await import(mjsPath);
const Module = await createKicadDRC({
    print: () => {},
    printErr: (text) => process.stderr.write(text + '\n'),
    locateFile: (path) => resolve(__dirname, '../build-wasm-erc/', path),
});
console.log('[1/6] Module loaded.');

// Load PCB
console.log('[2/6] Loading PCB...');
const pcbContent = readFileSync(pcbPath, 'utf8');
const len = Module.lengthBytesUTF8(pcbContent) + 1;
const ptr = Module._malloc(len);
Module.stringToUTF8(pcbContent, ptr, len);
assert(Module._kicad_load_pcb(ptr, 0) === 0, 'Load PCB should succeed');
Module._free(ptr);
console.log('[2/6] PCB loaded.');

// Export DSN
console.log('[3/6] Exporting DSN...');
const dsnPtr = Module._kicad_export_dsn();
assert(dsnPtr !== 0, 'DSN export should succeed');
const dsnStr = Module.UTF8ToString(dsnPtr);
assert(dsnStr.includes('(pcb '), 'DSN should be valid');
console.log(`[3/6] DSN exported (${dsnStr.length} chars).`);

// Extract the DSN file path (first token after "(pcb ")
const dsnFileMatch = dsnStr.match(/\(pcb\s+"?([^"\s)]+)"?/);
const dsnFileName = dsnFileMatch ? dsnFileMatch[1] : 'unknown';

// Create a minimal SES file
// The SES file references the same layer names and net names from the DSN
console.log('[4/6] Importing SES...');
const sesContent = `(session "${dsnFileName}"
  (base_design "${dsnFileName}")
  (placement
    (resolution um 10)
    (component Resistor_SMD:R_0805_2012Metric
      (place R1 100000 -100000 front 0)
      (place R2 120000 -100000 front 0)
    )
  )
  (was_is
  )
  (routes
    (resolution um 10)
    (parser
      (host_cad "test-router")
      (host_version "1.0")
    )
    (library_out
      (padstack "Via[0-1]_600:300_um"
        (shape (circle F.Cu 600))
        (shape (circle B.Cu 600))
        (attach off)
      )
    )
    (network_out
      (net SIG
        (wire (path F.Cu 250  100912 -100000  119088 -100000)
        )
      )
    )
  )
)
`;

const sesLen = Module.lengthBytesUTF8(sesContent) + 1;
const sesPtr = Module._malloc(sesLen);
Module.stringToUTF8(sesContent, sesPtr, sesLen);
const sesResult = Module._kicad_import_ses(sesPtr, 0);
Module._free(sesPtr);

assert(sesResult === 0, `SES import should return 0, got ${sesResult}`);
console.log('[4/6] SES imported.');

// Save modified PCB
console.log('[5/6] Saving modified PCB...');
const savePtr = Module._kicad_save_pcb();
assert(savePtr !== 0, 'Save PCB should succeed');
const savedPcb = Module.UTF8ToString(savePtr);
assert(savedPcb.includes('(kicad_pcb'), 'Saved PCB should be valid');
assert(savedPcb.length > 100, 'Saved PCB should be substantial');
console.log(`[5/6] PCB saved (${savedPcb.length} chars).`);

// Verify the full round-trip: reload saved PCB and check
console.log('[6/6] Verifying round-trip...');
Module._kicad_cleanup();

const len2 = Module.lengthBytesUTF8(savedPcb) + 1;
const ptr2 = Module._malloc(len2);
Module.stringToUTF8(savedPcb, ptr2, len2);
const reloadResult = Module._kicad_load_pcb(ptr2, 0);
Module._free(ptr2);
assert(reloadResult === 0, `Round-trip reload should succeed, got ${reloadResult}`);

// Re-export DSN from the round-tripped board
const dsnPtr2 = Module._kicad_export_dsn();
assert(dsnPtr2 !== 0, 'Round-trip DSN export should succeed');
const dsnStr2 = Module.UTF8ToString(dsnPtr2);
assert(dsnStr2.includes('(pcb '), 'Round-trip DSN should be valid');
assert(dsnStr2.includes('(network'), 'Round-trip DSN should have networks');
console.log(`[6/6] Round-trip verified (DSN: ${dsnStr2.length} chars).`);

Module._kicad_cleanup();

// Summary
console.log();
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}
