#!/usr/bin/env node
/**
 * Build release bundles for kicad-wasm-utilities
 *
 * Creates distribution packages for:
 * - Full package (all features)
 * - Individual feature documentation packages
 *
 * Usage: node scripts/build-releases.mjs
 */

import { mkdirSync, cpSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const PKG_DIR = join(ROOT, 'kicad-drc-wasm');

// Read version from package.json
const pkg = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf-8'));
const VERSION = pkg.version;

console.log(`Building kicad-wasm-utilities v${VERSION} release bundles...\n`);

// Clean dist directory
if (existsSync(DIST)) {
    execSync(`rm -rf "${DIST}"`, { stdio: 'inherit' });
}
mkdirSync(DIST, { recursive: true });

// Core files shared by all packages
const CORE_FILES = [
    'build-wasm-erc/kicad_drc.mjs',
    'build-wasm-erc/kicad_drc.wasm',
    'types/kicad-wasm.d.ts',
];

// Feature-specific files
const FEATURES = {
    drc: {
        name: 'DRC (Design Rule Check)',
        files: ['src/config/index.mjs'],
        readme: `# KiCad WASM Utilities - DRC

Run PCB Design Rule Checks in the browser or Node.js.

## Usage

\`\`\`javascript
import createKicadWasm from 'kicad-wasm-utilities';
import { configureDrc } from 'kicad-wasm-utilities/config';

const Module = await createKicadWasm();

// Load PCB
const pcbContent = await fetch('board.kicad_pcb').then(r => r.text());
const len = Module.lengthBytesUTF8(pcbContent) + 1;
const ptr = Module._malloc(len);
Module.stringToUTF8(pcbContent, ptr, len);
Module._kicad_load_pcb(ptr, 0);
Module._free(ptr);

// Configure DRC (optional)
configureDrc(Module, {
    design_settings: {
        min_track_width_mm: 0.2,
        min_clearance_mm: 0.15
    }
});

// Run DRC
const violationCount = Module._kicad_run_drc();
const results = JSON.parse(Module.UTF8ToString(Module._kicad_get_drc_results()));

console.log(\`Found \${violationCount} violations\`);
Module._kicad_cleanup();
\`\`\`
`
    },
    erc: {
        name: 'ERC (Electrical Rules Check)',
        files: ['src/config/index.mjs'],
        readme: `# KiCad WASM Utilities - ERC

Run Schematic Electrical Rules Checks in the browser or Node.js.

## Usage

\`\`\`javascript
import createKicadWasm from 'kicad-wasm-utilities';
import { configureErc } from 'kicad-wasm-utilities/config';

const Module = await createKicadWasm();

// Load schematic
const schContent = await fetch('schematic.kicad_sch').then(r => r.text());
const len = Module.lengthBytesUTF8(schContent) + 1;
const ptr = Module._malloc(len);
Module.stringToUTF8(schContent, ptr, len);
Module._kicad_load_schematic(ptr, 0);
Module._free(ptr);

// Configure ERC (optional)
configureErc(Module, {
    severities: {
        pin_not_connected: 'error',
        pin_not_driven: 'warning'
    }
});

// Run ERC
const violationCount = Module._kicad_run_erc();
const results = JSON.parse(Module.UTF8ToString(Module._kicad_get_erc_results()));

console.log(\`Found \${violationCount} violations\`);
Module._kicad_cleanup_schematic();
\`\`\`
`
    },
    step: {
        name: 'STEP Export',
        files: ['src/step-export/index.mjs', 'src/step-export/step-builder.mjs'],
        readme: `# KiCad WASM Utilities - STEP Export

Generate 3D STEP models from PCB layouts in the browser or Node.js.

## Usage

\`\`\`javascript
import createKicadWasm from 'kicad-wasm-utilities';
import { exportStepNative, set3DModelDir } from 'kicad-wasm-utilities/step-export';

const Module = await createKicadWasm();

// Load PCB
const pcbContent = await fetch('board.kicad_pcb').then(r => r.text());
const len = Module.lengthBytesUTF8(pcbContent) + 1;
const ptr = Module._malloc(len);
Module.stringToUTF8(pcbContent, ptr, len);
Module._kicad_load_pcb(ptr, 0);
Module._free(ptr);

// Get board geometry
const geoPtr = Module._kicad_get_pcb_geometry();
const geometry = JSON.parse(Module.UTF8ToString(geoPtr));

// Export STEP (native OCCT-based)
const stepContent = await exportStepNative(Module, {
    board_only: true,
    export_tracks: false,
    export_zones: false
});

// Download or process the STEP file
console.log(\`Generated STEP: \${stepContent.length} bytes\`);

Module._kicad_cleanup();
\`\`\`
`
    },
    specctra: {
        name: 'Specctra DSN/SES',
        files: ['src/specctra/index.mjs'],
        readme: `# KiCad WASM Utilities - Specctra DSN/SES

Export PCB to Specctra DSN format and import routed SES files.

## Usage

\`\`\`javascript
import createKicadWasm from 'kicad-wasm-utilities';
import { exportDsn, importSes, savePcb, loadPcb } from 'kicad-wasm-utilities/specctra';

const Module = await createKicadWasm();

// Load PCB
const pcbContent = await fetch('board.kicad_pcb').then(r => r.text());
loadPcb(Module, pcbContent);

// Export to DSN for autorouter
const dsnContent = exportDsn(Module);
console.log('DSN exported:', dsnContent.length, 'bytes');

// After routing with external autorouter, import SES
const sesContent = await fetch('routed.ses').then(r => r.text());
const rc = importSes(Module, sesContent);
if (rc === 0) {
    console.log('SES imported successfully');
}

// Save modified PCB
const newPcbContent = savePcb(Module);
console.log('Modified PCB:', newPcbContent.length, 'bytes');

Module._kicad_cleanup();
\`\`\`
`
    }
};

// Build full package
function buildFullPackage() {
    console.log('Building full package...');
    const fullDir = join(DIST, `kicad-wasm-utilities-${VERSION}`);
    mkdirSync(fullDir, { recursive: true });

    // Copy core files
    for (const file of CORE_FILES) {
        const src = join(PKG_DIR, file);
        const dest = join(fullDir, file);
        if (existsSync(src)) {
            mkdirSync(dirname(dest), { recursive: true });
            cpSync(src, dest);
            console.log(`  Copied: ${file}`);
        } else {
            console.warn(`  Warning: ${file} not found`);
        }
    }

    // Copy all feature files
    const allFeatureFiles = new Set();
    for (const feature of Object.values(FEATURES)) {
        for (const file of feature.files) {
            allFeatureFiles.add(file);
        }
    }
    for (const file of allFeatureFiles) {
        const src = join(PKG_DIR, file);
        const dest = join(fullDir, file);
        if (existsSync(src)) {
            mkdirSync(dirname(dest), { recursive: true });
            cpSync(src, dest);
            console.log(`  Copied: ${file}`);
        }
    }

    // Copy package.json
    cpSync(join(PKG_DIR, 'package.json'), join(fullDir, 'package.json'));

    // Create combined README
    let readme = `# KiCad WASM Utilities v${VERSION}

KiCad PCB and schematic tools running in the browser or Node.js via WebAssembly.

## Features

- **DRC** - Design Rule Check for PCB layouts
- **ERC** - Electrical Rules Check for schematics
- **STEP Export** - Generate 3D STEP models from PCB
- **Specctra DSN/SES** - Autorouter integration

## Installation

\`\`\`bash
npm install kicad-wasm-utilities
\`\`\`

## Quick Start

\`\`\`javascript
import createKicadWasm from 'kicad-wasm-utilities';

const Module = await createKicadWasm();
// Use DRC, ERC, STEP, or Specctra APIs
\`\`\`

## Imports

\`\`\`javascript
// Main module (DRC/ERC core)
import createKicadWasm from 'kicad-wasm-utilities';

// Configuration API
import { configureDrc, configureErc } from 'kicad-wasm-utilities/config';

// STEP export
import { exportStepNative } from 'kicad-wasm-utilities/step-export';

// Specctra DSN/SES
import { exportDsn, importSes, savePcb } from 'kicad-wasm-utilities/specctra';
\`\`\`

## Requirements

- Node.js 18+ or modern browser with WebAssembly support
- For browser: Serve with COOP/COEP headers for SharedArrayBuffer

## License

GPL-3.0 (based on KiCad source code)
`;

    writeFileSync(join(fullDir, 'README.md'), readme);
    console.log(`  Created: README.md`);

    return fullDir;
}

// Build feature-specific documentation packages
function buildFeaturePackages() {
    for (const [key, feature] of Object.entries(FEATURES)) {
        console.log(`\nBuilding ${feature.name} package...`);
        const featureDir = join(DIST, `kicad-wasm-${key}-${VERSION}`);
        mkdirSync(featureDir, { recursive: true });

        // Copy core files
        for (const file of CORE_FILES) {
            const src = join(PKG_DIR, file);
            const dest = join(featureDir, file);
            if (existsSync(src)) {
                mkdirSync(dirname(dest), { recursive: true });
                cpSync(src, dest);
            }
        }

        // Copy feature-specific files
        for (const file of feature.files) {
            const src = join(PKG_DIR, file);
            const dest = join(featureDir, file);
            if (existsSync(src)) {
                mkdirSync(dirname(dest), { recursive: true });
                cpSync(src, dest);
                console.log(`  Copied: ${file}`);
            }
        }

        // Create feature-specific package.json
        const featurePkg = {
            name: `kicad-wasm-${key}`,
            version: VERSION,
            description: `KiCad ${feature.name} via WebAssembly`,
            type: 'module',
            main: 'build-wasm-erc/kicad_drc.mjs',
            types: 'types/kicad-wasm.d.ts',
            license: 'GPL-3.0',
            engines: { node: '>=18.0.0' }
        };
        writeFileSync(join(featureDir, 'package.json'), JSON.stringify(featurePkg, null, 2));

        // Create feature README
        writeFileSync(join(featureDir, 'README.md'), feature.readme);
        console.log(`  Created: README.md`);
    }
}

// Create zip archives
function createArchives() {
    console.log('\nCreating archives...');

    const dirs = [
        `kicad-wasm-utilities-${VERSION}`,
        `kicad-wasm-drc-${VERSION}`,
        `kicad-wasm-erc-${VERSION}`,
        `kicad-wasm-step-${VERSION}`,
        `kicad-wasm-specctra-${VERSION}`
    ];

    for (const dir of dirs) {
        const dirPath = join(DIST, dir);
        if (existsSync(dirPath)) {
            const zipPath = `${dirPath}.zip`;
            try {
                // Use tar on Unix, PowerShell on Windows
                if (process.platform === 'win32') {
                    execSync(`powershell Compress-Archive -Path "${dirPath}\\*" -DestinationPath "${zipPath}" -Force`, { cwd: DIST });
                } else {
                    execSync(`zip -r "${dir}.zip" "${dir}"`, { cwd: DIST });
                }
                console.log(`  Created: ${dir}.zip`);
            } catch (err) {
                console.warn(`  Warning: Could not create ${dir}.zip - ${err.message}`);
            }
        }
    }
}

// Main
try {
    buildFullPackage();
    buildFeaturePackages();
    createArchives();
    console.log(`\nRelease bundles created in: ${DIST}`);
} catch (err) {
    console.error('Build failed:', err);
    process.exit(1);
}
