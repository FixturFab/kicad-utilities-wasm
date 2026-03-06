/**
 * Type definitions for kicad-cli-wasm.
 *
 * Provides DRC (Design Rules Check) and ERC (Electrical Rules Check)
 * validation via KiCad compiled to WebAssembly.
 */

// --- Emscripten Module ---

export interface KicadWasmModule extends EmscriptenModule {
    /** Diagnostic ping - returns 42 if module is working. */
    _diag_ping(): number;

    // --- DRC (PCB) API ---

    /**
     * Load a KiCad PCB from in-memory content (.kicad_pcb s-expression format).
     * @param contentPtr Pointer to null-terminated string of PCB content.
     * @param length Length in bytes (0 = use strlen).
     * @returns 0 on success, non-zero error code on failure.
     */
    _kicad_load_pcb(contentPtr: number, length: number): number;

    /**
     * Run DRC checks on the loaded PCB.
     * Must call _kicad_load_pcb() first.
     * @returns Number of violations found, or -1 on error.
     */
    _kicad_run_drc(): number;

    /**
     * Get DRC results as a JSON string pointer.
     * @returns Pointer to JSON string (use UTF8ToString), or 0 on error.
     */
    _kicad_get_drc_results(): number;

    /** Free all PCB/DRC resources. */
    _kicad_cleanup(): void;

    // --- ERC (Schematic) API ---

    /**
     * Load a KiCad schematic from in-memory content (.kicad_sch s-expression format).
     * @param contentPtr Pointer to null-terminated string of schematic content.
     * @param length Length in bytes (0 = use strlen).
     * @returns 0 on success, non-zero error code on failure.
     */
    _kicad_load_schematic(contentPtr: number, length: number): number;

    /**
     * Load an additional schematic sheet for hierarchical designs.
     * Must be called BEFORE _kicad_load_schematic() for the root sheet.
     * @param sheetPathPtr Pointer to relative sheet path string.
     * @param contentPtr Pointer to null-terminated sheet content string.
     * @param length Length in bytes (0 = use strlen).
     * @returns 0 on success, non-zero error code on failure.
     */
    _kicad_load_schematic_sheet(sheetPathPtr: number, contentPtr: number, length: number): number;

    /**
     * Run ERC checks on the loaded schematic.
     * Must call _kicad_load_schematic() first.
     * @returns Number of violations found, or -1 on error.
     */
    _kicad_run_erc(): number;

    /**
     * Get ERC results as a JSON string pointer.
     * @returns Pointer to JSON string (use UTF8ToString), or 0 on error.
     */
    _kicad_get_erc_results(): number;

    /** Free all schematic/ERC resources. */
    _kicad_cleanup_schematic(): void;

    // --- PCB Geometry API (for STEP export) ---

    /**
     * Get PCB geometry as a JSON string pointer.
     * Must call _kicad_load_pcb() first.
     * @returns Pointer to JSON string (use UTF8ToString), or 0 on error.
     */
    _kicad_get_pcb_geometry(): number;

    // --- Native STEP Export API ---

    /**
     * Export the loaded PCB to STEP format using KiCad's native exporter (OCCT 7.6.3).
     * Must call _kicad_load_pcb() first.
     * Use via ccall: Module.ccall('kicad_export_step', 'string', ['string'], [optionsJson])
     * @param optionsJsonPtr Pointer to JSON options string (see NativeStepExportOptions).
     * @returns Pointer to STEP file content string, or 0 on error.
     */
    _kicad_export_step(optionsJsonPtr: number): number;

    // --- 3D Model Support API ---

    /**
     * Set the 3D model search directory. Sets KICAD*_3DMODEL_DIR env var.
     * Call before _kicad_export_step() with export_components enabled.
     * @param pathPtr Pointer to directory path string (e.g. "/models").
     * @returns 0 on success, non-zero on error.
     */
    _kicad_set_3d_model_dir(pathPtr: number): number;

    /**
     * Upload a 3D model file to the Emscripten virtual filesystem.
     * Files are written under /models/<virtual_path>.
     * @param virtualPathPtr Pointer to relative path string (e.g. "Package_SO.3dshapes/SOIC-8.step").
     * @param dataPtr Pointer to file binary data.
     * @param size Size of the data in bytes.
     * @returns 0 on success, non-zero on error.
     */
    _kicad_upload_3d_model(virtualPathPtr: number, dataPtr: number, size: number): number;
}

