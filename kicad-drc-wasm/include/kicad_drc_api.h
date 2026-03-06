#pragma once

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Load a KiCad PCB from in-memory content (s-expression format).
 * @param pcb_content  Null-terminated string of the .kicad_pcb file content.
 * @param length       Length of pcb_content in bytes (0 = use strlen).
 * @return 0 on success, non-zero error code on failure.
 */
int kicad_load_pcb(const char* pcb_content, size_t length);

/**
 * Configure DRC settings via JSON before running DRC.
 * Must call kicad_load_pcb() first. Call before kicad_run_drc().
 * All fields are optional — omitted fields keep their values from the PCB file.
 * @param json_config  JSON string with design_settings overrides (mm units).
 * @return 0 on success, non-zero error code on failure.
 */
int kicad_configure_drc(const char* json_config);

/**
 * Run DRC checks on the loaded PCB.
 * Must call kicad_load_pcb() first.
 * @return Number of violations found, or -1 on error.
 */
int kicad_run_drc(void);

/**
 * Get DRC results as a JSON string.
 * The returned pointer is valid until the next call to kicad_run_drc() or kicad_cleanup().
 * @return JSON string following the schemas.kicad.org/drc.v1.json schema, or NULL on error.
 */
const char* kicad_get_drc_results(void);

/**
 * Free all resources (board, DRC engine, results).
 */
void kicad_cleanup(void);

/**
 * Load a KiCad schematic from in-memory content (s-expression format).
 * @param sch_content  Null-terminated string of the .kicad_sch file content.
 * @param length       Length of sch_content in bytes (0 = use strlen).
 * @return 0 on success, non-zero error code on failure.
 */
int kicad_load_schematic(const char* sch_content, size_t length);

/**
 * Load an additional schematic sheet (for hierarchical designs).
 * Must be called BEFORE kicad_load_schematic() so that the child sheet
 * files are available on the virtual filesystem when the root schematic
 * is parsed (KiCad's loader recursively resolves child sheets by filename).
 * @param sheet_path   Relative path of the sheet (as referenced in root schematic).
 * @param content      Null-terminated string of the .kicad_sch sheet content.
 * @param length       Length of content in bytes (0 = use strlen).
 * @return 0 on success, non-zero error code on failure.
 */
int kicad_load_schematic_sheet(const char* sheet_path, const char* content, size_t length);

/**
 * Configure ERC settings via JSON before running ERC.
 * Must call kicad_load_schematic() first. Call before kicad_run_erc().
 * All fields are optional — omitted fields keep their values from the schematic.
 * @param json_config  JSON string with severities and pin_map overrides.
 * @return 0 on success, non-zero error code on failure.
 */
int kicad_configure_erc(const char* json_config);

/**
 * Run ERC checks on the loaded schematic.
 * Must call kicad_load_schematic() first.
 * @return Number of violations found, or -1 on error.
 */
int kicad_run_erc(void);

/**
 * Get ERC results as a JSON string.
 * The returned pointer is valid until the next call to kicad_run_erc() or kicad_cleanup_schematic().
 * @return JSON string following the schemas.kicad.org/erc.v1.json schema, or NULL on error.
 */
const char* kicad_get_erc_results(void);

/**
 * Free schematic resources (schematic, ERC engine, results).
 */
void kicad_cleanup_schematic(void);

/**
 * Get PCB geometry as a JSON string.
 * Extracts board outline, stackup, component placement, and other geometric
 * data suitable for 3D STEP file generation.
 * Must call kicad_load_pcb() first.
 * The returned pointer is valid until the next call to this function or kicad_cleanup().
 * @return JSON string with PCB geometry data, or NULL on error.
 */
const char* kicad_get_pcb_geometry(void);

#ifdef __cplusplus
}
#endif
