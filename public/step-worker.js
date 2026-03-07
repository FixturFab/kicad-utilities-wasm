/**
 * Web Worker for STEP export.
 *
 * Runs the KiCad WASM module off the main thread so the UI stays responsive
 * during the (potentially long) STEP export.
 */

let Module = null;

self.onmessage = async function (e) {
    const { type, payload } = e.data;

    if (type === 'export') {
        try {
            const { pcbContent, optionsJson } = payload;

            if (!Module) {
                self.postMessage({ type: 'status', message: 'Loading WASM module...' });
                const { default: createKicadDRC } = await import('./kicad_drc.mjs');
                Module = await createKicadDRC({
                    print: (text) => self.postMessage({ type: 'log', message: text }),
                    printErr: () => {},
                });
                await new Promise(r => setTimeout(r, 500));
                self.postMessage({ type: 'status', message: 'WASM module loaded' });
            }

            // Load PCB
            self.postMessage({ type: 'status', message: 'Loading PCB...' });
            const len = Module.lengthBytesUTF8(pcbContent) + 1;
            const ptr = Module._malloc(len);
            Module.stringToUTF8(pcbContent, ptr, len);
            const rc = Module._kicad_load_pcb(ptr, 0);
            Module._free(ptr);

            if (rc !== 0) {
                throw new Error('Failed to load PCB (error code: ' + rc + ')');
            }

            // Export STEP
            self.postMessage({ type: 'status', message: 'Generating STEP (this may take 10-30s)...' });
            const stepContent = Module.ccall(
                'kicad_export_step', 'string', ['string'], [optionsJson]
            );

            if (!stepContent) {
                throw new Error('STEP export returned null');
            }

            Module._kicad_cleanup();

            self.postMessage({ type: 'result', stepContent });
        } catch (err) {
            self.postMessage({ type: 'error', message: err.message });
        }
    }
};
