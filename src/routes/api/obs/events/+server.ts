import { getObsEventHub, type ObsHubEvent } from '#lib/server/obs/events.js';
import type { RequestHandler } from './$types';

const SSE_KEEPALIVE_MS = 20_000;

function encode(chunk: string): Uint8Array {
	return new TextEncoder().encode(chunk);
}

function frame(type: string, data: unknown): string {
	return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Server-sent events for OBS connection, recording, and scene changes.
 * The stream stays open when OBS is down; the hub reconnects while this client is subscribed.
 */
export const GET: RequestHandler = ({ request }) => {
	const hub = getObsEventHub();
	let keepalive: ReturnType<typeof setInterval> | undefined;
	let unsubscribe: (() => void) | undefined;

	const cleanup = () => {
		clearInterval(keepalive);
		keepalive = undefined;
		unsubscribe?.();
		unsubscribe = undefined;
	};

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (chunk: string) => {
				controller.enqueue(encode(chunk));
			};

			unsubscribe = hub.subscribe((event: ObsHubEvent) => {
				try {
					send(frame(event.type, event.data));
				} catch {
					cleanup();
				}
			});

			try {
				send(frame('snapshot', await hub.snapshot()));
			} catch {
				send(
					frame('snapshot', {
						connection: { state: 'disconnected', lastError: 'OBS_UNAVAILABLE' },
						recording: null,
						scenes: null
					})
				);
			}

			keepalive = setInterval(() => {
				try {
					send(': ping\n\n');
				} catch {
					cleanup();
				}
			}, SSE_KEEPALIVE_MS);

			request.signal.addEventListener('abort', () => {
				cleanup();
				try {
					controller.close();
				} catch {
					// Already closed by cancel().
				}
			});
		},
		cancel() {
			cleanup();
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
