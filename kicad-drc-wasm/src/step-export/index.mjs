/**
 * PCB to STEP export - Public API
 *
 * PREFERRED: Use the native export via Module.ccall('kicad_export_step', ...)
 * which uses KiCad's own STEP exporter with OCCT 7.6.3 compiled to WASM.
 * This produces exact parity with native kicad-cli.
 *
 * DEPRECATED: The opencascade.js-based export below is kept for backward
 * compatibility but produces slightly different output than native kicad-cli.
 */

import { initOpenCascade, StepBuilder } from './step-builder.mjs';

let ocInstance = null;

/**
 * Export PCB geometry to STEP format using the native KiCad WASM exporter.
 * Requires a loaded WASM module with _kicad_load_pcb already called.
 *
 * @param {object} Module - The Emscripten WASM module (from createKicadDRC())
 * @param {object} [options] - Export options (see NativeStepExportOptions in types)
 * @returns {string|null} STEP file content as string, or null on error
 */
export function exportStepNative(Module, options = {}) {
  const optionsJson = JSON.stringify({
    board_only: true,
    export_board_body: true,
    export_components: false,
    ...options,
  });
  return Module.ccall('kicad_export_step', 'string', ['string'], [optionsJson]);
}

/**
 * Upload a 3D model file to the WASM virtual filesystem for component export.
 *
 * @param {object} Module - The Emscripten WASM module
 * @param {string} virtualPath - Relative path (e.g. "Package_SO.3dshapes/SOIC-8.step")
 * @param {Uint8Array} data - Binary file data
 * @returns {number} 0 on success, non-zero on error
 */
export function upload3DModel(Module, virtualPath, data) {
  return Module.ccall(
    'kicad_upload_3d_model',
    'number',
    ['string', 'array', 'number'],
    [virtualPath, data, data.length]
  );
}

/**
 * Set the base directory for 3D model resolution.
 *
 * @param {object} Module - The Emscripten WASM module
 * @param {string} [path="/models"] - Directory path in virtual FS
 * @returns {number} 0 on success, non-zero on error
 */
export function set3DModelDir(Module, path = '/models') {
  return Module.ccall(
    'kicad_set_3d_model_dir',
    'number',
    ['string'],
    [path]
  );
}

/**
 * Export PCB with component 3D models to STEP format.
 * Convenience wrapper that uploads models, sets the model dir, and exports.
 *
 * @param {object} Module - The Emscripten WASM module
 * @param {Map<string,Uint8Array>|Object} models - Map of virtual path -> binary data
 * @param {object} [options] - Additional export options
 * @returns {string|null} STEP file content as string, or null on error
 */
export function exportStepWithModels(Module, models, options = {}) {
  // Upload all model files
  const entries = models instanceof Map ? models.entries() : Object.entries(models);
  for (const [path, data] of entries) {
    const result = upload3DModel(Module, path, data);
    if (result !== 0) {
      console.error(`Failed to upload model: ${path}`);
    }
  }

  // Export with components enabled
  return exportStepNative(Module, {
    board_only: false,
    export_components: true,
    model_dir: '/models',
    ...options,
  });
}

/**
 * @deprecated Use exportStepNative() instead for exact kicad-cli parity.
 *
 * Export PCB geometry to STEP format via opencascade.js (JS reimplementation).
 */
export async function exportPcbToStep(geometryJson, options = {}) {
  if (!ocInstance) {
    ocInstance = await initOpenCascade();
  }

  const builder = new StepBuilder(ocInstance, geometryJson);
  return builder.buildAndExport(options);
}
