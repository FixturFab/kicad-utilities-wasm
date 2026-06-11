// Level 3 agentic validation + Level 4 screenshots for the material preset
// toggle. Runs the REAL flow: load sample PCB -> WASM STEP export -> occt
// preview -> toggle materials. Verifies canvas pixels actually change.
//
// Usage: node serve-local.mjs 8123 &  then  node tests/level3-agentic-material-check.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'fs';

const BASE = process.env.BASE_URL || 'http://localhost:8123';
const SHOT_DIR = new URL('./screenshots/', import.meta.url).pathname;
mkdirSync(SHOT_DIR, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('console', (msg) => {
    const t = msg.text();
    if (t.includes('STEP') || t.includes('preview')) console.log('  [page]', t);
});

let failures = 0;
function check(name, ok, detail = '') {
    console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) failures++;
}

// ── Journey: load sample -> export STEP -> preview ──
console.log('— Journey: sample PCB through real WASM STEP export —');
await page.goto(`${BASE}/step.html`);
await page.locator('#use-sample').click({ timeout: 60_000 });
await page.locator('#generate-step-2').waitFor({ state: 'visible' });
await page.waitForFunction(() => !document.getElementById('generate-step-2').disabled, { timeout: 60_000 });
await page.check('#include-silkscreen');
await page.locator('#generate-step-2').click();
await page.waitForFunction(
    () => document.getElementById('generate-step-2').textContent.startsWith('Done'),
    { timeout: 300_000 },
);
const meshCount = await page.evaluate(() => {
    let n = 0;
    window.__stepDemo.previewGroup?.traverse((o) => { if (o.isMesh) n++; });
    return n;
});
check('real STEP export produced preview meshes', meshCount > 0, `${meshCount} meshes`);

const roleCounts = await page.evaluate(() => {
    const counts = {};
    window.__stepDemo.previewGroup.traverse((o) => {
        if (o.isMesh) counts[o.userData.role] = (counts[o.userData.role] || 0) + 1;
    });
    return counts;
});
check('silkscreen classified as engraving meshes', (roleCounts.engraving || 0) > 0,
    JSON.stringify(roleCounts));

// Canvas brightness via 2D copy (WebGL buffer is valid in the same task as a render)
async function canvasStats() {
    return page.evaluate(() => {
        const demo = window.__stepDemo;
        demo.renderOnce();
        const gl = document.querySelector('#viewer-container canvas');
        const c2 = document.createElement('canvas');
        c2.width = gl.width; c2.height = gl.height;
        const ctx = c2.getContext('2d');
        ctx.drawImage(gl, 0, 0);
        const d = ctx.getImageData(0, 0, c2.width, c2.height).data;
        let sum = 0;
        const sampled = [];
        for (let i = 0; i < d.length; i += 4) {
            sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
            if ((i / 4) % 16 === 0) sampled.push(d[i], d[i + 1], d[i + 2]);
        }
        return { mean: sum / (d.length / 4), sampled };
    });
}

// Fraction of sampled pixels that differ by more than 12 in any channel
function diffFraction(a, b) {
    let diff = 0;
    const n = Math.min(a.length, b.length) / 3;
    for (let i = 0; i < n * 3; i += 3) {
        if (Math.abs(a[i] - b[i]) > 12 || Math.abs(a[i + 1] - b[i + 1]) > 12 ||
            Math.abs(a[i + 2] - b[i + 2]) > 12) diff++;
    }
    return diff / n;
}

async function setPresetAndShoot(preset) {
    await page.selectOption('#material-select', preset);
    await page.waitForTimeout(300); // let a few frames render
    const stats = await canvasStats();
    await page.locator('#viewer-container').screenshot({
        path: `${SHOT_DIR}step-material-${preset}.png`,
    });
    console.log(`  preset=${preset} mean brightness=${stats.mean.toFixed(1)}`);
    return stats;
}

console.log('— Material presets on real geometry —');
const original = await setPresetAndShoot('original');
const matteBlack = await setPresetAndShoot('matte-black');
const clearAcrylic = await setPresetAndShoot('clear-acrylic');

check('matte black darkens the render vs original', matteBlack.mean < original.mean,
    `${matteBlack.mean.toFixed(1)} < ${original.mean.toFixed(1)}`);
check('clear acrylic renders differently than matte black',
    diffFraction(clearAcrylic.sampled, matteBlack.sampled) > 0.05,
    `${(diffFraction(clearAcrylic.sampled, matteBlack.sampled) * 100).toFixed(1)}% pixels differ`);
check('clear acrylic renders differently than original',
    diffFraction(clearAcrylic.sampled, original.sampled) > 0.05,
    `${(diffFraction(clearAcrylic.sampled, original.sampled) * 100).toFixed(1)}% pixels differ`);

// ── Abuse: rapid toggling ──
console.log('— Abuse: 30 rapid preset switches —');
for (let i = 0; i < 30; i++) {
    await page.selectOption('#material-select', ['original', 'clear-acrylic', 'matte-black'][i % 3]);
}
const afterAbuse = await page.evaluate(() => {
    const mats = [];
    window.__stepDemo.previewGroup.traverse((o) => { if (o.isMesh) mats.push(o.material.type); });
    return { types: [...new Set(mats)], select: document.getElementById('material-select').value };
});
check('state consistent after rapid toggling',
    afterAbuse.select === 'matte-black' && afterAbuse.types.length === 1 &&
    afterAbuse.types[0] === 'MeshPhysicalMaterial',
    JSON.stringify(afterAbuse));

// ── Cross-cutting: regenerate STEP with a preset active ──
console.log('— Cross-cutting: regenerate STEP while matte-black selected —');
await page.locator('#generate-step-2').click();
await page.waitForFunction(
    () => document.getElementById('generate-step-2').textContent.startsWith('Done'),
    { timeout: 300_000 },
);
const afterRegen = await page.evaluate(() => {
    const mats = [];
    window.__stepDemo.previewGroup.traverse((o) => { if (o.isMesh) mats.push(o.material.type); });
    return [...new Set(mats)];
});
check('preset survives a real regeneration',
    afterRegen.length === 1 && afterRegen[0] === 'MeshPhysicalMaterial',
    JSON.stringify(afterRegen));

await browser.close();
console.log(failures === 0 ? '\nALL LEVEL 3/4 CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
