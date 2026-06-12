import { describe, it, expect } from 'vitest';
import {
    MATERIAL_PRESETS, materialParamsForPreset, classifyMeshRole,
    ENGRAVING_FACE_COLOR, isEngravingFaceColor,
} from '../../public/materials.mjs';

describe('MATERIAL_PRESETS', () => {
    it('exposes original, clear-acrylic, and matte-black presets', () => {
        const ids = MATERIAL_PRESETS.map(p => p.id);
        expect(ids).toEqual(['original', 'clear-acrylic', 'matte-black']);
    });

    it('every preset has a human-readable label', () => {
        for (const preset of MATERIAL_PRESETS) {
            expect(preset.label).toBeTruthy();
            expect(typeof preset.label).toBe('string');
        }
    });
});

describe('materialParamsForPreset', () => {
    it('original keeps the STEP face color on a phong material', () => {
        const spec = materialParamsForPreset('original', [0.8, 0.2, 0.1]);
        expect(spec.type).toBe('phong');
        expect(spec.params.color).toEqual([0.8, 0.2, 0.1]);
    });

    it('original falls back to neutral grey when no face color given', () => {
        const spec = materialParamsForPreset('original');
        expect(spec.params.color).toEqual([0.8, 0.8, 0.8]);
    });

    it('clear acrylic is fully transmissive with acrylic IOR', () => {
        const spec = materialParamsForPreset('clear-acrylic', [0.8, 0.2, 0.1]);
        expect(spec.type).toBe('physical');
        expect(spec.params.transmission).toBe(1);
        expect(spec.params.ior).toBeCloseTo(1.49, 2);
        expect(spec.params.roughness).toBeLessThanOrEqual(0.1);
        expect(spec.params.metalness).toBe(0);
        // clear material ignores the STEP face color — white base
        expect(spec.params.color).toEqual([1, 1, 1]);
        // closed solids must be front-side only: interior back-faces add an
        // extra transmission layer, ghosting anything near the surface
        expect(spec.params.doubleSided ?? false).toBe(false);
    });

    it('clear acrylic thickness follows the board thickness', () => {
        const spec = materialParamsForPreset('clear-acrylic', null, { thicknessMm: 3 });
        expect(spec.params.thickness).toBe(3);
    });

    it('clear acrylic defaults to 1.6 mm thickness', () => {
        const spec = materialParamsForPreset('clear-acrylic');
        expect(spec.params.thickness).toBe(1.6);
    });

    it('matte black is dark, rough, and non-metallic', () => {
        const spec = materialParamsForPreset('matte-black', [0.8, 0.2, 0.1]);
        expect(spec.type).toBe('physical');
        expect(spec.params.roughness).toBeGreaterThanOrEqual(0.9);
        expect(spec.params.metalness).toBe(0);
        expect(spec.params.transmission ?? 0).toBe(0);
        for (const channel of spec.params.color) {
            expect(channel).toBeLessThanOrEqual(0.1);
        }
    });

    it('matte black damps environment lighting so it reads black, not grey', () => {
        const spec = materialParamsForPreset('matte-black');
        expect(spec.environmentIntensity).toBeLessThanOrEqual(0.5);
        expect(spec.environmentIntensity).toBeGreaterThan(0);
    });

    it('clear acrylic keeps moderate environment lighting — reflective but not blown out', () => {
        const spec = materialParamsForPreset('clear-acrylic');
        expect(spec.environmentIntensity).toBeGreaterThanOrEqual(0.1);
        expect(spec.environmentIntensity).toBeLessThanOrEqual(0.5);
    });

    it('throws on an unknown preset id', () => {
        expect(() => materialParamsForPreset('chrome')).toThrow(/unknown/i);
    });
});

describe('classifyMeshRole', () => {
    // Real values observed from KiCad WASM STEP export of the sample board:
    // body is named _PCB (1.51mm thick), pads are unnamed 0.04mm solids,
    // silkscreen arrives as unnamed zero-thickness planar faces.
    it('classifies the named PCB body solid as body', () => {
        expect(classifyMeshRole({ name: '_PCB', thicknessZ: 1.51 })).toBe('body');
    });

    it('classifies planar (zero z-extent) meshes as engraving', () => {
        expect(classifyMeshRole({ name: '', thicknessZ: 0 })).toBe('engraving');
        expect(classifyMeshRole({ name: '', thicknessZ: 0.0005 })).toBe('engraving');
    });

    it('classifies thin-but-solid pad meshes as body', () => {
        expect(classifyMeshRole({ name: '', thicknessZ: 0.04 })).toBe('body');
    });

    it('classifies uploaded component models as body', () => {
        expect(classifyMeshRole({ name: 'R_0402_1005Metric', thicknessZ: 0.35 })).toBe('body');
    });
});

