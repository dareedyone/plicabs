# OBS Control App

A small web dashboard for controlling a locally running [OBS Studio](https://obsproject.com/) instance: start and stop recording, see the current recording file, and switch scenes.

Built with SvelteKit (Svelte 5), TypeScript, and Tailwind CSS. The browser talks only to the app's own HTTP API; a server-only module talks to OBS over OBS WebSocket. OBS credentials never reach the browser.

> **Status:** project scaffold only. OBS integration, recording controls, and scene switching are not implemented yet.

## Requirements

- Node.js 24 LTS is recommended (pinned in `.nvmrc`). The supported range is `^22.17.0 || >=24`, declared in `package.json` `engines` and enforced by `engine-strict` in `.npmrc`. Node 23 is not supported.
- npm, as bundled with your Node installation. The project has been installed and verified with npm 12.2.0.
- OBS Studio 28+ with its WebSocket server enabled. Not needed yet; required once the OBS integration is implemented.

## Setup

```sh
nvm use                # or install Node 24 another way
npm install
cp .env.example .env   # optional for now; see Configuration
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

The variables in [`.env.example`](.env.example) are placeholders for the planned OBS integration. **The application does not read them yet.** Once implemented, they will be read on the server only and never sent to the browser.

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
  app.html                 HTML template
  app.d.ts                 App-wide type declarations
  lib/                     Code shared between server and browser (imported via #lib)
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
.env.example               Placeholder environment variables
```

OBS integration code will live in `src/lib/server/`. SvelteKit refuses to bundle modules in that folder into browser code.
