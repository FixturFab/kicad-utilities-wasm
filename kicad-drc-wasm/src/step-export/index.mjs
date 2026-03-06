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
