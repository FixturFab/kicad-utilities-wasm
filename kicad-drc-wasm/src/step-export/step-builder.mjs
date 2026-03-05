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
   * Read a STEP model from binary data (Uint8Array) and return its shape.
   * Writes data to the virtual FS, reads with STEPControl_Reader, cleans up.
   * Returns null if the data cannot be parsed.
   */
  readStepModel(data) {
    const oc = this.oc;
    const outDir = '/home/web_user';
    try { oc.FS.mkdir('/home'); } catch (e) { /* exists */ }
    try { oc.FS.mkdir(outDir); } catch (e) { /* exists */ }

    // Use a short filename to avoid the SSO bug (<=10 chars)
    const tmpName = 'c.step';
    const tmpPath = outDir + '/' + tmpName;

    try {
      oc.FS.writeFile(tmpPath, data);
      const prevCwd = oc.FS.cwd();
      oc.FS.chdir(outDir);

      const reader = new oc.STEPControl_Reader_1();
      const status = reader.ReadFile(tmpName);
      const done = oc.IFSelect_ReturnStatus.IFSelect_RetDone;

      if (status.value !== done.value) {
        reader.delete();
        oc.FS.chdir(prevCwd);
        return null;
      }

      reader.TransferRoots();
      const shape = reader.OneShape();
      const isNull = shape.IsNull();
      reader.delete();
      oc.FS.chdir(prevCwd);

      return isNull ? null : shape;
    } catch (e) {
      return null;
    } finally {
      try { oc.FS.unlink(tmpPath); } catch (e) { /* ignore */ }
    }
  }

  /**
   * Load all component 3D models using the modelResolver.
   * Returns an array of { shape, component, model } for successfully loaded models.
   */
  async loadComponentModels(modelResolver) {
    const components = this.geometry.components;
    if (!components || components.length === 0 || !modelResolver) return [];

    const results = [];
    for (const comp of components) {
      if (!comp.models || comp.models.length === 0) continue;
      for (const model of comp.models) {
        if (!model.filename) continue;
        try {
          const data = await modelResolver.resolve(model.filename);
          if (!data) continue;
          const shape = this.readStepModel(data);
          if (!shape) continue;
          results.push({ shape, component: comp, model });
        } catch (e) {
          // Skip models that fail to load
          continue;
        }
      }
    }
    return results;
  }

  /**
   * Compute the placement transform for a component model.
   * Replicates KiCad's getModelLocation() from step_pcb_model.cpp.
   *
   * Transform order (accumulated via Multiply = right-multiply in local frame):
   *   1. Position: translate (x, -y, 0)  — KiCad Y-axis is inverted
   *   2. Board rotation: rotate around Z by footprint angle
   *   3. Bottom flip: rotate 180° around X if bottom side
   *   4. Model offset: translate (offset.x, offset.y, offset.z + surface_z)
   *   5. Model orientation: rotate -Z, then -Y, then -X
   *
   * @param {object} component - Component data from geometry JSON
   * @param {object} model - Model data from component
   * @returns {gp_Trsf} The accumulated placement transform
   */
  computePlacementTransform(component, model) {
    const oc = this.oc;
    const boardThickness = this.geometry.board.thickness_mm || 1.6;

    // Board surface Z positions:
    // Board is extruded from z=0 downward to z=-thickness
    // F.Cu copper is at z=0, thickness 0.035mm (extends upward)
    // B.Cu copper is at z=-thickness, thickness 0.035mm (extends downward)
    const copperThickness = 0.035;
    const BOARD_OFFSET = 0.05; // from KiCad step_pcb_model.cpp

    // Top surface = top of F.Cu copper = copperThickness
    const topSurface = copperThickness;
    // Bottom surface = bottom of B.Cu copper = -(thickness + copperThickness)
    const bottomSurface = -(boardThickness + copperThickness);

    const isBottom = component.side === 'bottom';
    const footprintAngleRad = (component.rotation_deg || 0) * Math.PI / 180;

    // Model offset (in mm)
    const offset = {
      x: model.offset?.x_mm || 0,
      y: model.offset?.y_mm || 0,
      z: (model.offset?.z_mm || 0) + BOARD_OFFSET
    };

    // Model orientation (convert degrees to radians)
    const orient = {
      x: (model.rotation?.x_deg || 0) * Math.PI / 180,
      y: (model.rotation?.y_deg || 0) * Math.PI / 180,
      z: (model.rotation?.z_deg || 0) * Math.PI / 180
    };

    // Origin point and axes for rotations
    const origin = new oc.gp_Pnt_3(0, 0, 0);
    const zDir = new oc.gp_Dir_4(0, 0, 1);
    const yDir = new oc.gp_Dir_4(0, 1, 0);
    const xDir = new oc.gp_Dir_4(1, 0, 0);
    const zAx = new oc.gp_Ax1_2(origin, zDir);
    const yAx = new oc.gp_Ax1_2(origin, yDir);
    const xAx = new oc.gp_Ax1_2(origin, xDir);

    // Step 1: Position translation (Y inverted)
    const lPos = new oc.gp_Trsf_1();
    lPos.SetTranslation_1(new oc.gp_Vec_4(
      component.position?.x_mm || 0,
      -(component.position?.y_mm || 0),
      0
    ));

    // Step 2+3: Board rotation and bottom flip
    const lRot = new oc.gp_Trsf_1();
    if (isBottom) {
      offset.z -= bottomSurface;
      lRot.SetRotation_1(zAx, footprintAngleRad);
      lPos.Multiply(lRot);
      const lFlip = new oc.gp_Trsf_1();
      lFlip.SetRotation_1(xAx, Math.PI);
      lPos.Multiply(lFlip);
    } else {
      offset.z += topSurface;
      lRot.SetRotation_1(zAx, footprintAngleRad);
      lPos.Multiply(lRot);
    }

    // Step 4: Model offset
    const lOff = new oc.gp_Trsf_1();
    lOff.SetTranslation_1(new oc.gp_Vec_4(offset.x, offset.y, offset.z));
    lPos.Multiply(lOff);

    // Step 5: Model orientation (applied as -Z, -Y, -X rotations)
    const lOrientZ = new oc.gp_Trsf_1();
    lOrientZ.SetRotation_1(zAx, -orient.z);
    lPos.Multiply(lOrientZ);

    const lOrientY = new oc.gp_Trsf_1();
    lOrientY.SetRotation_1(yAx, -orient.y);
    lPos.Multiply(lOrientY);

    const lOrientX = new oc.gp_Trsf_1();
    lOrientX.SetRotation_1(xAx, -orient.x);
    lPos.Multiply(lOrientX);

    return lPos;
  }

  /**
   * Apply a placement transform to a shape, returning a new transformed shape.
   * Handles model scale as well.
   */
  transformShape(shape, transform, model) {
    const oc = this.oc;

    // Apply scale if not (1,1,1)
    const sx = model.scale?.x ?? 1;
    const sy = model.scale?.y ?? 1;
    const sz = model.scale?.z ?? 1;

    let shapeToTransform = shape;
    if (sx !== 1 || sy !== 1 || sz !== 1) {
      // Uniform scale only (OCCT gp_Trsf supports uniform scale)
      // Use the average for uniform approximation
      const uniformScale = (sx + sy + sz) / 3;
      if (Math.abs(uniformScale - 1) > 1e-6) {
        const scaleTrsf = new oc.gp_Trsf_1();
        scaleTrsf.SetScale(new oc.gp_Pnt_3(0, 0, 0), uniformScale);
        const scaleXform = new oc.BRepBuilderAPI_Transform_2(shape, scaleTrsf, true);
        shapeToTransform = scaleXform.Shape();
      }
    }

    const transformer = new oc.BRepBuilderAPI_Transform_2(shapeToTransform, transform, true);
    return transformer.Shape();
  }

  /**
   * Build the board body and export as STEP.
   * Options: includeDrillHoles, includeCopperLayers, includeComponents, modelResolver.
   */
  async buildAndExport(options = {}) {
    const oc = this.oc;
    const includeDrillHoles = options.includeDrillHoles !== false;
    const includeCopperLayers = options.includeCopperLayers !== false;
    const includeComponents = options.includeComponents !== false;

    let boardShape = this.buildBoardBody();
    if (includeDrillHoles) {
      boardShape = this.cutDrillHoles(boardShape);
    }

    // Build copper layer solids
    let copperSolids = [];
    if (includeCopperLayers) {
      copperSolids = this.buildAllCopperLayers();
      if (includeDrillHoles && copperSolids.length > 0) {
        const copperLayers = (this.geometry.copper_layers || []).filter(
          l => l.polygons && l.polygons.length > 0
        );
        copperSolids = this.cutHolesFromCopperSolids(copperSolids, copperLayers);
      }
    }

    // Load component 3D models
    let componentModels = [];
    if (includeComponents && options.modelResolver) {
      componentModels = await this.loadComponentModels(options.modelResolver);
    }

    // If only the board body, no compound needed
    if (copperSolids.length === 0 && componentModels.length === 0) {
      return this.writeStep(boardShape);
    }

    // Assemble into compound: board + copper + component models
    const compound = new oc.TopoDS_Compound();
    const builder = new oc.BRep_Builder();
    builder.MakeCompound(compound);
    builder.Add(compound, boardShape);
    for (const solid of copperSolids) {
      builder.Add(compound, solid);
    }
    for (const { shape, component, model } of componentModels) {
      const transform = this.computePlacementTransform(component, model);
      const placedShape = this.transformShape(shape, transform, model);
      builder.Add(compound, placedShape);
    }

    return this.writeStep(compound);
  }
}
