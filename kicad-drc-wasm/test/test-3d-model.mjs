/**
 * Test 3D model upload and component STEP export.
 * Stage 8b verification: FILENAME_RESOLVER works in Emscripten virtual FS.
 */
import { readFileSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmPath = resolve(__dirname, '../build-wasm-erc/kicad_drc.mjs');
const pcbPath = resolve(__dirname, '../../samples/model-test.kicad_pcb');
const modelPath = '/usr/share/kicad/3dmodels/Resistor_SMD.3dshapes/R_0402_1005Metric.step';

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  PASS: ${msg}`);
    passed++;
  } else {
    console.log(`  FAIL: ${msg}`);
    failed++;
  }
}

console.log('=== 3D Model Upload + Component STEP Export Test ===\n');

// Load WASM module
console.log('[1/5] Loading KiCad WASM module...');
const { default: createKicadDRC } = await import(wasmPath);
const Module = await createKicadDRC({
  print: () => {},
  printErr: (t) => process.stderr.write(t + '\n'),
  locateFile: (path) => resolve(__dirname, '../build-wasm-erc/', path),
});
console.log('[1/5] Module loaded.\n');

// Load PCB
console.log('[2/5] Loading PCB with 3D model references...');
const pcbContent = readFileSync(pcbPath, 'utf8');
const len = Module.lengthBytesUTF8(pcbContent) + 1;
const ptr = Module._malloc(len);
Module.stringToUTF8(pcbContent, ptr, len);
const loadResult = Module._kicad_load_pcb(ptr, 0);
Module._free(ptr);
assert(loadResult === 0, `PCB loads successfully (got ${loadResult})`);

// Board-only export first (baseline)
console.log('\n[3/5] Exporting STEP (board only, baseline)...');
const boardOnlyStep = Module.ccall('kicad_export_step', 'string', ['string'], [
  JSON.stringify({ board_only: true, export_board_body: true, export_components: false })
]);
assert(boardOnlyStep !== null, 'Board-only STEP export returns non-null');
const boardOnlyEntities = (boardOnlyStep.match(/^#\d+/gm) || []).length;
console.log(`  Board-only: ${boardOnlyStep.length} chars, ${boardOnlyEntities} entities`);

// Upload 3D model file
console.log('\n[4/5] Uploading 3D model to virtual FS...');
if (!existsSync(modelPath)) {
  console.log(`  SKIP: Model file not found at ${modelPath}`);
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

const modelData = readFileSync(modelPath);
console.log(`  Model file: ${modelPath} (${modelData.length} bytes)`);

const uploadResult = Module.ccall(
  'kicad_upload_3d_model', 'number',
  ['string', 'array', 'number'],
  ['Resistor_SMD.3dshapes/R_0402_1005Metric.step', modelData, modelData.length]
);
assert(uploadResult === 0, `Model upload returns 0 (got ${uploadResult})`);

// Set model directory
const setDirResult = Module.ccall('kicad_set_3d_model_dir', 'number', ['string'], ['/models']);
assert(setDirResult === 0, `Set model dir returns 0 (got ${setDirResult})`);

// Export with components
console.log('\n[5/5] Exporting STEP with components...');
const withModelsStep = Module.ccall('kicad_export_step', 'string', ['string'], [
  JSON.stringify({
    board_only: false,
    export_board_body: true,
    export_components: true,
    model_dir: '/models'
  })
]);

assert(withModelsStep !== null, 'Component STEP export returns non-null');

if (withModelsStep) {
  const withModelsEntities = (withModelsStep.match(/^#\d+/gm) || []).length;
  console.log(`  With models: ${withModelsStep.length} chars, ${withModelsEntities} entities`);

  assert(withModelsStep.startsWith('ISO-10303-21'), 'STEP starts with ISO-10303-21');
  assert(withModelsEntities > boardOnlyEntities, `More entities with models (${withModelsEntities} > ${boardOnlyEntities})`);

  // Check for PRODUCT entities (should have board + component names)
  const products = withModelsStep.match(/PRODUCT\s*\(/g) || [];
  console.log(`  PRODUCT entities: ${products.length}`);
  assert(products.length >= 3, `At least 3 PRODUCT entities (board + 2 components, got ${products.length})`);

  // Check that both R1 and R2 components appear in assembly
  const nauo = withModelsStep.match(/NEXT_ASSEMBLY_USAGE_OCCURRENCE/g) || [];
  assert(nauo.length >= 3, `At least 3 assembly references (R1 + R2 + PCB, got ${nauo.length})`);

  // Compare with native output (informational — entity count differs between
  // KiCad versions due to style deduplication: v9.99 reuses PRODUCT definitions
  // for identical models while v8.0.9 creates separate ones)
  try {
    const nativeStep = readFileSync('/tmp/native-model-test.step', 'utf8');
    const nativeEntities = (nativeStep.match(/^#\d+/gm) || []).length;
    console.log(`\n  Native: ${nativeStep.length} chars, ${nativeEntities} entities`);
    console.log(`  WASM:   ${withModelsStep.length} chars, ${withModelsEntities} entities`);
    if (withModelsEntities !== nativeEntities) {
      console.log(`  INFO: Entity count differs (version difference: WASM=v9.99 vs native=v8.0.9)`);
    }
  } catch (e) {
    console.log('  (native comparison skipped - /tmp/native-model-test.step not found)');
  }
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