export interface EmscriptenModule {
    _malloc(size: number): number;
    _free(ptr: number): void;
    lengthBytesUTF8(str: string): number;
    stringToUTF8(str: string, outPtr: number, maxBytesToWrite: number): void;
    UTF8ToString(ptr: number): string;
}

export interface KicadWasmModuleOptions {
    print?: (text: string) => void;
    printErr?: (text: string) => void;
    locateFile?: (path: string, scriptDirectory: string) => string;
}

/** Factory function exported by the WASM module. */
export default function createKicadWasm(options?: KicadWasmModuleOptions): Promise<KicadWasmModule>;

// --- DRC JSON Result Types ---

/** DRC result JSON following schemas.kicad.org/drc.v1.json */
export interface DrcResult {
    $schema: string;
    coordinate_units: string;
    date: string;
    kicad_version: string;
    source: string;
    violations: DrcViolation[];
    unconnected_items: DrcViolation[];
}

export interface DrcViolation {
    type: string;
    severity: 'error' | 'warning';
    description: string;
    items: DrcViolationItem[];
}

export interface DrcViolationItem {
    description: string;
    pos: Position;
    uuid: string;
}

// --- ERC JSON Result Types ---

/** ERC result JSON following schemas.kicad.org/erc.v1.json */
export interface ErcResult {
    $schema: string;
    coordinate_units: string;
    date: string;
    kicad_version: string;
    source: string;
    sheets: ErcSheet[];
}

export interface ErcSheet {
    path: string;
    uuid_path: string;
    violations: ErcViolation[];
}

export interface ErcViolation {
    type: ErcViolationType;
    severity: 'error' | 'warning';
    description: string;
    items: ErcViolationItem[];
}

export interface ErcViolationItem {
    description: string;
    pos: Position;
    uuid: string;
}

export interface Position {
    x: number;
    y: number;
}

/** All known ERC violation type strings. */
export type ErcViolationType =
    | 'bus_definition_conflict'
    | 'bus_entry_needed'
    | 'bus_to_bus_conflict'
    | 'bus_to_net_conflict'
    | 'different_unit_footprint'
    | 'different_unit_net'
    | 'duplicate_pins'
    | 'duplicate_reference'
    | 'duplicate_sheet_names'
    | 'endpoint_off_grid'
    | 'extra_units'
    | 'field_name_whitespace'
    | 'footprint_filter'
    | 'footprint_link_issues'
    | 'four_way_junction'
    | 'generic-error'
    | 'generic-warning'
    | 'ground_pin_not_ground'
    | 'hier_label_mismatch'
    | 'isolated_pin_label'
    | 'label_dangling'
    | 'label_multiple_wires'
    | 'lib_symbol_issues'
    | 'lib_symbol_mismatch'
    | 'missing_bidi_pin'
    | 'missing_input_pin'
    | 'missing_power_pin'
    | 'missing_unit'
    | 'multiple_net_names'
    | 'net_not_bus_member'
    | 'no_connect_connected'
    | 'no_connect_dangling'
    | 'pin_not_connected'
    | 'pin_not_driven'
    | 'pin_to_pin'
    | 'power_pin_not_driven'
    | 'same_local_global_label'
    | 'similar_label_and_power'
    | 'similar_labels'
    | 'similar_power'
    | 'simulation_model_issue'
    | 'single_global_label'
    | 'stacked_pin_name'
    | 'unannotated'
    | 'unconnected_wire_endpoint'
    | 'undefined_netclass'
    | 'unit_value_mismatch'
    | 'unresolved_variable'
    | 'wire_dangling'
    | (string & {}); // Allow unknown types for forward compatibility

// --- PCB Geometry Types (for STEP export) ---

export interface PcbGeometry {
    format_version: number;
    units: string;
    board: PcbBoard;
    stackup: PcbStackupLayer[];
    copper_layers: PcbCopperLayer[];
    holes: PcbHole[];
    components: PcbComponent[];
}

export interface PcbBoard {
    outline: {
        polygons: PcbPolygon[];
    };
    thickness_mm: number;
}

