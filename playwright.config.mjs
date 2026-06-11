import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: 'tests',
    testMatch: '**/*.spec.mjs',
    timeout: 60_000,
    use: {
        baseURL: 'http://localhost:8123',
    },
    webServer: {
        command: 'node serve-local.mjs 8123',
        url: 'http://localhost:8123/step.html',
        reuseExistingServer: true,
    },
});
