import { test, expect } from '@playwright/test';

// Minimal fake occt-import-js result: one solid (1.6mm extrusion, so it
// classifies as a body mesh) with a BREP face color distinct from the
// default — exercises the same code path the real STEP preview uses,
// without running the (slow) WASM STEP export.
const FAKE_OCCT_RESULT = {
    success: true,
    meshes: [
        {
            attributes: {
                position: { array: [
                    0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0,
                    0, 0, 1.6, 10, 0, 1.6, 10, 10, 1.6, 0, 10, 1.6,
                ] },
            },
            index: { array: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7] },
            color: [0.2, 0.6, 0.2],
            brep_faces: [{ first: 0, last: 1, color: [0.8, 0.2, 0.1] }],
        },
    ],
};

async function injectPreview(page) {
    await page.evaluate((occtResult) => {
        window.__stepDemo.injectPreview(occtResult);
    }, FAKE_OCCT_RESULT);
}

function collectMaterials(page) {
    return page.evaluate(() => {
        const mats = [];
        window.__stepDemo.previewGroup.traverse((obj) => {
            if (obj.isMesh) {
                const m = obj.material;
                mats.push({
                    type: m.type,
                    color: [m.color.r, m.color.g, m.color.b],
                    roughness: m.roughness ?? null,
                    metalness: m.metalness ?? null,
                    transmission: m.transmission ?? null,
                    ior: m.ior ?? null,
                });
            }
        });
        return mats;
    });
}

test.beforeEach(async ({ page }) => {
    await page.goto('/step.html');
});

test('material selector exists with all presets', async ({ page }) => {
    const select = page.locator('#material-select');
    await expect(select).toHaveCount(1);
    const values = await select.locator('option').evaluateAll(
        (opts) => opts.map((o) => o.value)
    );
    expect(values).toEqual(['original', 'clear-acrylic', 'matte-black']);
});

test('selector becomes visible once a preview is shown', async ({ page }) => {
    await injectPreview(page);
    await expect(page.locator('#material-select')).toBeVisible();
});

test('matte black preset swaps all meshes to dark rough physical material', async ({ page }) => {
    await injectPreview(page);
    await page.selectOption('#material-select', 'matte-black');

    const mats = await collectMaterials(page);
    expect(mats.length).toBeGreaterThan(0);
    for (const m of mats) {
        expect(m.type).toBe('MeshPhysicalMaterial');
        expect(m.roughness).toBeGreaterThanOrEqual(0.9);
        expect(m.metalness).toBe(0);
        for (const c of m.color) expect(c).toBeLessThanOrEqual(0.1);
    }
});

test('clear acrylic preset applies transmission with acrylic IOR', async ({ page }) => {
    await injectPreview(page);
    await page.selectOption('#material-select', 'clear-acrylic');

    const mats = await collectMaterials(page);
    expect(mats.length).toBeGreaterThan(0);
    for (const m of mats) {
        expect(m.type).toBe('MeshPhysicalMaterial');
        expect(m.transmission).toBe(1);
        expect(m.ior).toBeCloseTo(1.49, 2);
    }
});

test('switching back to original restores STEP face colors', async ({ page }) => {
    await injectPreview(page);
    await page.selectOption('#material-select', 'matte-black');
    await page.selectOption('#material-select', 'original');

    const mats = await collectMaterials(page);
    expect(mats.length).toBeGreaterThan(0);
    // The fake mesh's single BREP face is [0.8, 0.2, 0.1]
    expect(mats[0].type).toBe('MeshPhongMaterial');
    expect(mats[0].color[0]).toBeCloseTo(0.8, 1);
    expect(mats[0].color[1]).toBeCloseTo(0.2, 1);
    expect(mats[0].color[2]).toBeCloseTo(0.1, 1);
});

// Body solid (1.6mm extrusion) + zero-thickness planar silk mesh floating
// 0.075mm above it — mirrors what the real KiCad STEP export produces.
const FAKE_OCCT_WITH_SILK = {
    success: true,
    meshes: [
        {
            name: '_PCB',
            attributes: { position: { array: [
                0, 0, 0, 30, 0, 0, 30, 20, 0, 0, 20, 0,          // bottom face
                0, 0, 1.6, 30, 0, 1.6, 30, 20, 1.6, 0, 20, 1.6,  // top face
            ] } },
            index: { array: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7] },
            color: [0.08, 0.2, 0.14],
            brep_faces: [],
        },
        {
            name: '',
            attributes: { position: { array: [5, 5, 1.675, 12, 5, 1.675, 12, 8, 1.675, 5, 8, 1.675] } },
            index: { array: [0, 1, 2, 0, 2, 3] },
            brep_faces: [],
        },
    ],
};