export interface PcbPolygon {
    outline: [number, number][];
    holes: [number, number][][];
    net?: string;
}

export interface PcbStackupLayer {
    type: 'copper' | 'dielectric' | 'soldermask' | 'silkscreen' | 'solderpaste';
    layer_id: string;
    thickness_mm: number;
    z_offset_mm: number;
    material?: string;
    epsilon_r?: number;
}

export interface PcbCopperLayer {
    layer_id: string;
    z_start_mm: number;
    thickness_mm: number;
    polygons: PcbPolygon[];
}

export interface PcbHole {
    type: 'pth' | 'npth';
    x_mm: number;
    y_mm: number;
    diameter_mm: number;
    top_layer: string;
    bottom_layer: string;
    plating_thickness_mm: number;
}

export interface PcbComponent {
    reference: string;
    footprint: string;
    position: { x_mm: number; y_mm: number };
    rotation_deg: number;
    side: 'top' | 'bottom';
    models: PcbComponentModel[];
}

export interface PcbComponentModel {
    filename: string;
    offset: { x_mm: number; y_mm: number; z_mm: number };
    rotation: { x_deg: number; y_deg: number; z_deg: number };
    scale: { x: number; y: number; z: number };
}

// --- STEP Export API ---

/** Resolves 3D model filenames to STEP file data. */
export interface ModelResolver {
    resolve(filename: string): Promise<Uint8Array | null>;
}

export interface StepExportOptions {
    /** Resolve 3D model filenames to STEP file data. Optional. */
    modelResolver?: ModelResolver;
    /** Include copper layers. Default: true. */
    includeCopperLayers?: boolean;
    /** Include drill holes. Default: true. */
    includeDrillHoles?: boolean;
    /** Include 3D component models. Default: true. */
    includeComponents?: boolean;
}

/**
 * Export PCB geometry to STEP format using opencascade.js.
 * @param geometryJson PCB geometry JSON from kicad_get_pcb_geometry()
 * @param options Export options
 * @returns STEP file data
 */
export function exportPcbToStep(
    geometryJson: PcbGeometry,
    options?: StepExportOptions
): Promise<Uint8Array>;

// --- Native STEP Export Options (for _kicad_export_step) ---

/** Options JSON for the native _kicad_export_step() API. */
export interface NativeStepExportOptions {
    /** Export board outline only (no components). Default: true. */
    board_only?: boolean;
    /** Export the board body (FR4 substrate). Default: true. */
    export_board_body?: boolean;
    /** Export component 3D models. Default: false. */
    export_components?: boolean;
    /** Export copper tracks and vias. Default: false. */
    export_tracks?: boolean;
    /** Export pads. Default: false. */
    export_pads?: boolean;
    /** Export filled zones. Default: false. */
    export_zones?: boolean;
    /** Export silkscreen layers. Default: false. */
    export_silkscreen?: boolean;
    /** Export soldermask layers. Default: false. */
    export_soldermask?: boolean;
    /** Export inner copper layers. Default: false. */
    export_inner_copper?: boolean;
    /** Fuse overlapping shapes for cleaner geometry. Default: false. */
    fuse_shapes?: boolean;
    /** Fill all vias as solid cylinders. Default: false. */
    fill_all_vias?: boolean;
    /** Cut via holes in board body. Default: false. */
    cut_vias_in_body?: boolean;
    /** Optimize STEP output (reduce file size). Default: true. */
    optimize?: boolean;
    /** Include unspecified components. Default: true. */
    include_unspecified?: boolean;
    /** Include DNP (Do Not Place) components. Default: true. */
    include_dnp?: boolean;
    /** Use grid origin as STEP origin. Default: false. */
    use_grid_origin?: boolean;
    /** Use drill/place origin as STEP origin. Default: false. */
    use_drill_origin?: boolean;
    /** Filter by net name (regex). */
    net_filter?: string;
    /** Filter by component reference (regex). */
    component_filter?: string;
    /**
     * Base directory for 3D model files in the virtual filesystem.
     * Sets KICAD*_3DMODEL_DIR env var. Default: "/models".
     * Upload model files here before export using _kicad_upload_3d_model()
     * or Module.FS.writeFile().
     */
    model_dir?: string;
}
