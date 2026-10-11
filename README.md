# OBS Control App

A small web dashboard for controlling a locally running [OBS Studio](https://obsproject.com/) instance: start and stop recording, see the current recording file, and switch scenes.

Built with SvelteKit (Svelte 5), TypeScript, and Tailwind CSS. The browser talks only to the app's own HTTP API; a server-only module talks to OBS over OBS WebSocket. OBS credentials never reach the browser.

> **Status:** in development. The server-side OBS connection service and its configuration are in place; no API route or UI uses them yet. Recording controls and scene switching are not implemented yet.

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

`npm run dev` and `npm run preview` load `.env` automatically. A production build does not, so `npm start` passes `--env-file-if-exists=.env` to Node. Variables already set in the environment (e.g. by Docker) are also used.

## API

| Method | Path          | Description                                                             |
| ------ | ------------- | ----------------------------------------------------------------------- |
| `GET`  | `/api/health` | App liveness check. Returns `{ "status": "ok" }`. Does not contact OBS. |

## Project structure

```text
src/
  app.html                 HTML template
  app.d.ts                 App-wide type declarations
  env.ts                   Declares and validates the OBS environment variables
  lib/                     Code shared between server and browser (imported via #lib)
    server/obs/            Server-only OBS integration; SvelteKit blocks browser imports
      config.ts            Validators for the OBS host, port and password
      connection.ts        Shared OBS WebSocket connection (lazy, one attempt at a time)
      *.spec.ts            Unit tests with a stubbed OBS client
  routes/
    +layout.svelte         Global layout; loads the Tailwind stylesheet
    +page.svelte           Dashboard page (placeholder)
    layout.css             Tailwind entry point
    api/health/
      +server.ts           GET /api/health
      health.spec.ts       Route test (Vitest)
static/                    Files served as-is
vite.config.ts             Vite, SvelteKit (adapter-node), and Vitest configuration
eslint.config.js           ESLint configuration
prettier.config.js         Prettier configuration
tsconfig.json              TypeScript configuration (extends SvelteKit's generated config)
.env.example               Example environment variables
```

## Testing

`npm test` runs the Vitest suite. The OBS tests replace the WebSocket client's network methods with stubs, so they don't need OBS Studio to be running. They can't show that the app works with a real OBS instance; that needs a manual check against OBS.
