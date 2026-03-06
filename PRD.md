# DRC/ERC JSON Configuration API - Product Requirements Document

## Overview

**Project Goal**: Add JSON-based configuration of DRC rules, netclasses, design settings, and ERC severity settings to the KiCad WASM module, so users can programmatically control validation parameters before running checks.

**Why**: Currently `kicad_run_drc()` and `kicad_run_erc()` use only the settings embedded in the PCB/schematic file with no way to override them. Production use cases (automated design validation, CI pipelines, configurable rule sets per manufacturer) require programmatic control of:
- Board design constraints (min clearance, min track width, min via size, etc.)
- Netclass definitions (clearance, track width, via size per net group)
- Netclass-to-net assignments
- DRC severity overrides (error/warning/ignore per check type)
- ERC severity overrides and pin conflict matrix
- Custom DRC rules

**Architecture**: New C API functions called between `kicad_load_pcb()` and `kicad_run_drc()`:
```
kicad_load_pcb(content)           // Load the board
kicad_configure_drc(json)         // Override design settings, netclasses, severities
kicad_run_drc()                   // Run with configured settings
kicad_get_drc_results()           // Get results
```

Same pattern for ERC:
```
kicad_load_schematic(content)
kicad_configure_erc(json)
kicad_run_erc()
kicad_get_erc_results()
```

**Target Environments**: Node.js and Browser (same as existing API)

---

## JSON Schema

### DRC Configuration (`kicad_configure_drc`)

```json
{
  "design_settings": {
    "min_clearance_mm": 0.15,
    "min_track_width_mm": 0.2,
    "min_via_diameter_mm": 0.5,
    "min_via_drill_mm": 0.3,
    "min_microvia_diameter_mm": 0.2,
    "min_microvia_drill_mm": 0.1,
    "min_hole_to_hole_mm": 0.25,
    "hole_clearance_mm": 0.25,
    "copper_edge_clearance_mm": 0.5,
    "silk_clearance_mm": 0.0,
    "min_silk_text_height_mm": 0.8,
    "min_silk_text_thickness_mm": 0.1,
    "min_courtyard_clearance_mm": 0.0,
    "min_resolved_spokes": 2,
    "min_annular_width_mm": 0.13,
    "solder_mask_expansion_mm": 0.0,
    "solder_mask_min_width_mm": 0.0,
    "solder_mask_to_copper_clearance_mm": 0.0
  },

  "netclasses": {
    "Default": {
      "clearance_mm": 0.2,
      "track_width_mm": 0.25,
      "via_diameter_mm": 0.8,
      "via_drill_mm": 0.4,
      "microvia_diameter_mm": 0.3,
      "microvia_drill_mm": 0.1,
      "diff_pair_width_mm": 0.2,
      "diff_pair_gap_mm": 0.15,
      "diff_pair_via_gap_mm": 0.15
    },
    "Power": {
      "clearance_mm": 0.3,
      "track_width_mm": 0.5,
      "via_diameter_mm": 1.0,
      "via_drill_mm": 0.5
    }
  },

  "netclass_assignments": {
    "GND": ["Power"],
    "VCC": ["Power"],
    "/USB_D+": ["USB"],
    "/USB_D-": ["USB"]
  },

  "netclass_patterns": [
    { "pattern": "PWR_*", "netclass": "Power" },
    { "pattern": "USB_*", "netclass": "USB" }
  ],

  "severities": {
    "clearance": "error",
    "track_width": "error",
    "via_diameter": "error",
    "via_drill": "error",
    "hole_clearance": "error",
    "hole_to_hole": "error",
    "edge_clearance": "error",
    "annular_width": "warning",
    "silk_clearance": "warning",
    "courtyard_clearance": "warning",
    "unconnected_items": "error",
    "dangling_via": "warning",
    "dangling_track": "warning",
    "duplicate_footprints": "warning",
    "missing_courtyard": "ignore",
    "missing_footprint": "warning",
    "shorting_items": "error",
    "copper_sliver": "warning",
    "starved_thermal": "warning",
    "solder_mask_bridge": "ignore"
  }
}
```

All fields are optional — omitted fields keep their values from the PCB file. All dimensions are in millimeters.

### ERC Configuration (`kicad_configure_erc`)

