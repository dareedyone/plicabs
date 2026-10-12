# Production image for the adapter-node server.
# OBS credentials are runtime environment variables only. Do not add ARG/ENV for OBS_PASSWORD.

FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci

FROM deps AS build
COPY src ./src
COPY static ./static
COPY vite.config.ts tsconfig.json ./
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json .npmrc ./
# prepare runs `svelte-kit sync`; kit is a devDependency, so skip scripts here.
RUN npm ci --omit=dev --ignore-scripts \
	&& npm cache clean --force
COPY --from=build --chown=node:node /app/build ./build
RUN chown -R node:node /app
USER node
EXPOSE 3000
# Do not set IDLE_TIMEOUT: adapter-node would exit while an SSE client is quiet.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "build"]
