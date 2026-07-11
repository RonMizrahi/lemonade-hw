# syntax=docker/dockerfile:1

# ── Frontend image (spec §11) ───────────────────────────────────────────────
# Builds the Vite SPA to static assets, then serves them via nginx. nginx also reverse-proxies
# `/onboarding` (and /docs, /metrics) to the api service — see nginx.conf.

# ── Stage 1: build the Vite bundle ──────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

# ── Stage 2: serve static assets with nginx ─────────────────────────────────
FROM nginx:1.27-alpine AS runtime

# Replace the default server block with our SPA + API-proxy config.
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Ship the compiled SPA.
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
