# OBS Control App

A SvelteKit dashboard for controlling a locally running [OBS Studio](https://obsproject.com/) instance. The app lets you check connection state, switch scenes, start or stop recording, and follow live updates via SSE without exposing OBS credentials to the browser.

Built with Svelte 5, TypeScript, Tailwind CSS, and a server-only OBS WebSocket layer. Browser code never connects to OBS directly; all OBS traffic is routed through the app’s HTTP API and server-side service layer.

## Overview

The assignment targets a practical local-control workflow:

- browse a simple dashboard for OBS state and controls
- fetch snapshot data from the app API
- subscribe to live updates over Server-Sent Events
- start or stop recording and switch the active scene with safety checks
- run in a production-style Node container without exposing secrets

## Requirements

- Node.js 22.17+ or 24 LTS
- npm (verified with npm 12.x)
- OBS Studio 28+ with the WebSocket server enabled
- access to the OBS WebSocket host and port configured for the app

## Installation

```sh
npm ci
cp .env.example .env
```

Then update the values in `.env` to match your OBS instance.

If the editor reports a missing `$app/tsconfig` reference, regenerate the generated SvelteKit files:

```sh
npm run prepare
```

## Configuration

The app reads OBS settings from environment variables at runtime. These values are validated in `src/env.ts` and remain server-only.

| Variable       | Required | Purpose                                               | Example     |
| -------------- | -------- | ----------------------------------------------------- | ----------- |
| `OBS_HOST`     | Yes      | OBS hostname or IP address without a protocol or port | `127.0.0.1` |
| `OBS_PORT`     | Yes      | OBS WebSocket port                                    | `4455`      |
| `OBS_PASSWORD` | No       | OBS WebSocket password if authentication is enabled   | `secret`    |

Example `.env`:

```env
OBS_HOST=127.0.0.1
OBS_PORT=4455
OBS_PASSWORD=
```

If `OBS_HOST` or `OBS_PORT` is invalid, the app fails fast with a clear startup error. The values are never exposed to the browser. `npm run build` does not require them to be set.

In development, `npm run dev` and `npm run preview` load `.env` automatically. In production, `npm start` passes `--env-file-if-exists=.env` to Node when the file is present. Environment variables already set in the shell or container are also used. Do not commit `.env` files or bake secrets into the Docker image.

## Local development

```sh
npm run dev
```

The app runs at `http://localhost:5173` by default.

Production mode:

```sh
npm run build
npm start
```

The production server listens on `http://localhost:3000` by default and uses the same environment variables at runtime.

## Testing

The project keeps the test suites intentionally separated:

- `npm test` runs the normal Vitest unit suite
- `npm run test:e2e` runs the browser-level Playwright suite against a mocked browser harness
- `npm run test:integration` runs live OBS integration tests against an already-running app and OBS instance
- `npm run verify` does not include the live integration suite

### Unit tests

```sh
npm test
```

This is the default local verification suite for the application logic, route handlers, and browser-side helper code.

### Playwright E2E tests

```sh
npx playwright install chromium
npm run test:e2e
```

These browser tests use a local Vite dev server and mocked HTTP/SSE responses. They validate the dashboard flow without requiring a real OBS instance.

### Real-OBS integration tests

```sh
BASE_URL=http://localhost:5173 npm run test:integration
```

This suite is separate from `npm test` and `npm run verify` and must target an already-running app and a reachable OBS WebSocket server. It checks health, SSE behaviour, scene switching, and recording state against real OBS.

The live integration suite has explicit safety guards:

- it restores the original scene after a successful scene change
- it refuses to stop a recording unless the test started it
- it reports a clear skip when the application or OBS is unavailable instead of silently passing

If the app or OBS is unavailable, the suite is reported as skipped or blocked rather than passed.

### Full verification

```sh
npm run verify
```

This is the standard non-live verification path for the project. It runs type-checking, linting, formatting checks, the Vitest suite, and the production build, but it intentionally excludes the live OBS integration suite.

## Docker

The project includes a production Docker image built from the SvelteKit `adapter-node` output.

```sh
docker build -t obs-control-app .
```

Run it with OBS settings provided at runtime:

```sh
docker run --rm -p 3000:3000 \
  -e OBS_HOST=host.docker.internal \
  -e OBS_PORT=4455 \
  -e OBS_PASSWORD \
  obs-control-app
```

On Linux, add the Docker host gateway explicitly if needed:

```sh
docker run --rm -p 3000:3000 \
  --add-host=host.docker.internal:host-gateway \
  -e OBS_HOST=host.docker.internal \
  -e OBS_PORT=4455 \
  -e OBS_PASSWORD \
  obs-control-app
```

The container serves the built app on port 3000. `GET /api/health` returns `{ "status": "ok" }` and does not contact OBS. The image intentionally does not bake secrets into the build or include local `.env` files. Docker networking to the host requires `host.docker.internal` or `--add-host=host.docker.internal:host-gateway` depending on the platform.

Do not set `IDLE_TIMEOUT` for this application. The adapter’s idle timeout can terminate the server process and interrupt long-lived SSE connections.

## API overview

| Method | Path                       | Description                                      |
| ------ | -------------------------- | ------------------------------------------------ |
| `GET`  | `/api/health`              | App liveness check; returns `{ "status": "ok" }` |
| `GET`  | `/api/obs/status`          | Current OBS connection state and last error      |
| `GET`  | `/api/obs/recording`       | Recording state plus duration metadata           |
| `POST` | `/api/obs/recording/start` | Start OBS recording                              |
| `POST` | `/api/obs/recording/stop`  | Stop OBS recording                               |
| `GET`  | `/api/obs/scenes`          | Scene list and current program scene             |
| `POST` | `/api/obs/scenes/switch`   | Switch the active scene                          |
| `GET`  | `/api/obs/events`          | SSE stream of snapshot and live state updates    |

### Connection status

`GET /api/obs/status` always returns JSON. A disconnected OBS state is an expected runtime state, not an HTTP error.

```json
{ "state": "disconnected", "lastError": null }
```

Possible values:

- `state`: `connected`, `connecting`, or `disconnected`
- `lastError`: `null`, `OBS_UNAVAILABLE`, or `OBS_AUTH_FAILED`

### Recording actions

The recording routes read OBS state before performing a mutating action, then confirm the result. Repeated start/stop requests resolve to conflict-style errors instead of silently succeeding.

```json
{
	"active": true,
	"paused": false,
	"timecode": "00:00:01.000",
	"durationMs": 1000,
	"fileName": null
}
```

Notes:

- `GetRecordStatus` is used to validate current state before a start or stop request
- the server refreshes recording status on a regular schedule so the displayed duration stays current
- the browser interpolates elapsed time between status updates, which keeps the timer responsive even while the server is waiting for the next OBS heartbeat
- the timer pauses when OBS reports recording as paused, so the UI reflects the live paused state instead of continuing to count forward
- if the final status response after stopping shows a zero duration, the app retains the last displayed duration rather than resetting the timer immediately
- `fileName` is only populated after OBS reports a saved output path
- the app does not leak local filesystem details to the browser

### Scene actions

Scene actions are checked before mutation. The response includes a list of scene names in OBS Studio scene-dock order (top-to-bottom), and a change is confirmed by reading the current program scene again.

```json
{ "scenes": ["Cam", "Screen"], "currentScene": "Cam" }
```

Notes:

- `GetSceneList` is read before switching scene
- a switch to the currently active scene is rejected as a conflict
- the application does not expose raw scene IDs or preview-scene objects to the browser

### SSE updates

`GET /api/obs/events` streams state over Server-Sent Events. The dashboard opens the stream after its initial HTTP fetch and receives:

- `snapshot` for the initial state
- `connection` for connection status updates
- `recording` for recording status changes
- `scenes` for scene list updates

The SSE stream remains open through reconnects while at least one client is attached. The server keeps a single shared OBS WebSocket session and reconnects with backoff when needed. Authentication failures are not retried automatically, and the browser never sees raw OBS credentials or authentication data.

The dashboard also guards against stale HTTP responses overwriting newer SSE state, which matters when the page is already receiving live updates.

### Action errors

Recording and scene routes return structured errors in the form `{ "error": { "code", "message" } }`. Disconnection is a failed action, while `GET /api/obs/status` is intentionally tolerant of a disconnected OBS state.

| HTTP | `error.code`         | Meaning                                                           |
| ---- | -------------------- | ----------------------------------------------------------------- |
| 400  | `INVALID_REQUEST`    | Request body is missing, invalid JSON, or the scene name is empty |
| 404  | `SCENE_NOT_FOUND`    | The requested scene name is not in OBS                            |
| 409  | `SCENE_CONFLICT`     | The scene is already current                                      |
| 409  | `RECORDING_CONFLICT` | Start while already recording or stop while not recording         |
| 503  | `OBS_UNAVAILABLE`    | OBS could not be reached, timed out, or the socket dropped        |
| 503  | `OBS_AUTH_FAILED`    | OBS rejected the configured password                              |
| 502  | `OBS_REQUEST_FAILED` | OBS rejected a request or the post-action confirmation failed     |
| 500  | `INTERNAL_ERROR`     | Unexpected server error                                           |

## Architecture notes

The app separates browser concerns from the OBS connection model:

- the browser only talks to the app’s own HTTP endpoints and EventSource stream
- a server-only OBS connection object owns the shared WebSocket session
- OBS events are distributed through an in-process event hub to connected SSE clients
- the dashboard merges snapshot and live updates without letting older requests overwrite newer state

This keeps the browser free of OBS credentials and avoids leaking connection details, file paths, or local OBS configuration into the client.

## Safety and limitations

- the live OBS integration suite is opt-in and intentionally separate from `npm test` and `npm run verify`
- the suite can mutate the active scene and start or stop recording in OBS
- the tests restore the original scene and refuse to stop a recording unless the test started it
- the app and OBS instance must be running before the live integration suite is launched
- the project is designed for local OBS control rather than general-purpose remote administration

## Project structure

```text
src/
  app.html                 HTML template
  app.d.ts                 App-wide Svelte type declarations
  env.ts                   Declares the runtime OBS environment contract
  lib/
    components/            Svelte panels and reusable dashboard UI
    dashboard/             Browser-side state merge logic and elapsed-time helpers
    server/obs/            Server-only OBS WebSocket integration layer
      config.ts            OBS host/port/password validation
      connection.ts        Shared outbound OBS connection and lifecycle management
      events.ts            In-process event hub and SSE fan-out
      recording.ts         Recording start/stop/status logic
      scenes.ts            Scene list and scene-switch logic
      errors.ts            Shared request error codes
  routes/
    +layout.svelte         Global layout and app shell
    +page.svelte           Dashboard page and browser-side fetch/EventSource wiring
    api/                  API endpoints for health, status, recording, scenes, and events
static/                   Static assets served directly
Dockerfile                Production adapter-node image
README.md                 Project setup and usage notes
.env.example              Example environment file
vite.config.ts            Vite and SvelteKit configuration
eslint.config.js          ESLint config
prettier.config.js        Prettier config
package.json              Scripts and dependencies
vitest.integration.config.ts  Live OBS integration configuration
playwright.config.ts      Browser E2E configuration
tests/
  e2e/                    Browser E2E tests with mocked API/SSE responses
  integration/            Real OBS smoke tests; opt-in and separate from normal verification
```

## Notes

- `.env` is intentionally ignored and must not be committed
- `.env.example` contains placeholder values only
- local OBS recordings and generated test artifacts are excluded in `.gitignore`
- the Docker image is a production `adapter-node` build and does not include secrets or development-only tooling

```

```
