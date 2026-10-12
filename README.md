# OBS Control App

A small web dashboard for controlling a locally running [OBS Studio](https://obsproject.com/) instance: start and stop recording, see the current recording file, and switch scenes.

Built with SvelteKit (Svelte 5), TypeScript, and Tailwind CSS. The browser talks only to the app's own HTTP API; a server-only module talks to OBS over OBS WebSocket. OBS credentials never reach the browser.

> **Status:** in development. The server-side OBS APIs, dashboard UI, SSE real-time updates, and a production Docker image are in place.

## Requirements

- Node.js 24 LTS is recommended (pinned in `.nvmrc`). The supported range is `^22.17.0 || >=24`, declared in `package.json` `engines` and enforced by `engine-strict` in `.npmrc`. Node 23 is not supported.
- npm, as bundled with your Node installation. The project has been installed and verified with npm 12.2.0.
- OBS Studio 28+ with its WebSocket server enabled (OBS > Tools > WebSocket Server Settings). Not needed for the automated tests or the build.

## Setup

```sh
nvm use                # or install Node 24 another way
npm install
cp .env.example .env   # then edit; see Configuration
```

`tsconfig.json` extends `node_modules/$app/tsconfig.json`, which SvelteKit generates. npm can delete it when installing or pruning packages, so if the editor then reports `File '$app/tsconfig' not found`, run `npm run prepare` to regenerate it and restart the TypeScript server. In VS Code or Cursor, also choose "Use Workspace Version" when prompted, because SvelteKit 3 requires TypeScript 6.

## Commands

| Task                    | Command                                                   |
| ----------------------- | --------------------------------------------------------- |
| Development server      | `npm run dev` (http://localhost:5173)                     |
| Type check              | `npm run check`                                           |
| Lint                    | `npm run lint`                                            |
| Format files            | `npm run format`                                          |
| Check formatting        | `npm run format:check`                                    |
| Run tests once          | `npm test`                                                |
| Run tests in watch mode | `npm run test:watch`                                      |
| Production build        | `npm run build`                                           |
| Run production build    | `npm start` (http://localhost:3000; set `PORT` to change) |
| All checks + build      | `npm run verify`                                          |

## Configuration

OBS connection settings come from environment variables. They are declared and validated in `src/env.ts` and are readable only by server code. They are never sent to the browser.

| Variable       | Required | Purpose                                                                   | Example     |
| -------------- | -------- | ------------------------------------------------------------------------- | ----------- |
| `OBS_HOST`     | Yes      | Hostname or IP address of the machine running OBS (no protocol or port)   | `127.0.0.1` |
| `OBS_PORT`     | Yes      | OBS WebSocket port, 1–65535                                               | `4455`      |
| `OBS_PASSWORD` | No       | OBS WebSocket password. Leave empty if authentication is disabled in OBS. | —           |

The values are validated when the app starts. If `OBS_HOST` or `OBS_PORT` is missing or invalid, `npm start` exits and `npm run dev` answers every request with an error. Either way, the terminal shows which variable is wrong; the error never includes the values themselves. `npm run build` does not need these variables.

`npm run dev` and `npm run preview` load `.env` automatically. A production build does not, so `npm start` passes `--env-file-if-exists=.env` to Node. Variables already set in the environment (e.g. by Docker `-e`) are also used. Do not copy `.env` into the image.

## Docker

The `Dockerfile` builds a production `adapter-node` server (`node:24-bookworm-slim`, one process). OBS settings are passed at **run** time. They are never build arguments and are never copied from `.env`.

```sh
docker build -t obs-control-app .
```

On macOS or Docker Desktop, the container reaches OBS on the host with `host.docker.internal`:

```sh
docker run --rm -p 3000:3000 \
  -e OBS_HOST=host.docker.internal \
  -e OBS_PORT=4455 \
  -e OBS_PASSWORD \
  obs-control-app
```

`OBS_PASSWORD` is taken from your shell if it is already set. Leave it unset or empty if OBS has authentication disabled. Do not put the password in the `Dockerfile` or in `docker build`.

On Linux, Docker does not define `host.docker.internal` unless you add it:

```sh
docker run --rm -p 3000:3000 \
  --add-host=host.docker.internal:host-gateway \
  -e OBS_HOST=host.docker.internal \
  -e OBS_PORT=4455 \
  -e OBS_PASSWORD \
  obs-control-app
```

Then open http://localhost:3000. `GET /api/health` is `{ "status": "ok" }` and does not contact OBS.

`localhost` inside the container is the container, not the Mac. OBS WebSocket must accept connections from Docker’s bridge. If the dashboard stays on `OBS_UNAVAILABLE`, check that the WebSocket server is enabled and not bound only to `127.0.0.1`. Do not set `IDLE_TIMEOUT`; adapter-node would exit while an SSE client is idle.

## API

| Method | Path                       | Description                                                                    |
| ------ | -------------------------- | ------------------------------------------------------------------------------ |
| `GET`  | `/api/health`              | App liveness check. Returns `{ "status": "ok" }`. Does not contact OBS.        |
| `GET`  | `/api/obs/status`          | Current OBS connection status (below). Does not contact OBS.                   |
| `GET`  | `/api/obs/recording`       | Current OBS recording state. Connects if needed, then calls `GetRecordStatus`. |
| `POST` | `/api/obs/recording/start` | Start recording. Connects if needed.                                           |
| `POST` | `/api/obs/recording/stop`  | Stop recording. Connects if needed.                                            |
| `GET`  | `/api/obs/scenes`          | Available scenes and the current program scene. Connects if needed.            |
| `POST` | `/api/obs/scenes/switch`   | Switch the program scene. Connects if needed.                                  |
| `GET`  | `/api/obs/events`          | SSE stream of connection, recording, and scene updates. Connects if needed.    |

### `GET /api/obs/status`

Always responds `200` with JSON. Being disconnected from OBS is a normal status, not an HTTP error.

```json
{ "state": "disconnected", "lastError": "OBS_UNAVAILABLE" }
```

| Field       | Values                                           | Meaning                                                                                             |
| ----------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `state`     | `"connected"`, `"connecting"`, `"disconnected"`  | The server's connection to OBS right now                                                            |
| `lastError` | `null`, `"OBS_UNAVAILABLE"`, `"OBS_AUTH_FAILED"` | Why the last attempt failed or the last session ended. `null` after a success or before any attempt |

The endpoint only reports what the server already knows. It never opens a connection, so before anything has tried to connect it returns `{ "state": "disconnected", "lastError": null }`. `OBS_UNAVAILABLE` means OBS couldn't be reached, timed out, or closed the connection. `OBS_AUTH_FAILED` means OBS rejected `OBS_PASSWORD`.

### Recording

`GET /api/obs/recording`, `POST /api/obs/recording/start`, and `POST /api/obs/recording/stop` all return the same JSON object after talking to OBS. Start and stop first read `GetRecordStatus`, send `StartRecord` or `StopRecord` only if the current state allows it, then read `GetRecordStatus` again to confirm. A repeated start or stop is `409`, not a silent success. POST clients should send `Content-Type: application/json` (SvelteKit treats a missing type as a cross-site form and answers `403`).

```json
{
	"active": true,
	"paused": false,
	"timecode": "00:00:01.000",
	"durationMs": 1000,
	"fileName": null
}
```

| Field        | Meaning                                                                                         |
| ------------ | ----------------------------------------------------------------------------------------------- |
| `active`     | Whether OBS is recording                                                                        |
| `paused`     | Whether the recording output is paused                                                          |
| `timecode`   | OBS formatted timecode                                                                          |
| `durationMs` | Recording duration in milliseconds                                                              |
| `fileName`   | Basename of the saved file after a successful stop. `null` until OBS reports a path (see below) |

`GetRecordStatus` does not include a filename. After stop, HTTP `fileName` comes from `StopRecord`'s `outputPath`; only the last path segment is returned, so a local username in the folder path never reaches the browser. While recording, HTTP GET still returns `fileName: null`. The SSE stream may include a cached basename from `RecordFileChanged`. If the app attaches after recording has already started, that event may have been missed and `fileName` stays `null` until a later file change or stop.

### Scenes

`GET /api/obs/scenes` and `POST /api/obs/scenes/switch` return the same JSON object after talking to OBS. The list is returned in OBS Studio scene-dock order (top to bottom). `GetSceneList` itself is bottom-to-top, so the service reverses that array once; HTTP, SSE, and the dashboard do not sort or reorder again. Switch reads `GetSceneList` first, sends `SetCurrentProgramScene` only if the exact name exists and is not already current, then reads `GetCurrentProgramScene` to confirm. A switch to the current scene is `409`, not a silent success. POST clients should send `Content-Type: application/json` (SvelteKit treats a missing type as a cross-site form and answers `403`).

```json
{ "scenes": ["Cam", "Screen"], "currentScene": "Cam" }
```

| Field          | Meaning                                                     |
| -------------- | ----------------------------------------------------------- |
| `scenes`       | Scene names, in OBS Studio scene-dock order (top to bottom) |
| `currentScene` | Current program scene name, or `null` if OBS has none       |

Only names are returned. UUIDs, preview-scene fields, and raw OBS scene objects never reach the browser.

### Real-time updates

`GET /api/obs/events` is a Server-Sent Events stream (`text/event-stream`). The dashboard opens it with `EventSource` after the initial HTTP GETs. The first frame is `snapshot`; later frames are `connection`, `recording`, or `scenes`, using the same JSON shapes as the HTTP APIs. A comment keepalive (`: ping`) is sent about every 20 seconds.

The stream stays open when OBS is unavailable. One shared OBS WebSocket serves every browser; the server reconnects with 1s / 2s / 5s backoff while at least one SSE client is connected, and does not retry a rejected password (`OBS_AUTH_FAILED`). Recording duration is refreshed from `GetRecordStatus` about once per second while recording. The browser clock only interpolates between those snapshots, and it does not advance while OBS reports the recording as paused. After stop, if OBS reports `durationMs: 0`, the dashboard keeps the last elapsed time from this page session (dashboard stop or OBS-side stop).

### Action errors

Recording and scene routes use `{ "error": { "code", "message" } }`. Being disconnected is a failed action, unlike `GET /api/obs/status`.

| HTTP | `error.code`         | When                                                                                                                             |
| ---- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 400  | `INVALID_REQUEST`    | Switch body is missing, not JSON, or `sceneName` is not a non-empty string                                                       |
| 404  | `SCENE_NOT_FOUND`    | The requested scene name is not in the OBS list                                                                                  |
| 409  | `SCENE_CONFLICT`     | Switch to the scene that is already current                                                                                      |
| 409  | `RECORDING_CONFLICT` | Start while already recording, or stop while not recording                                                                       |
| 503  | `OBS_UNAVAILABLE`    | OBS could not be reached, timed out, or the connection dropped                                                                   |
| 503  | `OBS_AUTH_FAILED`    | OBS rejected `OBS_PASSWORD`                                                                                                      |
| 502  | `OBS_REQUEST_FAILED` | OBS rejected the request, or the new state could not be confirmed. If unconfirmed, check the matching GET route before retrying. |
| 500  | `INTERNAL_ERROR`     | Unexpected server error. The body never includes internals                                                                       |

## Project structure

```text
src/
  app.html                 HTML template
  app.d.ts                 App-wide type declarations
  env.ts                   Declares and validates the OBS environment variables
  lib/                     Code shared between server and browser (imported via #lib)
    dashboard/             Browser dashboard client, elapsed time, controls, and SSE apply helpers
    components/            Dashboard panels and colocated `*.svelte.spec.ts` tests
    server/obs/            Server-only OBS integration; SvelteKit blocks browser imports
      config.ts            Validators for the OBS host, port and password
      connection.ts        Shared OBS WebSocket connection (lazy, one attempt at a time)
      events.ts            In-process hub: OBS events, SSE fan-out, reconnect, duration poll
      errors.ts            Shared request-error codes for recording and scenes
      recording.ts         Start/stop/status using the shared connection
      scenes.ts            List/switch using the shared connection
      *.spec.ts            Unit tests with a stubbed OBS client
  routes/
    +layout.svelte         Global layout; loads the Tailwind stylesheet
    +page.svelte           Dashboard page
    layout.css             Tailwind entry point
    api/health/
      +server.ts           GET /api/health
      health.spec.ts       Route test (Vitest)
    api/obs/
      respond.ts           Maps OBS errors to HTTP JSON for action routes
      status/
        +server.ts         GET /api/obs/status
        status.spec.ts     Route tests with a mocked connection service
      recording/
        +server.ts         GET /api/obs/recording
        start/+server.ts   POST /api/obs/recording/start
        stop/+server.ts    POST /api/obs/recording/stop
        recording.spec.ts  Route tests with a mocked recording service
      scenes/
        +server.ts         GET /api/obs/scenes
        switch/+server.ts  POST /api/obs/scenes/switch
        scenes.spec.ts     Route tests with a mocked scene service
      events/
        +server.ts         GET /api/obs/events
        events.spec.ts     SSE route tests with a mocked event hub
static/                    Files served as-is
vite.config.ts             Vite, SvelteKit (adapter-node), and Vitest configuration
eslint.config.js           ESLint configuration
prettier.config.js         Prettier configuration
tsconfig.json              TypeScript configuration (extends SvelteKit's generated config)
.env.example               Example environment variables
Dockerfile                 Multi-stage production image (adapter-node, Node 24)
.dockerignore              Excludes .env, Git, docs, and local tooling from the image
```

## Testing

`npm test` runs two Vitest projects: `server` (Node) for OBS services, API routes, and dashboard helpers, and `client` (jsdom) for the dashboard Svelte panels. The OBS tests replace the WebSocket client's network methods with stubs, so they don't need OBS Studio to be running. They can't show that the app works with a real OBS instance; that needs a manual check against OBS.
