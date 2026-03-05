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
   * Create a cylinder solid for a drill hole.
   * The cylinder spans from z_top to z_bottom along Z axis.
   */
  buildHoleCylinder(x, y, radius, z_top, z_bottom) {
    const oc = this.oc;
    const height = z_top - z_bottom;
    const axis = new oc.gp_Ax2_3(
      new oc.gp_Pnt_3(x, y, z_bottom),
      new oc.gp_Dir_4(0, 0, 1)
    );
    const cyl = new oc.BRepPrimAPI_MakeCylinder_3(axis, radius, height);
    return cyl.Shape();
  }

  /**
   * Cut drill holes from the board body using boolean subtraction.
   * Fuses all hole cylinders first, then does a single cut operation.
   */
  cutDrillHoles(boardShape) {
    const oc = this.oc;
    const holes = this.geometry.holes;

    if (!holes || holes.length === 0) {
      return boardShape;
    }

    const thickness = this.geometry.board.thickness_mm || 1.6;
    // Board is extruded from z=0 downward to z=-thickness
    const z_top = 0.1;  // slightly above top surface for clean cut
    const z_bottom = -(thickness + 0.1);  // slightly below bottom

    // Build cylinder for each hole
    const cylinders = [];
    for (const hole of holes) {
      const radius = hole.diameter_mm / 2;
      if (radius <= 0) continue;
      cylinders.push(this.buildHoleCylinder(hole.x_mm, hole.y_mm, radius, z_top, z_bottom));
    }

    if (cylinders.length === 0) {
      return boardShape;
    }

    // Fuse all cylinders into one compound shape
    let fusedHoles = cylinders[0];
    for (let i = 1; i < cylinders.length; i++) {
      const fuse = new oc.BRepAlgoAPI_Fuse_3(fusedHoles, cylinders[i]);
      fusedHoles = fuse.Shape();
    }

    // Single boolean cut: board minus all holes
    const cut = new oc.BRepAlgoAPI_Cut_3(boardShape, fusedHoles);
    return cut.Shape();
  }

  /**
   * Build the board body and export as STEP.
   * Optionally cuts drill holes from the board.
   */
  buildAndExport(options = {}) {
    const includeDrillHoles = options.includeDrillHoles !== false;
    let shape = this.buildBoardBody();
    if (includeDrillHoles) {
      shape = this.cutDrillHoles(shape);
    }
    return this.writeStep(shape);
  }
}
