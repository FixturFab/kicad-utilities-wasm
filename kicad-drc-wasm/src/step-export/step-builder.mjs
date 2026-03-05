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
   * Degenerate edges (same start/end point) are skipped.
   */
  buildWire(vertices, z = 0) {
    const oc = this.oc;
    const wireMaker = new oc.BRepBuilderAPI_MakeWire_1();

    for (let i = 0; i < vertices.length; i++) {
      const [x1, y1] = vertices[i];
      const [x2, y2] = vertices[(i + 1) % vertices.length];
      // Skip degenerate edges (same point)
      if (Math.abs(x2 - x1) < 1e-6 && Math.abs(y2 - y1) < 1e-6) continue;
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
   * Build a single copper layer solid from its polygon data.
   * Each copper layer polygon is extruded by the layer thickness at the correct Z.
   * Returns an array of TopoDS_Shape solids for this layer.
   */
  buildCopperLayerSolids(copperLayer) {
    const oc = this.oc;
    const z = copperLayer.z_start_mm;
    const thickness = copperLayer.thickness_mm || 0.035;
    const solids = [];

    for (const poly of copperLayer.polygons) {
      if (!poly.outline || poly.outline.length < 3) continue;

      const outerWire = this.buildWire(poly.outline, z);
      const faceMaker = new oc.BRepBuilderAPI_MakeFace_15(outerWire, true);

      // Add holes as inner wires
      if (poly.holes && poly.holes.length > 0) {
        for (const hole of poly.holes) {
          if (hole.length >= 3) {
            const holeWire = this.buildWire(hole, z);
            faceMaker.Add(holeWire);
          }
        }
      }

      const face = faceMaker.Face();
      // Extrude downward by copper thickness
      const vec = new oc.gp_Vec_4(0, 0, -thickness);
      const prism = new oc.BRepPrimAPI_MakePrism_1(face, vec, false, true);
      solids.push(prism.Shape());
    }

    return solids;
  }

  /**
   * Build all copper layers as solids.
   * Returns an array of TopoDS_Shape solids.
   */
  buildAllCopperLayers() {
    const copperLayers = this.geometry.copper_layers;
    if (!copperLayers || copperLayers.length === 0) return [];

    const allSolids = [];
    for (const layer of copperLayers) {
      if (!layer.polygons || layer.polygons.length === 0) continue;
      const layerSolids = this.buildCopperLayerSolids(layer);
      allSolids.push(...layerSolids);
    }
    return allSolids;
  }

  /**
   * Cut drill holes from a list of copper solids.
   * Only cuts holes that span the layer's Z range.
   */
  cutHolesFromCopperSolids(solids, copperLayers) {
    const oc = this.oc;
    const holes = this.geometry.holes;
    if (!holes || holes.length === 0 || solids.length === 0) return solids;

    const boardThickness = this.geometry.board.thickness_mm || 1.6;

    // Build a map of copper layer z ranges
    const layerZRanges = [];
    for (const layer of copperLayers) {
      if (!layer.polygons || layer.polygons.length === 0) continue;
      const z_top = layer.z_start_mm;
      const z_bottom = z_top - (layer.thickness_mm || 0.035);
      layerZRanges.push({ z_top, z_bottom });
    }

    // Build cylinders for holes - extend slightly beyond copper for clean cuts
    const cylinders = [];
    for (const hole of holes) {
      const radius = hole.diameter_mm / 2;
      if (radius <= 0) continue;
      // Extend cylinder through full board for simplicity (through-holes)
      const z_top = 0.1;
      const z_bottom = -(boardThickness + 0.1);
      cylinders.push(this.buildHoleCylinder(hole.x_mm, hole.y_mm, radius, z_top, z_bottom));
    }

    if (cylinders.length === 0) return solids;

    // Fuse all hole cylinders
    let fusedHoles = cylinders[0];
    for (let i = 1; i < cylinders.length; i++) {
      const fuse = new oc.BRepAlgoAPI_Fuse_3(fusedHoles, cylinders[i]);
      fusedHoles = fuse.Shape();
    }

    // Cut holes from each copper solid
    return solids.map(solid => {
      const cut = new oc.BRepAlgoAPI_Cut_3(solid, fusedHoles);
      return cut.Shape();
    });
  }

  /**
   * Build the board body and export as STEP.
   * Options: includeDrillHoles, includeCopperLayers.
   */
  buildAndExport(options = {}) {
    const oc = this.oc;
    const includeDrillHoles = options.includeDrillHoles !== false;
    const includeCopperLayers = options.includeCopperLayers !== false;

    let boardShape = this.buildBoardBody();
    if (includeDrillHoles) {
      boardShape = this.cutDrillHoles(boardShape);
    }

    // If no copper layers requested, just export the board
    if (!includeCopperLayers) {
      return this.writeStep(boardShape);
    }

    // Build copper layer solids
    let copperSolids = this.buildAllCopperLayers();

    // Cut holes from copper if needed
    if (includeDrillHoles && copperSolids.length > 0) {
      const copperLayers = (this.geometry.copper_layers || []).filter(
        l => l.polygons && l.polygons.length > 0
      );
      copperSolids = this.cutHolesFromCopperSolids(copperSolids, copperLayers);
    }

    // If no copper solids, just export the board
    if (copperSolids.length === 0) {
      return this.writeStep(boardShape);
    }

    // Assemble into compound: board + all copper solids
    const compound = new oc.TopoDS_Compound();
    const builder = new oc.BRep_Builder();
    builder.MakeCompound(compound);
    builder.Add(compound, boardShape);
    for (const solid of copperSolids) {
      builder.Add(compound, solid);
    }

    return this.writeStep(compound);
  }
}
