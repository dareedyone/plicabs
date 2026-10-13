import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './tests/e2e',
	testMatch: /.*\.spec\.ts$/,
	fullyParallel: false,
	retries: 0,
	timeout: 20000,
	reporter: [['list']],
	use: {
		baseURL: 'http://127.0.0.1:4173',
		headless: true,
		trace: 'on-first-retry',
		browserName: 'chromium',
		...devices['Desktop Chrome']
	},
	webServer: {
		command:
			'OBS_HOST=127.0.0.1 OBS_PORT=4455 OBS_PASSWORD= npm run dev -- --host 127.0.0.1 --port 4173',
		url: 'http://127.0.0.1:4173',
		reuseExistingServer: !process.env.CI,
		timeout: 120000
	}
});
