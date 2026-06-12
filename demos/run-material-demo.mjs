// Captioned demo walkthrough of the material preset toggle on step.html.
// Replay with: node serve-local.mjs 8123 &  then  node demos/run-material-demo.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'fs';

const SHOT_DIR = new URL('./screenshots/', import.meta.url).pathname;
mkdirSync(SHOT_DIR, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto((process.env.BASE_URL || 'http://localhost:8123') + '/step.html');

// Demo helpers: caption banner + element highlight
await page.evaluate(() => {
    const caption = document.createElement('div');
    caption.id = 'demo-caption';
    caption.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:linear-gradient(135deg,#1a1a2e,#16213e);color:white;padding:16px 24px;font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;box-shadow:0 -4px 20px rgba(0,0,0,0.3);z-index:99999;border-top:3px solid #e94560';
    document.body.appendChild(caption);
    document.body.style.paddingBottom = '80px';
    window.demoSetCaption = (title, desc) => {
        caption.innerHTML = '<div style="font-weight:600;font-size:16px;margin-bottom:4px;color:#e94560">' + title + '</div><div>' + desc + '</div>';
    };
    window.demoHighlight = (selector, label) => {
        window.demoClearHighlight();
        const el = document.querySelector(selector);
        if (!el) return;
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        void el.offsetHeight;
        const rect = el.getBoundingClientRect();
        const hl = document.createElement('div');
        hl.id = 'demo-highlight';
        hl.style.cssText = 'position:fixed;top:' + (rect.top - 4) + 'px;left:' + (rect.left - 4) + 'px;width:' + (rect.width + 8) + 'px;height:' + (rect.height + 8) + 'px;border:3px solid #e94560;border-radius:8px;background:rgba(233,69,96,0.1);pointer-events:none;z-index:99998;box-shadow:0 0 20px rgba(233,69,96,0.4)';
        if (label) {
            const lbl = document.createElement('div');
            lbl.style.cssText = 'position:absolute;top:-28px;left:50%;transform:translateX(-50%);background:#e94560;color:white;padding:4px 12px;border-radius:4px;font-size:12px;font-weight:600;white-space:nowrap';
            lbl.textContent = label;
            hl.appendChild(lbl);
        }
        document.body.appendChild(hl);
    };
    window.demoClearHighlight = () => document.getElementById('demo-highlight')?.remove();
});

async function shot(name, title, desc, highlight = null, label = null) {
    await page.evaluate(([t, d, h, l]) => {
        window.demoSetCaption(t, d);
        if (h) window.demoHighlight(h, l); else window.demoClearHighlight();
    }, [title, desc, highlight, label]);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOT_DIR}material-toggle-${name}.png` });
    console.log(`shot: material-toggle-${name}.png`);
}

// Step 1: load the sample PCB
await page.waitForFunction(() => !document.getElementById('use-sample').disabled, { timeout: 60_000 });
await shot('01-load-sample', 'Step 1: Load a PCB', 'Drop any .kicad_pcb, or use the bundled sample board.', '#use-sample', 'click');
await page.click('#use-sample');

// Step 2: generate STEP in WASM
await page.waitForFunction(() => !document.getElementById('generate-step-2').disabled, { timeout: 60_000 });
await page.check('#include-silkscreen');
await page.check('#engrave-silkscreen');
await shot('02-generate', 'Step 2: Generate STEP', 'Silkscreen + Engrave checked: OCCT boolean-cuts the marks 0.1mm into the board — the STEP gets real recesses.', '#generate-step-2', 'click');
await page.click('#generate-step-2');
await page.waitForFunction(() => document.getElementById('generate-step-2').textContent.startsWith('Done'), { timeout: 300_000 });
await page.evaluate(() => document.getElementById('viewer-container').scrollIntoView({ block: 'center', behavior: 'instant' }));

// Step 3: original preview
await shot('03-original', '3D Preview: Original', 'The exported STEP rendered with its real face colors (mask green, pads).');

// Step 4: the new material dropdown
await shot('04-toggle', 'New: Material presets', 'STEP files can’t carry materials — the viewer re-skins the geometry instead.', '#material-select', 'new');

// Step 5: matte black
await page.selectOption('#material-select', 'matte-black');
await shot('05-matte-black', 'Preset: Matte black acrylic', 'Silkscreen renders as light-grey laser engraving, flush with the surface.');

// Step 6: clear acrylic
await page.selectOption('#material-select', 'clear-acrylic');
await shot('06-clear-acrylic', 'Preset: Clear acrylic', 'Markings appear as frosted-white engraving; the grid refracts through the clear panel.');

await browser.close();
console.log('Demo complete.');
