/**
 * Test native STEP export via _kicad_export_step.
 *
 * Usage: node test/test-native-step.mjs [path-to-kicad_pcb]
 */
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pcbPath = process.argv[2] || resolve(__dirname, '../../samples/parity-test.kicad_pcb');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

console.log('=== Native STEP Export Test ===');
console.log('PCB file:', pcbPath);
console.log();

// Load module
console.log('[1/3] Loading KiCad WASM module...');
const mjsPath = resolve(__dirname, '../build-wasm-erc/kicad_drc.mjs');
const { default: createKicadDRC } = await import(mjsPath);

const Module = await createKicadDRC({
  print: (t) => { /* suppress stdout */ },
  printErr: (t) => { if (!t.startsWith('[ERC]')) process.stderr.write(t + '\n'); },
  locateFile: (path) => resolve(__dirname, '../build-wasm-erc/', path),
});
console.log('[1/3] Module loaded.');

// Load PCB
console.log('[2/3] Loading PCB...');
const pcbContent = readFileSync(pcbPath, 'utf8');
const len = Module.lengthBytesUTF8(pcbContent) + 1;
const ptr = Module._malloc(len);
Module.stringToUTF8(pcbContent, ptr, len);
const loadResult = Module._kicad_load_pcb(ptr, 0);
Module._free(ptr);
assert(loadResult === 0, `kicad_load_pcb returns 0 (got ${loadResult})`);

// Export STEP
console.log('[3/3] Exporting STEP...');
const options = JSON.stringify({
  board_only: true,
  export_board_body: true,
  export_components: false,
});

const stepResult = Module.ccall('kicad_export_step', 'string', ['string'], [options]);
assert(stepResult !== null && stepResult !== undefined, 'kicad_export_step returns non-null');
assert(typeof stepResult === 'string', `returns string (got ${typeof stepResult})`);

if (stepResult) {
  assert(stepResult.length > 100, `STEP content has substance (${stepResult.length} chars)`);
  assert(stepResult.startsWith('ISO-10303-21'), 'STEP starts with ISO-10303-21 header');
  assert(stepResult.includes('HEADER'), 'STEP contains HEADER section');
  assert(stepResult.includes('DATA'), 'STEP contains DATA section');
  assert(stepResult.includes('END-ISO-10303-21'), 'STEP contains end marker');

  // Count entities
  const entityMatches = stepResult.match(/^#\d+\s*=/gm);
  const entityCount = entityMatches ? entityMatches.length : 0;
  assert(entityCount > 10, `STEP has entities (${entityCount} found)`);

  // Check for expected STEP entity types
  assert(stepResult.includes('PRODUCT'), 'STEP contains PRODUCT entities');

  // Save output for inspection
  const outPath = resolve(__dirname, '../build-wasm-erc/native-step-output.step');
  writeFileSync(outPath, stepResult);
  console.log(`\n  Saved STEP output to: ${outPath}`);
  console.log(`  File size: ${stepResult.length} bytes`);
  console.log(`  Entity count: ${entityCount}`);
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
