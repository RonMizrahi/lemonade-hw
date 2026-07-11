# syntax=docker/dockerfile:1

# ── Backend image (spec §11) ────────────────────────────────────────────────
# One image, two entrypoints: the API (`main.js`) and the worker (`main.worker.js`).
# docker-compose overrides `command` to pick which process a given container runs.

# ── Stage 1: build ──────────────────────────────────────────────────────────
# Installs the full dependency set (incl. devDependencies) and compiles TypeScript to dist/.
FROM node:24-alpine AS build
WORKDIR /app

# Install deps first (cache-friendly: only re-runs when the lockfile changes).
COPY package.json package-lock.json ./
RUN npm ci

# Compile the app (produces dist/main.js, dist/main.worker.js, dist/database/*.js,
# and dist/database/migrations/*.js consumed by the runtime stage).
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# Strip devDependencies from node_modules so only production deps are carried forward.
RUN npm prune --omit=dev

# ── Stage 2: runtime ────────────────────────────────────────────────────────
# Slim image with just the compiled dist/ and production node_modules.
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Pruned production node_modules (includes typeorm CLI + reflect-metadata used at boot).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

# Default to the API process; the worker service overrides `command` in compose.
# (Migrations + seed are run by the compose `api` command before start; see docker-compose.yml.)
CMD ["node", "dist/main.js"]
