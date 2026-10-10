# OBS Control App

A small web dashboard for controlling a locally running [OBS Studio](https://obsproject.com/) instance: start and stop recording, see the current recording file, and switch scenes.

Built with SvelteKit (Svelte 5), TypeScript, and Tailwind CSS. The browser talks only to the app's own HTTP API; a server-only module talks to OBS over OBS WebSocket. OBS credentials never reach the browser.

> **Status:** project scaffold only. OBS integration, recording controls, and scene switching are not implemented yet. See [`docs/PROGRESS.md`](docs/PROGRESS.md).

## Requirements

- Node.js 24 LTS (pinned in `.nvmrc`; `^22.17.0` also satisfies the dependencies). Node 23 is **not** supported: ESLint 10 excludes it, and `.npmrc` enforces engine checks.
- npm 11 (bundled with Node 24).
- OBS Studio 28+ with its WebSocket server enabled. Only needed once the OBS integration exists.

## Setup

```sh
nvm use          # or install Node 24 another way
npm install
cp .env.example .env   # then set OBS_PASSWORD (used once OBS integration lands)
```

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

Environment variables are read on the server only. See [`.env.example`](.env.example).

`npm run dev` and `npm run preview` load `.env` automatically. A production build does not, so `npm start` passes `--env-file-if-exists=.env` to Node. Variables already set in the environment (e.g. by Docker) are also used.

| Variable       | Purpose                       | Example     |
| -------------- | ----------------------------- | ----------- |
| `OBS_HOST`     | Host running OBS Studio       | `127.0.0.1` |
| `OBS_PORT`     | OBS WebSocket port            | `4455`      |
| `OBS_PASSWORD` | OBS WebSocket server password | —           |

## API

| Method | Path          | Description                                                             |
| ------ | ------------- | ----------------------------------------------------------------------- |
| `GET`  | `/api/health` | App liveness check. Returns `{ "status": "ok" }`. Does not contact OBS. |

## Project structure

```text
src/
  routes/
    +page.svelte          Dashboard UI
    +layout.svelte        Global layout and Tailwind stylesheet
    api/                  HTTP API routes (+server.ts), with colocated *.spec.ts tests
  lib/                    Code shared with the browser
  lib/server/             Server-only code (planned: OBS integration). SvelteKit blocks client imports.
docs/                     Requirements, architecture, decisions, progress, testing plan
.cursor/                  Cursor rules and project skills for AI-assisted development
```

## Documentation

- [`docs/PROJECT_CONTEXT.md`](docs/PROJECT_CONTEXT.md): assignment and acceptance criteria
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): request flow and boundaries
- [`docs/DECISIONS.md`](docs/DECISIONS.md): decision log
- [`docs/TESTING.md`](docs/TESTING.md): automated and manual test plan
- [`docs/PROGRESS.md`](docs/PROGRESS.md): milestone log
