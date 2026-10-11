import OBSWebSocket, { OBSWebSocketError, type OBSResponseTypes } from 'obs-websocket-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getObsConnection, ObsConnection, ObsConnectionError } from './connection';
import { getScenes, switchScene } from './scenes';

vi.mock('$app/env/private', () => ({
	OBS_HOST: '127.0.0.1',
	OBS_PORT: 4455,
	OBS_PASSWORD: 'env-test-password'
}));

const PASSWORD = 'test-password';

type ConnectResult = Awaited<ReturnType<OBSWebSocket['connect']>>;
const connectResult = { obsWebSocketVersion: '5.5.0', negotiatedRpcVersion: 1 } as ConnectResult;

type SceneListResponse = OBSResponseTypes['GetSceneList'];
type CurrentSceneResponse = OBSResponseTypes['GetCurrentProgramScene'];

function sceneList(names: unknown[], current: unknown = names[0]): SceneListResponse {
	return {
		currentProgramSceneName: current as string,
		currentProgramSceneUuid: 'program-uuid',
		currentPreviewSceneName: 'preview',
		currentPreviewSceneUuid: 'preview-uuid',
		scenes: names.map((sceneName, sceneIndex) =>
			typeof sceneName === 'object' && sceneName !== null
				? sceneName
				: { sceneName, sceneIndex, sceneUuid: `uuid-${sceneIndex}` }
		) as SceneListResponse['scenes']
	};
}

function currentScene(sceneName: string): CurrentSceneResponse {
	return {
		sceneName,
		sceneUuid: 'program-uuid',
		currentProgramSceneName: sceneName,
		currentProgramSceneUuid: 'program-uuid'
	};
}

function createStubClient(names: unknown[] = ['Cam', 'Screen'], current: unknown = 'Cam') {
	const client = new OBSWebSocket();
	let identified = false;
	let program = current;

	vi.spyOn(client, 'identified', 'get').mockImplementation(() => identified);
	const connect = vi.spyOn(client, 'connect').mockImplementation(async () => {
		identified = true;
		return connectResult;
	});
	const call = vi.spyOn(client, 'call').mockImplementation(async (type, data) => {
		if (type === 'GetSceneList') return sceneList(names, program);
		if (type === 'GetCurrentProgramScene') return currentScene(String(program));
		if (type === 'SetCurrentProgramScene') {
			program = (data as { sceneName?: string }).sceneName;
			return undefined;
		}
		throw new Error(`unexpected request ${String(type)}`);
	});

	return { client, connect, call };
}

function useConnection(names: unknown[] = ['Cam', 'Screen'], current: unknown = 'Cam') {
	const stub = createStubClient(names, current);
	const connection = new ObsConnection(
		{ host: '127.0.0.1', port: 4455, password: PASSWORD },
		stub.client
	);
	vi.mocked(getObsConnection).mockReturnValue(connection);
	return stub;
}

vi.mock('./connection', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./connection')>();
	return { ...actual, getObsConnection: vi.fn(actual.getObsConnection) };
});

let logs: unknown[][];

beforeEach(() => {
	logs = [];
	const capture = (...args: unknown[]) => void logs.push(args);
	vi.spyOn(console, 'info').mockImplementation(capture);
	vi.spyOn(console, 'warn').mockImplementation(capture);
});

afterEach(() => {
	vi.useRealTimers();
	vi.mocked(getObsConnection).mockReset();
	vi.restoreAllMocks();
	delete (globalThis as { __obsConnection?: ObsConnection }).__obsConnection;
});

