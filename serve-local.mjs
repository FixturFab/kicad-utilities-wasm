#!/usr/bin/env node
/**
 * Local development server for KiCad DRC WASM demo
 *
 * Serves the public/ directory with COOP/COEP headers required for SharedArrayBuffer.
 *
 * Usage: node serve-local.mjs [port]
 */

import { createServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { readFile, stat } from 'fs/promises';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');
const PORT = parseInt(process.argv[2]) || 8080;
const HTTPS_PORT = PORT + 1; // 8081 by default

// Load TLS cert if available
const certPath = join(__dirname, 'server-cert.pem');
const keyPath = join(__dirname, 'server-key.pem');
const hasTLS = existsSync(certPath) && existsSync(keyPath);

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.wasm': 'application/wasm',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.kicad_pcb': 'text/plain',
    '.kicad_sch': 'text/plain',
    '.step': 'application/step',
    '.stp': 'application/step',
};

function handler(req, res) {
    // Add COOP/COEP headers for SharedArrayBuffer support
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');

    let url = req.url.split('?')[0];
    if (url === '/') url = '/index.html';

    const filePath = join(PUBLIC_DIR, url);

    // Security: prevent directory traversal
    if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    (async () => {
        try {
            const stats = await stat(filePath);
            if (!stats.isFile()) {
                throw new Error('Not a file');
            }

            const ext = extname(filePath).toLowerCase();
            const contentType = MIME_TYPES[ext] || 'application/octet-stream';

            const content = await readFile(filePath);
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        } catch (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404);
                res.end(`Not found: ${url}`);
            } else {
                res.writeHead(500);
                res.end('Internal server error');
            }
        }
    })();
}

const server = createServer(handler);
server.listen(PORT, () => {
    console.log(`\n  KiCad DRC WASM Demo Server`);
    console.log(`  ─────────────────────────`);
    console.log(`  HTTP:    http://localhost:${PORT}/`);
    console.log(`\n  COOP/COEP headers enabled for SharedArrayBuffer`);
});

if (hasTLS) {
    const tlsOptions = {
        key: readFileSync(keyPath),
        cert: readFileSync(certPath),
    };
    const httpsServer = createHttpsServer(tlsOptions, handler);
    httpsServer.listen(HTTPS_PORT, () => {
        console.log(`  HTTPS:   https://0.0.0.0:${HTTPS_PORT}/  (self-signed)`);
        console.log(`\n  For public IP access, use HTTPS (required for SharedArrayBuffer)\n`);
        console.log(`  Press Ctrl+C to stop\n`);
    });
} else {
    console.log(`\n  No TLS cert found. For HTTPS, generate one:`);
    console.log(`  openssl req -x509 -newkey rsa:2048 -keyout server-key.pem -out server-cert.pem -days 365 -nodes -subj '/CN=dev'\n`);
    console.log(`  Press Ctrl+C to stop\n`);
}
