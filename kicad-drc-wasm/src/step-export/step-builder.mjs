/**
 * StepBuilder - Creates STEP files from PCB geometry JSON using opencascade.js
 */

import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirnameSelf = dirname(__filename);

/**
 * Initialize the OpenCascade WASM module.
 * Returns the oc instance ready for use.
 */
export async function initOpenCascade() {
  const require = createRequire(import.meta.url);

  // Resolve the opencascade.js dist directory
  const ocDistDir = dirname(require.resolve('opencascade.js/dist/opencascade.wasm.js'));
  const wasmPath = join(ocDistDir, 'opencascade.wasm.wasm');
  const wasmBinary = readFileSync(wasmPath);

  // Node v24+ loads CJS modules with `export default` as ESM, where __dirname
  // is not available. Set it globally so the Emscripten module can find its files.
  const savedDirname = globalThis.__dirname;
  globalThis.__dirname = ocDistDir;

  // Prevent Emscripten from registering process-level abort handlers that
  // kill the process on any unhandled rejection or uncaught exception.
  const origOn = process.on.bind(process);
  process.on = function(event, handler) {
    if (event === 'unhandledRejection' || event === 'uncaughtException') return process;
    return origOn(event, handler);
  };

  const mod = require('opencascade.js/dist/opencascade.wasm.js');
  const factory = mod.default || mod;
  const oc = await factory({ wasmBinary });

  process.on = origOn;

  // Restore
  if (savedDirname !== undefined) {
    globalThis.__dirname = savedDirname;
  } else {
    delete globalThis.__dirname;
  }

  return oc;
}

export class StepBuilder {
  constructor(oc, geometry) {
    this.oc = oc;
    this.geometry = geometry;
  }

  /**
   * Build a wire from an array of [x, y] vertices on a given Z plane.
   */
  buildWire(vertices, z = 0) {
    const oc = this.oc;
    const wireMaker = new oc.BRepBuilderAPI_MakeWire_1();

    for (let i = 0; i < vertices.length; i++) {
      const [x1, y1] = vertices[i];
      const [x2, y2] = vertices[(i + 1) % vertices.length];
      const pt1 = new oc.gp_Pnt_3(x1, y1, z);
      const pt2 = new oc.gp_Pnt_3(x2, y2, z);
      const edge = new oc.BRepBuilderAPI_MakeEdge_3(pt1, pt2);
      wireMaker.Add_1(edge.Edge());
    }

    return wireMaker.Wire();
  }

  /**
   * Build the board body solid from outline polygons.
   * Extrudes the board outline by the board thickness along Z.
   */
  buildBoardBody() {
    const oc = this.oc;
    const { board } = this.geometry;
    const thickness = board.thickness_mm || 1.6;
    const polygons = board.outline.polygons;

    if (!polygons || polygons.length === 0) {
      throw new Error('No board outline polygons found');
    }

    // Build the first outline polygon
    const firstPoly = polygons[0];
    const outerWire = this.buildWire(firstPoly.outline, 0);

    // Create face from outer wire
    const faceMaker = new oc.BRepBuilderAPI_MakeFace_15(outerWire, true);

    // Add holes as inner wires
    if (firstPoly.holes && firstPoly.holes.length > 0) {
      for (const hole of firstPoly.holes) {
        if (hole.length >= 3) {
          const holeWire = this.buildWire(hole, 0);
          faceMaker.Add(holeWire);
        }
      }
    }

    const face = faceMaker.Face();

    // Extrude the face downward (negative Z = into the board)
    const vec = new oc.gp_Vec_4(0, 0, -thickness);
    const prism = new oc.BRepPrimAPI_MakePrism_1(face, vec, false, true);

    return prism.Shape();
  }

  /**
   * Write a shape to STEP format and return the binary data.
   */
  writeStep(shape) {
    const oc = this.oc;

    // opencascade.js has an SSO bug: filenames >10 chars get garbled.
    // Use a short filename and write to a known writable directory.
    const outDir = '/home/web_user';
    try { oc.FS.mkdir('/home'); } catch (e) { /* exists */ }
    try { oc.FS.mkdir(outDir); } catch (e) { /* exists */ }

    const prevCwd = oc.FS.cwd();
    oc.FS.chdir(outDir);

    const fname = 'out.step'; // <=10 chars to avoid SSO bug
    const fpath = outDir + '/' + fname;

    const writer = new oc.STEPControl_Writer_1();
    writer.Transfer(shape, oc.STEPControl_StepModelType.STEPControl_AsIs, true);
    writer.Write(fname);
    writer.delete();

    oc.FS.chdir(prevCwd);

    // Read the file from the known location
    let data;
    try {
      data = oc.FS.readFile(fpath);
    } catch (e) {
      throw new Error('STEP file was not written to virtual FS');
    }

    // Clean up
    try { oc.FS.unlink(fpath); } catch (e) { /* ignore */ }

    return new Uint8Array(data);
  }

  /**
   * Build the board body and export as STEP.
   */
  buildAndExport() {
    const boardBody = this.buildBoardBody();
    return this.writeStep(boardBody);
  }
}