describe('getScenes', () => {
	it('returns scene names in OBS order and the current program scene', async () => {
		const stub = useConnection(['Screen', 'Cam', 'Overlay'], 'Cam');

		const list = await getScenes();

		expect(stub.connect).toHaveBeenCalledTimes(1);
		expect(stub.call).toHaveBeenCalledWith('GetSceneList', undefined);
		expect(list).toEqual({
			scenes: ['Screen', 'Cam', 'Overlay'],
			currentScene: 'Cam'
		});
		expect(JSON.stringify(list)).not.toContain('program-uuid');
		expect(JSON.stringify(list)).not.toContain('preview');
	});

	it('skips scene entries whose sceneName is not a string', async () => {
		const stub = useConnection();
		stub.call.mockImplementation(async (type) => {
			if (type === 'GetSceneList') {
				return {
					...sceneList(['Cam']),
					scenes: [
						{ sceneName: 'Cam', sceneUuid: 'keep-out' },
						{ sceneUuid: 'no-name' },
						{ sceneName: 1 },
						null,
						'bare',
						{ sceneName: 'Screen' }
					]
				} as SceneListResponse;
			}
			throw new Error(`unexpected request ${String(type)}`);
		});

		expect(await getScenes()).toEqual({
			scenes: ['Cam', 'Screen'],
			currentScene: 'Cam'
		});
	});

	it('treats a missing or null current program scene as null', async () => {
		useConnection(['Cam'], null);
		expect(await getScenes()).toEqual({ scenes: ['Cam'], currentScene: null });

		const stub = useConnection(['Cam'], 'Cam');
		stub.call.mockImplementation(async (type) => {
			if (type === 'GetSceneList') {
				const raw = sceneList(['Cam'], 'Cam');
				delete (raw as { currentProgramSceneName?: string }).currentProgramSceneName;
				return raw;
			}
			throw new Error(`unexpected request ${String(type)}`);
		});
		expect(await getScenes()).toEqual({ scenes: ['Cam'], currentScene: null });
	});

	it('propagates a connection failure', async () => {
		const stub = useConnection();
		stub.connect.mockRejectedValueOnce(
			new ObsConnectionError('OBS_UNAVAILABLE', 'Could not connect to OBS.')
		);

		await expect(getScenes()).rejects.toMatchObject({ code: 'OBS_UNAVAILABLE' });
		expect(stub.call).not.toHaveBeenCalled();
	});
});

