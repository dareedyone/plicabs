import { stopRecording } from '#lib/server/obs/recording.js';
import { obsHandle } from '../../respond.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = () => obsHandle(() => stopRecording());
