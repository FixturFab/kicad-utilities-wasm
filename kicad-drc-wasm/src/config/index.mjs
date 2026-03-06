/**
 * High-level configuration helpers for the KiCad WASM module.
 *
 * Wraps the low-level _kicad_configure_drc / _kicad_configure_erc C exports
 * so callers can pass plain JS objects instead of manually allocating strings.
 */

/**
 * Configure DRC settings on the loaded PCB.
 * Must call after loading a PCB and before running DRC.
 *
 * @param {import('../../types/kicad-wasm').KicadWasmModule} module
 * @param {import('../../types/kicad-wasm').DrcConfig} config
 * @returns {number} 0 on success, non-zero on error
 */
export function configureDrc(module, config) {
    const json = JSON.stringify(config);
    const len = module.lengthBytesUTF8(json) + 1;
    const ptr = module._malloc(len);
    module.stringToUTF8(json, ptr, len);
    const result = module._kicad_configure_drc(ptr);
    module._free(ptr);
    return result;
}

/**
 * Configure ERC settings on the loaded schematic.
 * Must call after loading a schematic and before running ERC.
 *
 * @param {import('../../types/kicad-wasm').KicadWasmModule} module
 * @param {import('../../types/kicad-wasm').ErcConfig} config
 * @returns {number} 0 on success, non-zero on error
 */
export function configureErc(module, config) {
    const json = JSON.stringify(config);
    const len = module.lengthBytesUTF8(json) + 1;
    const ptr = module._malloc(len);
    module.stringToUTF8(json, ptr, len);
    const result = module._kicad_configure_erc(ptr);
    module._free(ptr);
    return result;
}
