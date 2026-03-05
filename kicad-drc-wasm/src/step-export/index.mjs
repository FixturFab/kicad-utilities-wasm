/**
 * PCB to STEP export - Public API
 *
 * Takes PCB geometry JSON (from kicad_get_pcb_geometry()) and produces
 * a STEP file using opencascade.js.
 */

import { initOpenCascade, StepBuilder } from './step-builder.mjs';

let ocInstance = null;

/**
 * Export PCB geometry to STEP format.
 *
 * @param {object} geometryJson - PCB geometry JSON from kicad_get_pcb_geometry()
 * @param {object} [options] - Export options
 * @param {boolean} [options.includeCopperLayers=true] - Include copper layers (future)
 * @param {boolean} [options.includeDrillHoles=true] - Include drill holes (future)
 * @param {boolean} [options.includeComponents=true] - Include 3D models (future)
 * @returns {Promise<Uint8Array>} STEP file data
 */
export async function exportPcbToStep(geometryJson, options = {}) {
  if (!ocInstance) {
    ocInstance = await initOpenCascade();
  }

  const builder = new StepBuilder(ocInstance, geometryJson);
  return builder.buildAndExport();
}
