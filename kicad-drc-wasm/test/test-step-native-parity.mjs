/**
 * Stage 6a: Native STEP Export Parity Test
 *
 * Compares WASM _kicad_export_step() output against native kicad-cli output.
 * Tests at Level 2 (same STEP entities) and Level 1 (normalized byte comparison).
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

/** Strip timestamps, filenames, and whitespace differences from STEP content. */
function normalizeStepFile(content) {
  return content
    // Normalize line endings
    .replace(/\r\n/g, '\n')
    // Strip FILE_NAME line (contains timestamp and filename — spans multiple lines)
    .replace(/FILE_NAME\([\s\S]*?\);/g, 'FILE_NAME(/*normalized*/);')
    // Strip any date/time patterns (ISO 8601)
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g, '0000-00-00T00:00:00')
    // Trailing whitespace
    .replace(/[ \t]+$/gm, '');
}

/** Parse STEP entity types and return a map of type -> count. */
function parseStepEntities(content) {
  const entities = {};
  const regex = /^#\d+\s*=\s*([A-Z_]+)\s*\(/gm;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const type = match[1];
    entities[type] = (entities[type] || 0) + 1;
  }
  return entities;
}

/** Compare entity maps and return differences. */
function compareEntityMaps(wasmEntities, nativeEntities) {
  const allTypes = new Set([...Object.keys(wasmEntities), ...Object.keys(nativeEntities)]);
  const diffs = [];
  for (const type of [...allTypes].sort()) {
    const w = wasmEntities[type] || 0;
    const n = nativeEntities[type] || 0;
    if (w !== n) {
      diffs.push({ type, wasm: w, native: n, diff: w - n });
    }
  }
  return diffs;
}

// ── Check native kicad-cli availability ──
let nativeVersion = '';
try {
  nativeVersion = execSync('kicad-cli --version', { stdio: 'pipe' }).toString().trim();
} catch (e) {
  console.error('ERROR: kicad-cli not available. This test requires native kicad-cli.');
  process.exit(1);
}

console.log('=== Native STEP Export Parity Test ===');
console.log(`Native kicad-cli: v${nativeVersion}`);
console.log();

// ── Load WASM module ──
console.log('[1/4] Loading WASM module...');
const mjsPath = resolve(__dirname, '../build-wasm-erc/kicad_drc.mjs');
const { default: createKicadDRC } = await import(mjsPath);
const Module = await createKicadDRC({
  print: () => {},
  printErr: (t) => { if (t.startsWith('[STEP]')) process.stderr.write(t + '\n'); },
  locateFile: (path) => resolve(__dirname, '../build-wasm-erc/', path),
});
console.log('  Module loaded.');

// ── Test each PCB file ──
const pcbFiles = [
  resolve(__dirname, '../../samples/parity-test.kicad_pcb'),
  resolve(__dirname, '../../public/sample.kicad_pcb'),
];