```json
{
  "severities": {
    "pin_not_connected": "error",
    "pin_not_driven": "error",
    "missing_power_pin": "warning",
    "missing_input_pin": "warning",
    "missing_bidi_pin": "warning",
    "duplicate_sheet_name": "error",
    "endpoint_off_grid": "warning",
    "noconnect_connected": "warning",
    "noconnect_not_connected": "warning",
    "label_not_connected": "error",
    "similar_labels": "warning",
    "similar_power_labels": "ignore",
    "different_unit_footprint": "error",
    "different_unit_net": "error",
    "bus_conflict": "error",
    "wire_dangling": "warning",
    "unresolved_variable": "error",
    "undefined_netclass": "warning",
    "unannotated": "error",
    "extra_units": "warning",
    "different_unit_value": "error",
    "duplicate_reference": "error",
    "four_way_junction": "ignore",
    "lib_symbol_issues": "warning",
    "lib_symbol_mismatch": "warning"
  },

  "pin_map": {
    "input_to_input": "warning",
    "input_to_output": "ok",
    "output_to_output": "error",
    "passive_to_passive": "ok",
    "power_to_power": "ok",
    "unconnected_to_any": "error"
  }
}
```

---

## Reference Code

| Source File | Purpose |
|-------------|---------|
| `kicad-drc-wasm/src/api.cpp` | WASM API — add new functions here |
| `kicad-src/include/board_design_settings.h` | BOARD_DESIGN_SETTINGS class (numeric constraints) |
| `kicad-src/include/netclass.h` | NETCLASS class (per-netclass parameters) |
| `kicad-src/include/project/net_settings.h` | NET_SETTINGS (netclass management + assignments) |
| `kicad-src/pcbnew/drc/drc_rule.h` | DRC_CONSTRAINT_T enum, DRC_RULE class |
| `kicad-src/pcbnew/drc/drc_engine.h` | DRC_ENGINE (settings access, rule evaluation) |
| `kicad-src/eeschema/erc/erc_settings.h` | ERC_SETTINGS (severities, pin map) |
| `kicad-src/eeschema/erc/erc_item.h` | ERCE_T enum (ERC error codes) |
| `kicad-src/pcbnew/drc/drc_item.h` | DRCE_T enum (DRC error codes) |
| `kicad-drc-wasm/types/kicad-wasm.d.ts` | TypeScript type declarations |

**Unit conversion**: KiCad uses nanometers internally. Convert mm to IU via `pcbIUScale.mmToIU(value_mm)` (multiply by 1e6). The JSON API uses millimeters exclusively.

---

## Stage 1: DRC Design Settings Override

**Goal**: Allow overriding board-level numeric constraints (min clearance, min track width, etc.) via JSON before running DRC.

- [x] 1a: Add `kicad_configure_drc(const char* json)` function to `api.cpp`
  - Parse JSON using nlohmann::json (already included)
  - Access `g_board->GetDesignSettings()` to get `BOARD_DESIGN_SETTINGS&`
  - Apply `design_settings` fields if present in JSON
  - Map mm values to internal units via `pcbIUScale.mmToIU()`
  - Fields to support:
    - `min_clearance_mm` → `m_MinClearance`
    - `min_track_width_mm` → `m_TrackMinWidth`
    - `min_via_diameter_mm` → `m_ViasMinSize`
    - `min_via_drill_mm` → `m_MinThroughDrill`
    - `min_microvia_diameter_mm` → `m_MicroViasMinSize`
    - `min_microvia_drill_mm` → `m_MicroViasMinDrill`
    - `min_hole_to_hole_mm` → `m_HoleToHoleMin`
    - `hole_clearance_mm` → `m_HoleClearance`
    - `copper_edge_clearance_mm` → `m_CopperEdgeClearance`
    - `silk_clearance_mm` → `m_SilkClearance`
    - `min_silk_text_height_mm` → `m_MinSilkTextHeight`
    - `min_silk_text_thickness_mm` → `m_MinSilkTextThickness`
    - `min_resolved_spokes` → `m_MinResolvedSpokes`
    - `min_annular_width_mm` → `m_ViasMinAnnularWidth`
    - `solder_mask_expansion_mm` → `m_SolderMaskExpansion`
    - `solder_mask_min_width_mm` → `m_SolderMaskMinWidth`
    - `solder_mask_to_copper_clearance_mm` → `m_SolderMaskToCopperClearance`
  - Return 0 on success, -1 on error
- [x] 1b: Add `_kicad_configure_drc` to EXPORTED_FUNCTIONS in CMakeLists.txt
- [x] 1c: Create `test/test-drc-config.mjs` that:
  1. Loads a PCB with known DRC violations at default settings
  2. Runs DRC with defaults, counts violations
  3. Calls `kicad_configure_drc` with relaxed settings (e.g. larger min clearance)
  4. Runs DRC again, verifies different violation count
  5. Calls `kicad_configure_drc` with strict settings
  6. Runs DRC again, verifies more violations
