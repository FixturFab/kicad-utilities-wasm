/**
 * Specctra DSN/SES API — JavaScript helpers for the autorouting workflow.
 *
 * Workflow: loadPcb() → exportDsn() → [external autorouter] → importSes() → savePcb()
 */

/**
 * Export the loaded PCB to Specctra DSN format.
 *
 * @param {object} Module - The Emscripten WASM module (from createKicadDRC())
 * @returns {string|null} DSN file content as string, or null on error
 */
export function exportDsn(Module) {
    const ptr = Module._kicad_export_dsn();
    if (!ptr) return null;
    return Module.UTF8ToString(ptr);
}

/**
 * Import a Specctra session (SES) file into the loaded PCB.
 * Applies routed tracks from the autorouter to the board.
 *
 * @param {object} Module - The Emscripten WASM module
 * @param {string} sesContent - SES file content string
 * @returns {number} 0 on success, non-zero error code on failure
 */
export function importSes(Module, sesContent) {
    const len = Module.lengthBytesUTF8(sesContent) + 1;
    const ptr = Module._malloc(len);
    try {
        Module.stringToUTF8(sesContent, ptr, len);
        return Module._kicad_import_ses(ptr, 0);
    } finally {
        Module._free(ptr);
    }
}

/**
 * Save the loaded PCB to KiCad s-expression format (.kicad_pcb).
 *
 * @param {object} Module - The Emscripten WASM module
 * @returns {string|null} .kicad_pcb file content as string, or null on error
 */
export function savePcb(Module) {
    const ptr = Module._kicad_save_pcb();
    if (!ptr) return null;
    return Module.UTF8ToString(ptr);
}

/**
 * Load a PCB from string content into the WASM module.
 * Convenience wrapper around _kicad_load_pcb.
 *
 * @param {object} Module - The Emscripten WASM module
 * @param {string} pcbContent - .kicad_pcb file content
 * @returns {number} 0 on success, non-zero error code on failure
 */
export function loadPcb(Module, pcbContent) {
    const len = Module.lengthBytesUTF8(pcbContent) + 1;
    const ptr = Module._malloc(len);
    try {
        Module.stringToUTF8(pcbContent, ptr, len);
        return Module._kicad_load_pcb(ptr, 0);
    } finally {
        Module._free(ptr);
    }
}