test('planar silk meshes get the frosted engraving material on clear acrylic', async ({ page }) => {
    await page.evaluate((occt) => window.__stepDemo.injectPreview(occt), FAKE_OCCT_WITH_SILK);
    await page.selectOption('#material-select', 'clear-acrylic');

    const roles = await page.evaluate(() => {
        const out = [];
        window.__stepDemo.previewGroup.traverse((o) => {
            if (o.isMesh) out.push({
                role: o.userData.role,
                transmission: o.material.transmission ?? null,
                roughness: o.material.roughness ?? null,
                colorR: o.material.color.r,
                side: o.material.side,           // THREE.FrontSide === 0
                transparent: o.material.transparent,
            });
        });
        return out;
    });
    const silk = roles.find((r) => r.role === 'engraving');
    const body = roles.find((r) => r.role === 'body');
    expect(silk).toBeTruthy();
    expect(body).toBeTruthy();
    expect(body.transmission).toBe(1);
    expect(silk.transmission ?? 0).toBe(0);
    expect(silk.roughness).toBeGreaterThanOrEqual(0.7);
    expect(silk.colorR).toBeGreaterThanOrEqual(0.85);
    // anti-ghosting: closed transmissive body renders front faces only;
    // engraving stays opaque so the transmission pass picks it up
    expect(body.side).toBe(0);
    expect(silk.transparent).toBe(false);
});

test('silk sinks inside the glass on clear acrylic and resurfaces on other presets', async ({ page }) => {
    await page.evaluate((occt) => window.__stepDemo.injectPreview(occt), FAKE_OCCT_WITH_SILK);

    const silkWorldZ = () => page.evaluate(() => {
        let z = null;
        window.__stepDemo.previewGroup.traverse((o) => {
            if (o.isMesh && o.userData.role === 'engraving') {
                z = o.geometry.attributes.position.getZ(0) + o.position.z;
            }
        });
        return z;
    });

    await page.selectOption('#material-select', 'clear-acrylic');
    const inGlass = await silkWorldZ();
    expect(inGlass).toBeLessThan(1.6);   // below the 1.6 body top — inside
    expect(inGlass).toBeGreaterThan(1.4);

    await page.selectOption('#material-select', 'matte-black');
    const onSurface = await silkWorldZ();
    expect(onSurface).toBeGreaterThan(1.6); // back on the surface
    expect(onSurface).toBeLessThan(1.63);
});

test('silk meshes get mid-grey engraving on matte black', async ({ page }) => {
    await page.evaluate((occt) => window.__stepDemo.injectPreview(occt), FAKE_OCCT_WITH_SILK);
    await page.selectOption('#material-select', 'matte-black');

    const silk = await page.evaluate(() => {
        let s = null;
        window.__stepDemo.previewGroup.traverse((o) => {
            if (o.isMesh && o.userData.role === 'engraving') s = { r: o.material.color.r };
        });
        return s;
    });
    expect(silk).toBeTruthy();
    expect(silk.r).toBeGreaterThanOrEqual(0.3);
    expect(silk.r).toBeLessThanOrEqual(0.6);
});

test('silk meshes are nudged flush onto the board surface', async ({ page }) => {
    await page.evaluate((occt) => window.__stepDemo.injectPreview(occt), FAKE_OCCT_WITH_SILK);

    const z = await page.evaluate(() => {
        let silkZ = null;
        window.__stepDemo.previewGroup.traverse((o) => {
            if (o.isMesh && o.userData.role === 'engraving') {
                // world z of the (planar) silk geometry after the nudge
                silkZ = o.geometry.attributes.position.getZ(0) + o.position.z;
            }
        });
        return silkZ;
    });
    // body top is 1.6; silk source plane was at 1.675 — should now sit just above 1.6
    expect(z).toBeGreaterThan(1.6);
    expect(z).toBeLessThan(1.63);
});

test('chosen preset persists when the preview is rebuilt', async ({ page }) => {
    await injectPreview(page);
    await page.selectOption('#material-select', 'matte-black');

    // Simulate a regenerate: inject a fresh preview group
    await injectPreview(page);

    const mats = await collectMaterials(page);
    expect(mats.length).toBeGreaterThan(0);
    for (const m of mats) {
        expect(m.type).toBe('MeshPhysicalMaterial');
        for (const c of m.color) expect(c).toBeLessThanOrEqual(0.1);
    }
});