- [x] 1d: Create test PCB `samples/drc-config-test.kicad_pcb` with:
  - Tracks at various widths (0.1mm, 0.15mm, 0.2mm, 0.25mm)
  - Clearances at various distances (0.1mm, 0.15mm, 0.2mm)
  - Vias at various sizes (0.4mm, 0.5mm, 0.6mm)
  - Drill holes at various spacings
  - So violation count changes predictably with different thresholds

**Verification**: DRC violation count changes when design settings are overridden. Test demonstrates at least 3 different configurations producing different results.

---

## Stage 2: Netclass Configuration

**Goal**: Allow defining netclasses and assigning them to nets via JSON.

- [x] 2a: Add netclass parsing to `kicad_configure_drc`:
  - Parse `netclasses` object from JSON
  - For each netclass name:
    - If "Default", modify `m_defaultNetClass`
    - Otherwise, create new `NETCLASS` and add to `NET_SETTINGS::m_netClasses`
    - Set fields: clearance, track_width, via_diameter, via_drill, microvia_diameter, microvia_drill, diff_pair_width, diff_pair_gap, diff_pair_via_gap
    - All values in mm → convert to IU
  - Access path: `g_board->GetDesignSettings().m_NetSettings->...`
- [x] 2b: Add netclass assignment parsing:
  - Parse `netclass_assignments` object: `{ "net_name": ["netclass1", "netclass2"] }`
  - Apply via `NET_SETTINGS::SetNetclassLabelAssignment()`
  - Parse `netclass_patterns` array: `[{ "pattern": "PWR_*", "netclass": "Power" }]`
  - Apply via `NET_SETTINGS::SetNetclassPatternAssignment()`
- [x] 2c: After applying netclasses, manually iterate nets and assign effective netclasses (BOARD::SynchronizeNetsAndNetClasses requires m_project which is not available in WASM standalone mode)
- [x] 2d: Create test that:
  1. Loads PCB with VCC/GND/SIG nets and close track pairs (0.15mm gap)
  2. Verifies baseline with relaxed Default netclass → no clearance violations
  3. Creates Power netclass with clearance=0.25mm, assigns VCC → 1 violation
  4. Lowers Power clearance to 0.05mm → 0 violations
  5. Assigns both VCC+GND to Power → 2 violations
  6. Tests pattern-based assignment → 1 violation
  7. Tests Default netclass override → 2 violations

**Verification**: Netclass assignments change which DRC rules apply to which nets. Track width violations appear/disappear based on netclass settings.

---

## Stage 3: DRC Severity Configuration

**Goal**: Allow overriding severity (error/warning/ignore) for individual DRC check types.

- [x] 3a: Add severity parsing to `kicad_configure_drc`:
  - Parse `severities` object from JSON
  - Map human-readable names to `DRCE_T` enum values:
    - `"clearance"` → `DRCE_CLEARANCE`
    - `"track_width"` → `DRCE_TRACK_WIDTH`
    - `"via_diameter"` → `DRCE_VIA_DIAMETER`
    - `"via_drill"` → `DRCE_VIA_DRILL_TOO_SMALL` (verify exact name)
    - `"hole_clearance"` → `DRCE_HOLE_CLEARANCE`
    - `"hole_to_hole"` → `DRCE_DRILLED_HOLES_TOO_CLOSE`
    - `"edge_clearance"` → `DRCE_COPPER_EDGE_CLEARANCE`
    - `"annular_width"` → `DRCE_VIA_ANNULAR_WIDTH`
    - `"silk_clearance"` → `DRCE_SILK_CLEARANCE`
    - `"courtyard_clearance"` → `DRCE_OVERLAPPING_FOOTPRINTS`
    - `"unconnected_items"` → `DRCE_UNCONNECTED_ITEMS`
    - `"dangling_via"` → `DRCE_DANGLING_VIA`
    - `"dangling_track"` → `DRCE_DANGLING_TRACK`
    - `"shorting_items"` → `DRCE_SHORTING_ITEMS`
    - `"copper_sliver"` → `DRCE_COPPER_SLIVER`
    - `"starved_thermal"` → `DRCE_STARVED_THERMAL`
    - `"solder_mask_bridge"` → `DRCE_SOLDERMASK_BRIDGE`
    - `"missing_courtyard"` → `DRCE_MISSING_COURTYARD`
    - (full list to be determined from drc_item.h)
  - Map severity strings: `"error"` → `RPT_SEVERITY_ERROR`, `"warning"` → `RPT_SEVERITY_WARNING`, `"ignore"` → `RPT_SEVERITY_IGNORE`
  - Apply via `BOARD_DESIGN_SETTINGS::m_DRCSeverities[errorCode] = severity`
