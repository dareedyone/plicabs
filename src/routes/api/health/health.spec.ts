import { describe, expect, it } from 'vitest';
import { GET } from './+server';
import type { RequestEvent } from './$types';

describe('GET /api/health', () => {
	it('returns 200 with an ok status', async () => {
		const response = await GET({} as RequestEvent);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: 'ok' });
	});
});