describe('isEngravingFaceColor', () => {
    // The WASM engrave post-process colors recess faces ENGRAVING_FACE_COLOR
    // so the viewer can classify them; STEP round-trips colors with small
    // precision loss, so matching needs a tolerance.
    it('matches the marker color exactly and within tolerance', () => {
        expect(isEngravingFaceColor(ENGRAVING_FACE_COLOR)).toBe(true);
        expect(isEngravingFaceColor(ENGRAVING_FACE_COLOR.map(c => c + 0.004))).toBe(true);
    });

    it('rejects board, pad, and silk colors', () => {
        expect(isEngravingFaceColor([0.08, 0.2, 0.14])).toBe(false);  // mask green
        expect(isEngravingFaceColor([0.8, 0.8, 0.8])).toBe(false);    // default grey
        expect(isEngravingFaceColor([1, 1, 1])).toBe(false);          // pure white silk
        expect(isEngravingFaceColor(null)).toBe(false);
    });
});

describe('engraving materials (role: engraving)', () => {
    it('clear acrylic engraving is frosted — rough, opaque, near-white', () => {
        const spec = materialParamsForPreset('clear-acrylic', [1, 1, 1], { role: 'engraving' });
        expect(spec.type).toBe('physical');
        expect(spec.params.transmission ?? 0).toBe(0);
        expect(spec.params.roughness).toBeGreaterThanOrEqual(0.7);
        for (const c of spec.params.color) expect(c).toBeGreaterThanOrEqual(0.85);
        expect(spec.params.doubleSided).toBe(true);
        // engraving sinks INSIDE the glass: the surface occludes the direct
        // render, so it's seen only via the transmission pass — one copy,
        // frosted by the glass roughness, and visible reversed from the back
        expect(spec.insetMm).toBeGreaterThan(0);
        expect(spec.params.excludeFromTransmission ?? false).toBe(false);
    });

    it('matte black engraving is mid-grey, like laser-exposed material', () => {
        const spec = materialParamsForPreset('matte-black', [1, 1, 1], { role: 'engraving' });
        expect(spec.type).toBe('physical');
        for (const c of spec.params.color) {
            expect(c).toBeGreaterThanOrEqual(0.3);
            expect(c).toBeLessThanOrEqual(0.6);
        }
        expect(spec.params.roughness).toBeGreaterThanOrEqual(0.7);
        expect(spec.params.doubleSided).toBe(true);
    });

    it('matte black engraving sits on the surface, not inside the opaque body', () => {
        const spec = materialParamsForPreset('matte-black', null, { role: 'engraving' });
        expect(spec.insetMm ?? 0).toBeLessThanOrEqual(0);
    });

    it('engraving materials use polygon offset — engraved-STEP recess overlays are coplanar with the body', () => {
        for (const preset of ['clear-acrylic', 'matte-black']) {
            for (const role of ['engraving', 'engraving-plug']) {
                const spec = materialParamsForPreset(preset, null, { role });
                expect(spec.params.polygonOffset).toBe(true);
            }
        }
    });

    it('clear acrylic plugs are milky frosted glass — partially transmissive (any transmission keeps them out of the ghosting-prone transmission buffer)', () => {
        const spec = materialParamsForPreset('clear-acrylic', null, { role: 'engraving-plug' });
        expect(spec.type).toBe('physical');
        // milky blend: enough diffuse to read as white marks, enough
        // transmission to stay translucent (tuned visually at 0.45)
        expect(spec.params.transmission).toBeGreaterThanOrEqual(0.3);
        expect(spec.params.transmission).toBeLessThanOrEqual(0.7);
        expect(spec.params.roughness).toBeGreaterThanOrEqual(0.4); // frosted, not clear
        expect(spec.params.roughness).toBeLessThanOrEqual(0.8);
    });

    it('matte black plugs match the surface engraving treatment', () => {
        const plug = materialParamsForPreset('matte-black', null, { role: 'engraving-plug' });
        const surface = materialParamsForPreset('matte-black', null, { role: 'engraving' });
        expect(plug.params.color).toEqual(surface.params.color);
        expect(plug.params.transmission ?? 0).toBe(0);
    });

    it('original preset leaves engraving meshes with their STEP color', () => {
        const spec = materialParamsForPreset('original', [0.9, 0.9, 0.9], { role: 'engraving' });
        expect(spec.type).toBe('phong');
        expect(spec.params.color).toEqual([0.9, 0.9, 0.9]);
    });
});