- [x] 3b: Create test that:
  1. Loads a PCB with clearance violations
  2. Runs DRC with default severities — counts errors
  3. Sets `"clearance": "ignore"` — runs DRC, verifies clearance violations gone
  4. Sets `"clearance": "warning"` — runs DRC, verifies clearance items are warnings not errors
- [x] 3c: Verify that severity filtering works in JSON output — warnings and errors should be distinguishable, ignored checks should not appear

**Verification**: Setting severity to "ignore" removes those violations from results. Setting to "warning" changes their severity level.

---

## Stage 4: ERC Configuration

**Goal**: Allow overriding ERC severity settings and pin conflict matrix via JSON.

- [x] 4a: Add `kicad_configure_erc(const char* json)` function to `api.cpp`
  - Parse JSON using nlohmann::json
  - Access ERC settings via the SCHEMATIC object
  - Apply `severities` overrides:
    - Map human-readable names to `ERCE_T` enum values:
      - `"pin_not_connected"` → `ERCE_PIN_NOT_CONNECTED`
      - `"pin_not_driven"` → `ERCE_PIN_NOT_DRIVEN`
      - `"missing_power_pin"` → `ERCE_MISSING_POWER_INPUT_PIN`
      - `"missing_input_pin"` → `ERCE_MISSING_INPUT_PIN`
      - `"missing_bidi_pin"` → `ERCE_MISSING_BIDI_PIN`
      - `"duplicate_sheet_name"` → `ERCE_DUPLICATE_SHEET_NAME`
      - `"endpoint_off_grid"` → `ERCE_ENDPOINT_OFF_GRID`
      - `"noconnect_connected"` → `ERCE_NOCONNECT_CONNECTED`
      - `"noconnect_not_connected"` → `ERCE_NOCONNECT_NOT_CONNECTED`
      - `"label_not_connected"` → `ERCE_LABEL_NOT_CONNECTED`
      - `"similar_labels"` → `ERCE_SIMILAR_LABELS`
      - `"different_unit_footprint"` → `ERCE_DIFFERENT_UNIT_FP`
      - `"different_unit_net"` → `ERCE_DIFFERENT_UNIT_NET`
      - `"wire_dangling"` → `ERCE_WIRE_DANGLING`
      - `"unresolved_variable"` → `ERCE_UNRESOLVED_VARIABLE`
      - `"undefined_netclass"` → `ERCE_UNDEFINED_NETCLASS`
      - `"unannotated"` → `ERCE_UNANNOTATED`
      - `"extra_units"` → `ERCE_EXTRA_UNITS`
      - `"different_unit_value"` → `ERCE_DIFFERENT_UNIT_VALUE`
      - `"duplicate_reference"` → `ERCE_DUPLICATE_REFERENCE`
      - `"four_way_junction"` → `ERCE_FOUR_WAY_JUNCTION`
      - `"lib_symbol_issues"` → `ERCE_LIB_SYMBOL_ISSUES`
      - (full list from erc_settings.h)
    - Apply via `ERC_SETTINGS::SetSeverity(errorCode, severity)`
  - Return 0 on success, -1 on error
- [x] 4b: Add `_kicad_configure_erc` to EXPORTED_FUNCTIONS in CMakeLists.txt
- [x] 4c: Create `test/test-erc-config.mjs` that:
  1. Loads a schematic with known ERC violations
  2. Runs ERC with defaults, counts violations
  3. Sets some checks to "ignore", runs ERC, verifies fewer violations
  4. Sets some checks to "warning", verifies severity level changes in output
- [x] 4d: Optional — add pin conflict matrix override via `pin_map` in JSON

**Verification**: ERC violation count and severity change when settings are overridden.

---

## Stage 5: TypeScript Types and Node.js API

**Goal**: Clean TypeScript API with proper types for all configuration options.