describe('switchScene', () => {
	it('switches after reading the list, then confirms the new program scene', async () => {
		const stub = useConnection(['Cam', 'Screen'], 'Cam');

		const list = await switchScene('Screen');

		expect(stub.call.mock.calls.map(([type]) => type)).toEqual([
			'GetSceneList',
			'SetCurrentProgramScene',
			'GetCurrentProgramScene'
		]);
		expect(stub.call).toHaveBeenCalledWith('SetCurrentProgramScene', { sceneName: 'Screen' });
		expect(list).toEqual({ scenes: ['Cam', 'Screen'], currentScene: 'Screen' });
	});

	it('rejects an unknown scene without sending SetCurrentProgramScene', async () => {
		const stub = useConnection(['Cam'], 'Cam');

		await expect(switchScene('Missing')).rejects.toMatchObject({
			code: 'SCENE_NOT_FOUND',
			message: 'That scene was not found.'
		});
		expect(stub.call.mock.calls.map(([type]) => type)).toEqual(['GetSceneList']);
	});

	it('rejects the already-current scene without sending SetCurrentProgramScene', async () => {
		const stub = useConnection(['Cam', 'Screen'], 'Cam');

		await expect(switchScene('Cam')).rejects.toMatchObject({
			code: 'SCENE_CONFLICT',
			message: 'That scene is already active.'
		});
		expect(stub.call.mock.calls.map(([type]) => type)).toEqual(['GetSceneList']);
	});

	it('matches scene names exactly, without trimming', async () => {
		const stub = useConnection(['Cam'], 'Overlay');

		await expect(switchScene(' Cam')).rejects.toMatchObject({ code: 'SCENE_NOT_FOUND' });
		expect(stub.call.mock.calls.map(([type]) => type)).toEqual(['GetSceneList']);
	});

	it('maps OBS ResourceNotFound (600) to SCENE_NOT_FOUND', async () => {
		const stub = useConnection(['Cam', 'Screen'], 'Cam');
		stub.call.mockImplementation(async (type) => {
			if (type === 'GetSceneList') return sceneList(['Cam', 'Screen'], 'Cam');
			if (type === 'SetCurrentProgramScene') {
				throw new OBSWebSocketError(600, 'Resource not found');
			}
			throw new Error(`unexpected request ${String(type)}`);
		});

		await expect(switchScene('Screen')).rejects.toMatchObject({ code: 'SCENE_NOT_FOUND' });
	});

	it('maps an unexpected OBS request error to OBS_REQUEST_FAILED', async () => {
		const stub = useConnection(['Cam', 'Screen'], 'Cam');
		stub.call.mockImplementation(async (type) => {
			if (type === 'GetSceneList') return sceneList(['Cam', 'Screen'], 'Cam');
			throw new OBSWebSocketError(702, 'Output not started');
		});

		await expect(switchScene('Screen')).rejects.toMatchObject({
			code: 'OBS_REQUEST_FAILED',
			message: 'OBS could not complete the scene request.'
		});
	});

	it('fails when the switch is accepted but the program scene does not change', async () => {
		vi.useFakeTimers();
		const stub = useConnection(['Cam', 'Screen'], 'Cam');
		stub.call.mockImplementation(async (type) => {
			if (type === 'GetSceneList') return sceneList(['Cam', 'Screen'], 'Cam');
			if (type === 'SetCurrentProgramScene') return undefined;
			if (type === 'GetCurrentProgramScene') return currentScene('Cam');
			throw new Error(`unexpected request ${String(type)}`);
		});

		const result = expect(switchScene('Screen')).rejects.toMatchObject({
			code: 'OBS_REQUEST_FAILED',
			message: 'The scene change is unconfirmed. Check GET /api/obs/scenes before retrying.'
		});
		await vi.advanceTimersByTimeAsync(1_000);
		await result;
		expect(
			stub.call.mock.calls.filter(([type]) => type === 'GetCurrentProgramScene').length
		).toBeGreaterThan(1);
	});

	it('does not report success if the connection drops while switching', async () => {
		const stub = useConnection(['Cam', 'Screen'], 'Cam');
		stub.call.mockImplementation((type) => {
			if (type === 'GetSceneList') {
				return Promise.resolve(sceneList(['Cam', 'Screen'], 'Cam'));
			}
			if (type === 'SetCurrentProgramScene') return new Promise(() => {});
			return Promise.reject(new Error(`unexpected request ${String(type)}`));
		});

		const pending = switchScene('Screen');
		await vi.waitFor(() =>
			expect(stub.call.mock.calls.map(([type]) => type)).toContain('SetCurrentProgramScene')
		);
		stub.client.emit('ConnectionClosed', new OBSWebSocketError(1006, 'OBS quit'));

		await expect(pending).rejects.toMatchObject({
			code: 'OBS_UNAVAILABLE',
			message: 'Could not connect to OBS.'
		});
	});

	it('does not report success if the connection drops while confirming', async () => {
		const stub = useConnection(['Cam', 'Screen'], 'Cam');
		let currentReads = 0;
		stub.call.mockImplementation((type) => {
			if (type === 'GetSceneList') {
				return Promise.resolve(sceneList(['Cam', 'Screen'], 'Cam'));
			}
			if (type === 'SetCurrentProgramScene') return Promise.resolve(undefined);
			if (type === 'GetCurrentProgramScene') {
				currentReads += 1;
				return new Promise(() => {});
			}
			return Promise.reject(new Error(`unexpected request ${String(type)}`));
		});

		const pending = switchScene('Screen');
		await vi.waitFor(() => expect(currentReads).toBe(1));
		stub.client.emit('ConnectionClosed', new OBSWebSocketError(1006, 'OBS quit'));

		await expect(pending).rejects.toMatchObject({
			code: 'OBS_UNAVAILABLE',
			message: 'Could not connect to OBS.'
		});
	});

	it('never logs the password or raw scene objects', async () => {
		useConnection(['Cam', 'Screen'], 'Cam');
		await getScenes();
		await switchScene('Screen');

		expect(logs.length).toBeGreaterThan(0);
		const raw = JSON.stringify(logs);
		expect(raw).not.toContain(PASSWORD);
		expect(raw).not.toContain('env-test-password');
		expect(raw).not.toContain('program-uuid');
		expect(raw).not.toContain('preview-uuid');
	});
});
