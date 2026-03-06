# DRC/ERC Configuration API

Configure DRC and ERC validation settings programmatically before running checks.

## Quick Start

```javascript
import createKicadWasm from '@anthropic/kicad-wasm';
import { configureDrc, configureErc } from '@anthropic/kicad-wasm/config';

const module = await createKicadWasm();

// --- DRC ---
// Load PCB, configure, run
loadPcb(module, pcbContent);
configureDrc(module, {
    design_settings: { min_clearance_mm: 0.15, min_track_width_mm: 0.2 },
    severities: { missing_courtyard: 'ignore' }
});
const drcCount = module._kicad_run_drc();

// --- ERC ---
// Load schematic, configure, run
loadSchematic(module, schContent);
configureErc(module, {
    severities: { pin_not_connected: 'warning', four_way_junction: 'ignore' }
});
const ercCount = module._kicad_run_erc();
```

## DRC Configuration

Pass a `DrcConfig` object to `configureDrc()`. All fields are optional — omitted fields keep their values from the PCB file.

### Design Settings

Override board-level numeric constraints. All dimensions in millimeters.

```javascript
configureDrc(module, {
    design_settings: {
        min_clearance_mm: 0.15,
        min_track_width_mm: 0.2,
        min_via_diameter_mm: 0.5,
        min_via_drill_mm: 0.3,
        min_microvia_diameter_mm: 0.2,
        min_microvia_drill_mm: 0.1,
        min_hole_to_hole_mm: 0.25,
        hole_clearance_mm: 0.25,
        copper_edge_clearance_mm: 0.5,
        silk_clearance_mm: 0.0,
        min_silk_text_height_mm: 0.8,
        min_silk_text_thickness_mm: 0.1,
        min_resolved_spokes: 2,
        min_annular_width_mm: 0.13,
        solder_mask_expansion_mm: 0.0,
        solder_mask_min_width_mm: 0.0,
        solder_mask_to_copper_clearance_mm: 0.0,
    }
});
```

### Netclasses

Define netclasses and override per-netclass constraints.

```javascript
configureDrc(module, {
    netclasses: {
        Default: { clearance_mm: 0.2, track_width_mm: 0.25 },
        Power: { clearance_mm: 0.3, track_width_mm: 0.5, via_diameter_mm: 1.0 },
        USB: { diff_pair_width_mm: 0.09, diff_pair_gap_mm: 0.15 }
    },
    netclass_assignments: {
        GND: ['Power'],
        VCC: ['Power'],
        '/USB_D+': ['USB'],
        '/USB_D-': ['USB']
    },
    netclass_patterns: [
        { pattern: 'PWR_*', netclass: 'Power' }
    ]
});
```

### Severities

Override error/warning/ignore level for individual DRC check types.

```javascript
configureDrc(module, {
    severities: {
        clearance: 'error',
        track_width: 'error',
        missing_courtyard: 'ignore',
        silk_clearance: 'warning',
        copper_sliver: 'warning'
    }
});
```

Available severity check names: `clearance`, `track_width`, `via_diameter`, `via_drill`, `hole_clearance`, `hole_to_hole`, `edge_clearance`, `annular_width`, `silk_clearance`, `courtyard_clearance`, `unconnected_items`, `dangling_via`, `dangling_track`, `shorting_items`, `copper_sliver`, `starved_thermal`, `solder_mask_bridge`, `missing_courtyard`, `missing_footprint`, `duplicate_footprint`, `text_height`, `text_thickness`, `track_angle`, `track_segment_length`, `extra_footprint`, `net_conflict`, `unresolved_variable`, `copper_edge_clearance`, `connection_width`, `isolated_copper`, `tracks_crossing`, `malformed_courtyard`, `invalid_outline`, `silk_edge_clearance`, `silk_mask_clearance`, `microvia_drill`, `padstack`.

### Manufacturer Presets

```javascript
// JLCPCB 2-layer minimums
const jlcpcb = {
    design_settings: {
        min_clearance_mm: 0.127,
        min_track_width_mm: 0.127,
        min_via_diameter_mm: 0.45,
        min_via_drill_mm: 0.2,
        min_hole_to_hole_mm: 0.254,
        copper_edge_clearance_mm: 0.3,
    }
};

// OSH Park 2-layer
const oshpark = {
    design_settings: {
        min_clearance_mm: 0.152,
        min_track_width_mm: 0.152,
        min_via_diameter_mm: 0.66,
        min_via_drill_mm: 0.254,
        min_annular_width_mm: 0.178,
    }
};
```

## ERC Configuration

Pass an `ErcConfig` object to `configureErc()`. All fields optional.

### Severities

```javascript
configureErc(module, {
    severities: {
        pin_not_connected: 'error',
        pin_not_driven: 'warning',
        missing_power_pin: 'warning',
        four_way_junction: 'ignore',
        wire_dangling: 'warning'
    }
});
```

Available ERC severity names: `pin_not_connected`, `pin_not_driven`, `powerpin_not_driven`, `missing_power_pin`, `missing_input_pin`, `missing_bidi_pin`, `missing_unit`, `duplicate_sheet_name`, `endpoint_off_grid`, `noconnect_connected`, `noconnect_not_connected`, `label_not_connected`, `similar_labels`, `similar_power`, `similar_label_and_power`, `single_global_label`, `same_local_global_label`, `different_unit_footprint`, `different_unit_net`, `different_unit_value`, `bus_alias_conflict`, `driver_conflict`, `bus_entry_conflict`, `bus_to_bus_conflict`, `bus_to_net_conflict`, `ground_pin_not_ground`, `label_single_pin`, `unresolved_variable`, `undefined_netclass`, `simulation_model`, `wire_dangling`, `lib_symbol_issues`, `lib_symbol_mismatch`, `footprint_link_issues`, `footprint_filters`, `unannotated`, `extra_units`, `duplicate_reference`, `bus_entry_needed`, `four_way_junction`, `label_multiple_wires`, `unconnected_wire_endpoint`, `hierachical_label`.

### Pin Conflict Matrix

Override the pin-to-pin error matrix using `"type1_to_type2"` key format.

```javascript
configureErc(module, {
    pin_map: {
        output_to_output: 'error',
        input_to_input: 'ok',
        passive_to_passive: 'ok',
        power_in_to_power_out: 'ok'
    }
});
```

Pin types: `input`, `output`, `bidirectional`, `tri_state`, `passive`, `free`, `unspecified`, `power_in`, `power_out`, `open_collector`, `open_emitter`, `no_connect`.

Pin error values: `ok`, `warning`, `error`.

## Low-Level API

If you prefer direct WASM calls instead of the wrapper:

```javascript
const json = JSON.stringify(config);
const len = module.lengthBytesUTF8(json) + 1;
const ptr = module._malloc(len);
module.stringToUTF8(json, ptr, len);
const result = module._kicad_configure_drc(ptr); // 0 = success
module._free(ptr);
```

Error codes: `0` success, `-1` no board/schematic loaded, `-3` invalid JSON.
