import { defineConfig } from 'vitest/config';

process.env.BASE_URL ??= 'http://localhost:5173';

export default defineConfig({
	test: {
		name: 'integration',
		environment: 'node',
		include: ['tests/integration/**/*.spec.ts'],
		env: {
			BASE_URL: process.env.BASE_URL ?? 'http://localhost:5173'
		},
		testTimeout: 30000,
		hookTimeout: 30000,
		passWithNoTests: false,
		reporters: ['default']
	}
});