- [x] 5a: Update `types/kicad-wasm.d.ts` with:
  ```typescript
  interface DrcDesignSettings {
    min_clearance_mm?: number;
    min_track_width_mm?: number;
    min_via_diameter_mm?: number;
    min_via_drill_mm?: number;
    min_microvia_diameter_mm?: number;
    min_microvia_drill_mm?: number;
    min_hole_to_hole_mm?: number;
    hole_clearance_mm?: number;
    copper_edge_clearance_mm?: number;
    silk_clearance_mm?: number;
    min_silk_text_height_mm?: number;
    min_silk_text_thickness_mm?: number;
    min_resolved_spokes?: number;
    min_annular_width_mm?: number;
    solder_mask_expansion_mm?: number;
    solder_mask_min_width_mm?: number;
    solder_mask_to_copper_clearance_mm?: number;
  }

  interface NetclassConfig {
    clearance_mm?: number;
    track_width_mm?: number;
    via_diameter_mm?: number;
    via_drill_mm?: number;
    microvia_diameter_mm?: number;
    microvia_drill_mm?: number;
    diff_pair_width_mm?: number;
    diff_pair_gap_mm?: number;
    diff_pair_via_gap_mm?: number;
  }

  type DrcSeverity = 'error' | 'warning' | 'ignore';

  interface DrcConfig {
    design_settings?: DrcDesignSettings;
    netclasses?: Record<string, NetclassConfig>;
    netclass_assignments?: Record<string, string[]>;
    netclass_patterns?: Array<{ pattern: string; netclass: string }>;
    severities?: Record<string, DrcSeverity>;
  }

  interface ErcConfig {
    severities?: Record<string, DrcSeverity>;
    pin_map?: Record<string, string>;
  }

  function kicad_configure_drc(config: string): number;
  function kicad_configure_erc(config: string): number;
  ```
- [x] 5b: Create wrapper functions in a JS module (`src/config/index.mjs`):
  ```javascript
  export function configureDrc(module, config) {
    return module.ccall('kicad_configure_drc', 'number', ['string'], [JSON.stringify(config)]);
  }
  export function configureErc(module, config) {
    return module.ccall('kicad_configure_erc', 'number', ['string'], [JSON.stringify(config)]);
  }
  ```
- [x] 5c: Add `"./config"` export to `package.json`
- [x] 5d: Update README or API docs with configuration examples

**Verification**: TypeScript types compile. JS wrapper functions work in tests.

---

## Stage 6: Integration Tests and Edge Cases

**Goal**: Comprehensive tests covering real-world configuration scenarios.

- [ ] 6a: Test: manufacturer rule sets — JLCPCB, OSH Park, PCBWay minimum specs
  - Create JSON configs matching each manufacturer's DRC rules
  - Verify same PCB passes/fails differently per manufacturer
- [ ] 6b: Test: configuration persistence — verify settings reset when loading a new PCB
- [ ] 6c: Test: invalid JSON handling — malformed JSON, unknown fields, out-of-range values
- [ ] 6d: Test: partial configuration — only overriding some fields, rest keep PCB defaults
- [ ] 6e: Test: netclass priority — when a net has multiple netclass assignments, verify the correct precedence
- [ ] 6f: Add `npm run test:drc-config` and `npm run test:erc-config` scripts to package.json

**Verification**: All manufacturer configs produce expected results. Edge cases handled gracefully.

---

## Key Implementation Notes

1. **Unit conversion**: All JSON values in mm. Convert via `pcbIUScale.mmToIU(value)` which multiplies by 1e6 (KiCad uses nanometers internally).

2. **Timing**: Configuration must happen AFTER `kicad_load_pcb()` (board must exist) and BEFORE `kicad_run_drc()`. The configure function modifies the in-memory BOARD's settings directly.

3. **Netclass sync**: After modifying netclasses or assignments, call `g_board->SynchronizeNetsAndNetClasses(false)` to propagate changes to all pads/tracks/vias.

4. **DRC engine re-init**: The DRC engine builds implicit rules from design settings and netclasses during `InitEngine()`. If `kicad_configure_drc` is called, the DRC engine must be re-initialized before the next `kicad_run_drc()` call to pick up changes.

5. **ERC settings access**: ERC settings are on the SCHEMATIC object, not the BOARD. Access via `g_schematic->ErcSettings()`.

6. **Severity map**: Both DRC and ERC use `std::map<int, SEVERITY>` for severity overrides. The key is the error code enum value. The WASM API maps human-readable string names to enum values for usability.

7. **Optional fields**: All JSON fields are optional. Only specified fields are overridden. This allows incremental configuration on top of PCB-embedded defaults.
