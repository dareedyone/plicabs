import { getRecordingStatus } from '#lib/server/obs/recording.js';
import { obsHandle } from '../respond.js';
import type { RequestHandler } from './$types';

/**
 * Queries OBS for the current recording state. Connects if needed: unlike
 * GET /api/obs/status, this cannot be answered from in-memory connection state.
 */
export const GET: RequestHandler = () => obsHandle(() => getRecordingStatus());
