import { getScenes } from '#lib/server/obs/scenes.js';
import { obsHandle } from '../respond.js';
import type { RequestHandler } from './$types';

/**
 * Queries OBS for the scene list and current program scene. Connects if needed:
 * unlike GET /api/obs/status, this cannot be answered from in-memory connection state.
 */
export const GET: RequestHandler = () => obsHandle(() => getScenes());
