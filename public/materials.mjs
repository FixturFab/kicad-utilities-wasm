/**
 * Material presets for the STEP 3D preview.
 *
 * STEP files only carry flat per-face RGB colors — they have no notion of
 * transparency, roughness, or any PBR material. These presets let the viewer
 * re-skin the exported geometry as a physical material instead, e.g. to
 * preview a laser-cut acrylic panel.
 *
 * Pure data/logic only (no three.js imports) so it can be unit tested in Node.
 * The viewer maps the returned spec onto THREE.MeshPhongMaterial ('phong')
 * or THREE.MeshPhysicalMaterial ('physical'). The spec-level
 * `environmentIntensity` maps to scene.environmentIntensity — in three r175
 * material.envMapIntensity does not affect scene.environment IBL, so damping
 * has to happen at the scene level.
 */

export const MATERIAL_PRESETS = [
    { id: 'original', label: 'Original (STEP colors)' },
    { id: 'clear-acrylic', label: 'Clear acrylic' },
    { id: 'matte-black', label: 'Matte black acrylic' },
];

const DEFAULT_FACE_COLOR = [0.8, 0.8, 0.8];

/**
 * Classify an occt-import-js mesh by its role in the preview.
 *
 * KiCad's STEP exporter emits silkscreen as zero-thickness planar faces
 * (observed: z-extent exactly 0), while pads/tracks are real solids
 * (>= ~0.035 mm) and the board body is the named "_PCB" solid. Planarity is
 * therefore an unambiguous silkscreen signal.
 *
 * @param {{name?: string, thicknessZ: number}} mesh
 * @returns {'body'|'engraving'}
 */
export function classifyMeshRole(mesh) {
    return mesh.thicknessZ < 0.001 ? 'engraving' : 'body';
}

/**
 * Marker color the WASM engrave post-process paints onto recess faces cut
 * into the board body (see kicad-drc-wasm/src/step_engrave.cpp). Face groups
 * matching this color are styled as engraving even though they belong to the
 * solid body mesh.
 */
export const ENGRAVING_FACE_COLOR = [0.92, 0.92, 0.92];

const ENGRAVING_COLOR_EPS = 0.01;

export function isEngravingFaceColor(color) {
    if (!color || color.length !== 3) return false;
    return color.every((c, i) => Math.abs(c - ENGRAVING_FACE_COLOR[i]) < ENGRAVING_COLOR_EPS);
}

/**
 * @param {string} presetId - one of MATERIAL_PRESETS[].id
 * @param {[number,number,number]|null} faceColor - original STEP face color (0..1)
 * @param {{thicknessMm?: number, role?: 'body'|'engraving'}} opts - board
 *   thickness (drives refraction volume) and mesh role; engraving meshes get
 *   a laser-engraved surface treatment instead of the bulk material
 * @returns {{type: 'phong'|'physical', environmentIntensity?: number, params: object}}
 */
export function materialParamsForPreset(presetId, faceColor, opts = {}) {
    const { thicknessMm = 1.6, role = 'body' } = opts;

    // Standalone engraving plug solids (the removed volume, emitted by the
    // WASM engrave post-process). On clear acrylic they render as frosted
    // translucent glass: transmissive materials are excluded from three.js's
    // transmission buffer, so the surrounding glass can't ghost them.
    if (role === 'engraving-plug' && presetId === 'clear-acrylic') {
        return {
            type: 'physical',
            environmentIntensity: 0.2,
            params: {
                color: [1, 1, 1],
                // milky blend, tuned visually: 55% diffuse white scatter so
                // the marks read against dark backdrops, 45% transmission so
                // they stay translucent
                transmission: 0.45,
                ior: 1.49,
                roughness: 0.55,
                metalness: 0,
                thickness: 0.5,
                polygonOffset: true,
            },
        };
    }

    if ((role === 'engraving' || role === 'engraving-plug') && presetId !== 'original') {
        switch (presetId) {
            case 'clear-acrylic':
                // Laser engraving frosts acrylic: opaque, diffuse, near-white.
                // insetMm sinks the marks INSIDE the glass so the surface
                // occludes the direct render — they're then seen only via the
                // transmission pass: a single copy, softened by the glass
                // roughness, and visible (reversed) from the back side.
                return {
                    type: 'physical',
                    environmentIntensity: 0.2,
                    insetMm: 0.05,
                    params: {
                        color: [0.92, 0.92, 0.92],
                        roughness: 0.85,
                        metalness: 0,
                        doubleSided: true,
                        // engraved-STEP recess overlays are coplanar with the
                        // body surface; offset wins the depth fight
                        polygonOffset: true,
                    },
                };
            case 'matte-black':
                // Engraving exposes lighter, diffusing material
                return {
                    type: 'physical',
                    environmentIntensity: 0.12,
                    params: {
                        color: [0.45, 0.45, 0.45],
                        roughness: 0.9,
                        metalness: 0,
                        doubleSided: true,
                        polygonOffset: true,
                    },
                };
            default:
                throw new Error(`Unknown material preset: ${presetId}`);
        }
    }

    switch (presetId) {
        case 'original':
            return {
                type: 'phong',
                params: { color: faceColor || DEFAULT_FACE_COLOR },
            };

        case 'clear-acrylic':
            // Front faces only: the exported board is a closed solid, and
            // rendering interior back-faces adds a second transmission layer
            // that ghosts anything sitting on the surface. Environment damped
            // to 0.2 — RoomEnvironment's light panel otherwise blows out to
            // an opaque white blob on the glossy surface (tuned visually).
            return {
                type: 'physical',
                environmentIntensity: 0.2,
                params: {
                    color: [1, 1, 1],
                    transmission: 1,
                    ior: 1.49,
                    roughness: 0.05,
                    metalness: 0,
                    thickness: thicknessMm,
                },
            };

        case 'matte-black':
            return {
                type: 'physical',
                // Full-strength IBL washes a 5%-albedo surface out to
                // mid-grey; damp it so the material reads as matte black
                environmentIntensity: 0.12,
                params: {
                    color: [0.05, 0.05, 0.05],
                    roughness: 0.95,
                    metalness: 0,
                },
            };

        default:
            throw new Error(`Unknown material preset: ${presetId}`);
    }
}