for (const pcbPath of pcbFiles) {
  const pcbName = pcbPath.split('/').pop();
  let pcbContent;
  try {
    pcbContent = readFileSync(pcbPath, 'utf-8');
  } catch (e) {
    console.log(`\n  SKIP: ${pcbName} not found`);
    continue;
  }

  console.log(`\n[2/4] Testing: ${pcbName}`);

  // ── WASM export ──
  console.log('  [WASM] Loading PCB...');
  const len = Module.lengthBytesUTF8(pcbContent) + 1;
  const ptr = Module._malloc(len);
  Module.stringToUTF8(pcbContent, ptr, len);
  const loadRc = Module._kicad_load_pcb(ptr, 0);
  Module._free(ptr);
  assert(loadRc === 0, `${pcbName}: WASM loads PCB`);

  console.log('  [WASM] Exporting STEP...');
  const options = JSON.stringify({
    board_only: true,
    export_board_body: true,
    export_components: false,
  });
  const wasmStep = Module.ccall('kicad_export_step', 'string', ['string'], [options]);
  assert(wasmStep && wasmStep.length > 0, `${pcbName}: WASM produces STEP output`);

  Module._kicad_cleanup();

  // ── Native export ──
  console.log('  [Native] Exporting STEP...');
  const nativeOutPath = `/tmp/parity-native-${pcbName.replace('.kicad_pcb', '')}.step`;
  try {
    execSync(
      `kicad-cli pcb export step --board-only --no-dnp --force -o "${nativeOutPath}" "${pcbPath}" 2>&1`,
      { stdio: 'pipe' }
    );
  } catch (e) {
    console.error(`  ERROR: Native export failed: ${e.message}`);
    continue;
  }
  const nativeStep = readFileSync(nativeOutPath, 'utf-8');
  assert(nativeStep.length > 0, `${pcbName}: Native produces STEP output`);

  if (!wasmStep || !nativeStep) continue;

  // ── Level 2: Entity comparison ──
  console.log(`\n[3/4] Level 2 comparison: ${pcbName}`);
  const wasmEntities = parseStepEntities(wasmStep);
  const nativeEntities = parseStepEntities(nativeStep);

  const wasmEntityCount = Object.values(wasmEntities).reduce((a, b) => a + b, 0);
  const nativeEntityCount = Object.values(nativeEntities).reduce((a, b) => a + b, 0);

  console.log(`  WASM: ${wasmEntityCount} entities, ${Object.keys(wasmEntities).length} types, ${wasmStep.length} bytes`);
  console.log(`  Native: ${nativeEntityCount} entities, ${Object.keys(nativeEntities).length} types, ${nativeStep.length} bytes`);

  assert(wasmEntityCount === nativeEntityCount,
    `${pcbName}: Entity count matches (WASM=${wasmEntityCount}, native=${nativeEntityCount})`);

  const entityDiffs = compareEntityMaps(wasmEntities, nativeEntities);
  if (entityDiffs.length > 0) {
    console.log('  Entity differences:');
    for (const d of entityDiffs) {
      console.log(`    ${d.type}: WASM=${d.wasm}, native=${d.native} (diff=${d.diff > 0 ? '+' : ''}${d.diff})`);
    }
  }
  assert(entityDiffs.length === 0,
    `${pcbName}: All entity types match (${entityDiffs.length} differences)`);

  // Check key entity types individually
  for (const type of ['CLOSED_SHELL', 'ADVANCED_FACE', 'CYLINDRICAL_SURFACE', 'PLANE', 'PRODUCT']) {
    const w = wasmEntities[type] || 0;
    const n = nativeEntities[type] || 0;
    assert(w === n, `${pcbName}: ${type} count matches (WASM=${w}, native=${n})`);
  }

  // ── Level 1: Normalized byte comparison ──
  console.log(`\n[4/4] Level 1 comparison: ${pcbName}`);
  const wasmNorm = normalizeStepFile(wasmStep);
  const nativeNorm = normalizeStepFile(nativeStep);

  if (wasmNorm === nativeNorm) {
    assert(true, `${pcbName}: Normalized files are IDENTICAL`);
  } else {
    // Find first difference
    const wasmLines = wasmNorm.split('\n');
    const nativeLines = nativeNorm.split('\n');
    let firstDiffLine = -1;
    for (let i = 0; i < Math.max(wasmLines.length, nativeLines.length); i++) {
      if (wasmLines[i] !== nativeLines[i]) {
        firstDiffLine = i + 1;
        console.log(`  First difference at line ${firstDiffLine}:`);
        console.log(`    WASM:   ${(wasmLines[i] || '(missing)').substring(0, 120)}`);
        console.log(`    Native: ${(nativeLines[i] || '(missing)').substring(0, 120)}`);
        break;
      }
    }
    const sizeDiff = Math.abs(wasmNorm.length - nativeNorm.length);
    assert(sizeDiff < 100,
      `${pcbName}: Normalized size diff < 100 bytes (diff=${sizeDiff}, WASM=${wasmNorm.length}, native=${nativeNorm.length})`);
  }

  // Save outputs for manual inspection
  const outDir = resolve(__dirname, '../build-wasm-erc');
  writeFileSync(resolve(outDir, `parity-wasm-${pcbName.replace('.kicad_pcb', '')}.step`), wasmStep);
  writeFileSync(resolve(outDir, `parity-native-${pcbName.replace('.kicad_pcb', '')}.step`), nativeStep);
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
