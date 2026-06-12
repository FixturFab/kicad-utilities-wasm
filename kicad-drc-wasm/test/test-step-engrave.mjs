/**
 * Test engrave_depth_mm: silkscreen subtracted from the board body as real
 * recesses (OCCT boolean post-process in step_engrave.cpp).
 *
 * Geometric assertions via occt-import-js: the engraved STEP must have no
 * zero-thickness silk meshes left, an unchanged board z-extent, and more
 * body triangles than the baseline (recess walls/floors).
 *
 * Usage: node test-step-engrave.mjs
 */
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { createRequire } from 'module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

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

// --- WASM module ---
const mjsPath = resolve(__dirname, '../build-wasm-erc/kicad_drc.mjs');
const { default: createKicadDRC } = await import(mjsPath);
const Module = await createKicadDRC({
    print: () => {},
    printErr: () => {},
    locateFile: (path) => resolve(__dirname, '../build-wasm-erc/', path),
});

function exportStep(optionsJson) {
    const pcb = readFileSync(resolve(__dirname, '../../public/sample.kicad_pcb'), 'utf-8');
    const len = Module.lengthBytesUTF8(pcb) + 1;
    const ptr = Module._malloc(len);
    Module.stringToUTF8(pcb, ptr, len);
    const rc = Module._kicad_load_pcb(ptr, 0);
    Module._free(ptr);
    assert(rc === 0, `kicad_load_pcb returns 0 (got ${rc})`);
    const step = Module.ccall('kicad_export_step', 'string', ['string'], [optionsJson]);
    Module._kicad_cleanup();
    return step;
}

// --- occt-import-js analysis ---
const occtimportjs = require('occt-import-js');
const occt = await occtimportjs();

function analyze(stepText) {
    const result = occt.ReadStepFile(new TextEncoder().encode(stepText), null);
    if (!result.success) return null;

    const meshes = result.meshes.map((m) => {
        const pos = m.attributes.position.array;
        let zMin = Infinity, zMax = -Infinity;
        for (let i = 2; i < pos.length; i += 3) {
            if (pos[i] < zMin) zMin = pos[i];
            if (pos[i] > zMax) zMax = pos[i];
        }
        return {
            thickness: zMax - zMin,
            zMin, zMax,
            triangles: m.index.array.length / 3,
            color: m.color || null,
            name: m.name || '',
        };
    });

    const planar = meshes.filter((m) => m.thickness < 0.001);
    const body = meshes.reduce((a, b) => (b.thickness > (a?.thickness ?? 0) ? b : a), null);
    return { meshes, planar, body };
}

console.log('=== STEP Engrave Test Suite ===\n');

console.log('Test: baseline export (silkscreen as flat faces)');
const baseline = exportStep(JSON.stringify({
    board_only: true, export_board_body: true, export_pads: true,
    export_silkscreen: true, cut_vias_in_body: true,
}));
assert(baseline && baseline.length > 0, 'baseline export produces STEP');
const base = analyze(baseline);
assert(base !== null, 'baseline STEP parses');
assert(base.planar.length > 0, `baseline has planar silk meshes (got ${base.planar.length})`);

console.log('Test: engraved export (engrave_depth_mm: 0.1)');
const engraved = exportStep(JSON.stringify({
    board_only: true, export_board_body: true, export_pads: true,
    export_silkscreen: true, engrave_depth_mm: 0.1, cut_vias_in_body: true,
}));
assert(engraved && engraved.length > 0, 'engraved export produces STEP');
assert(engraved !== baseline, 'engraved STEP differs from baseline');
const eng = analyze(engraved);
assert(eng !== null, 'engraved STEP parses');

console.log('Test: silk consumed into the body');
assert(eng.planar.length === 0,
    `engraved STEP has no planar silk meshes left (got ${eng.planar.length})`);
// silk meshes are replaced by engraving plug products, roughly one-for-one
assert(eng.meshes.length <= base.meshes.length,
    `no more meshes than baseline after engraving (${eng.meshes.length} <= ${base.meshes.length})`);

console.log('Test: board body gains recess geometry');
assert(eng.body.triangles > base.body.triangles,
    `body has more triangles (${eng.body.triangles} > ${base.body.triangles})`);
assert(Math.abs(eng.body.thickness - base.body.thickness) < 0.001,
    `body thickness unchanged (${eng.body.thickness.toFixed(3)} vs ${base.body.thickness.toFixed(3)})`);

console.log('Test: ENGRAVING overlay product carries the marker color');
const overlay = eng.meshes.find((m) =>
    m.color && m.color.every((c) => Math.abs(c - 0.92) < 0.01));
assert(overlay !== undefined,
    `a mesh with the 0.92 marker color exists (colors: ${eng.meshes.map((m) => JSON.stringify(m.color)).join(' ')})`);
if (overlay) {
    assert(Math.abs(overlay.thickness - 0.1) < 0.02,
        `overlay thickness matches engrave depth (${overlay.thickness.toFixed(3)} ≈ 0.1)`);
}

console.log('Test: engrave without silkscreen is a no-op');
const noSilk = exportStep(JSON.stringify({
    board_only: true, export_board_body: true, export_pads: true,
    export_silkscreen: false, engrave_depth_mm: 0.1, cut_vias_in_body: true,
}));
assert(noSilk && noSilk.length > 0, 'no-silk export still produces STEP');
const noSilkParsed = analyze(noSilk);
assert(noSilkParsed !== null && noSilkParsed.planar.length === 0,
    'no-silk export has no planar meshes');

console.log(`\n=== Results: ${testsPassed} passed, ${testsFailed} failed ===\n`);
if (testsFailed > 0) {
    console.error('Failures:');
    failures.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
}
console.log('All tests passed.');
