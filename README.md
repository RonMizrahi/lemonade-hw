# Onboarding Application

A Lemonade-style dynamic onboarding wizard. A customer is guided through a **branching** sequence
of questions; at the address step the backend fires a **simulated slow external property lookup**
that runs asynchronously while the customer keeps answering unrelated questions; onboarding
completes once every required question is answered and the external data is available (or has
permanently failed and a fallback is applied).

**Stack:** NestJS + TypeScript (API + worker), PostgreSQL via TypeORM, BullMQ on Redis, React +
Vite SPA. Full design rationale lives in
[`docs/design/onboarding-app-10-07-2026-design.md`](docs/design/onboarding-app-10-07-2026-design.md);
the implementation plan is in [`docs/plans/onboarding-app-10-07-2026-plan.md`](docs/plans/onboarding-app-10-07-2026-plan.md).

---

## Quick start

Prerequisites: **Docker** + **Docker Compose v2**.

```bash
cp .env.example .env        # optional — every value has a sensible default
docker compose up --build   # add -d to run detached
```

This brings up **db + redis + api + worker + frontend**. On boot the `api` container runs database
migrations, seeds the active flow version, then starts the HTTP server.

| Surface | URL |
|---|---|
| Wizard (SPA) | http://localhost:8080 |
| API | http://localhost:3000/onboarding |
| Swagger UI | http://localhost:3000/docs |
| API metrics | http://localhost:3000/metrics |
| Worker metrics | http://localhost:3001/metrics |

Tear down with `docker compose down` (add `-v` to also drop the Postgres volume).

> The SPA calls the API on its own origin (`/onboarding/...`); nginx in the `frontend` container
> reverse-proxies `/onboarding`, `/docs`, and `/metrics` to the `api` service. So the browser never
> needs CORS and there is no build-time API URL baked into the bundle.

### Optional observability stack

Prometheus + Grafana are **off by default** to keep the core stack light. Enable them with a profile:

```bash
docker compose --profile observability up --build
```

- Prometheus: http://localhost:9090 — scrapes the api (`api:3000`) and worker (`worker:3001`)
  `/metrics` endpoints per [`ops/prometheus.yml`](ops/prometheus.yml).
- Grafana: http://localhost:3300 (anonymous access on; admin/admin) — Prometheus is auto-provisioned
  as the default datasource.

### Local development (without Docker)

Run `db` + `redis` from compose, then the backend/frontend on the host:

```bash
docker compose up -d db redis
cd backend  && npm ci && npm run migration:run && npm run seed && npm run start:dev
cd frontend && npm ci && npm run dev     # Vite dev server on :5173, proxies /onboarding to :3000
```

---

## Architecture

Monorepo — the API and worker **share one backend codebase with two entrypoints**
(`src/main.ts`, `src/main.worker.ts`), plus the React SPA.

```
Browser ──HTTP──► API ──► Postgres (sessions / answers / outbox — written in one transaction)
   ▲  poll GET                 │ outbox rows
   │                  OutboxRelay (worker) ──publish──► Redis (BullMQ)
   │                                                       │
   └──── status in DB ◄── LookupProcessor (worker) ◄───────┘
                          simulate 3–8s / ~10% fail / retry + backoff
```

### Backend layering (strict separation)

```
HTTP → Controller → Service → Repository → Postgres
                       │
                       ├── FlowEngine   (pure functions, zero I/O)
                       └── OutboxWriter  (enqueue-intent, same tx as the answer)

Worker: OutboxRelay → BullMQ queue → LookupProcessor → SimulatedPropertyService
```

- **Controller** — HTTP only: DTO validation, maps domain results/errors to status codes.
- **Service** — orchestration + transactions (start, submit, edit, retry, complete).
- **Repository** — all TypeORM access, one per aggregate.
- **FlowEngine** — pure functions: visibility, current question, answer validation, reconciliation,
  completion checklist. Visibility is a pure function of the answer set, so branching, skipping, and
  edit-recalculation all fall out of one idea and are trivially unit-testable.
- **OutboxRelay / LookupProcessor** — the worker's relay (polls `outbox_event`, publishes to BullMQ)
  and consumer (runs the simulated lookup, persists status, retries with backoff).

### Async lookup — outbox → queue → worker

When `property_address` is answered, the service — **in one DB transaction** — upserts the answer,
upserts the `external_lookup` row, and inserts an `outbox_event`. The HTTP response returns
immediately. The `OutboxRelay` publishes pending events to BullMQ; the `LookupProcessor` runs the
3–8s simulated lookup, applies BullMQ retry/backoff, and marks the row `completed` / `failed` /
`permanently_failed` (with a fallback record). The frontend **polls** `GET /sessions/:id` to watch
`not_started → loading → completed | failed`. The outbox guarantees the lookup is enqueued **iff**
the answer committed; a **generation guard** drops stale jobs when the address changes mid-flight.

---

## API documentation

Interactive OpenAPI/Swagger UI: **http://localhost:3000/docs**. Base path `/onboarding`. Every write
returns the **full session state** so the frontend never guesses. Writes echo `expectedVersion`
(optimistic locking, `@VersionColumn`); a mismatch → `409` with current state.

| Method & path | Purpose | Key inputs | Success | Notable errors |
|---|---|---|---|---|
| `POST /onboarding/sessions` | Start a session | — | `201` + state | |
| `GET /onboarding/sessions/:id` | Fetch state (**polling target**) | — | `200` + state | `404` |
| `POST /onboarding/sessions/:id/answers` | Submit the current answer | header `Idempotency-Key`; `{questionId, value, expectedVersion}` | `200` + state | `400` validation, `409` stale/not-current, `422` idempotency reuse w/ different body |
| `PUT /onboarding/sessions/:id/answers/:questionId` | Edit a prior answer | `{value, expectedVersion}` | `200` + recalculated state | `400`, `404` not-answered, `409` stale |
| `POST /onboarding/sessions/:id/external-lookup/retry` | Retry a failed lookup | header `Idempotency-Key` | `202` + state | `409` not `failed` / `max_triggers` reached |
| `POST /onboarding/sessions/:id/complete` | Complete onboarding | `{expectedVersion}` | `200` + summary | `409` requirements unmet / lookup not terminal / stale |

Cross-cutting: **Idempotency** on `POST /answers` (`Idempotency-Key` header — replays return the
stored response; same key + different body → `422`); consistent error envelope
`{ statusCode, error, message, details? }`; unknown request fields stripped (`whitelist`).

---

## Database schema (ER description)

Six tables. `synchronize` is off — schema is owned by TypeORM migrations
(`backend/src/database/migrations`).

- **`onboarding_session`** — the aggregate root. `id`, `status` (`in_progress`|`completed`),
  `flow_version_id` (FK, pinned at creation), `version` (`@VersionColumn`, optimistic lock),
  `summary` (jsonb, on completion), timestamps.
- **`answer`** — one per answered question. `session_id` (FK), `question_id`, `value` (jsonb),
  `status` (`active`|`irrelevant` — soft-marked when a branch change hides it),
  **unique(`session_id`, `question_id`)**.
- **`flow_version`** — registered versioned flow definitions. `version` (unique), `definition`
  (jsonb snapshot — executable predicates live in code). Seeded on boot.
- **`external_lookup`** — one per session (`session_id` unique FK). `status`
  (`not_started`|`loading`|`completed`|`failed`|`permanently_failed`), `generation` (bumped on
  address change; stale jobs ignored), `triggers`/`max_triggers`, `job_attempts`, `result` (jsonb,
  real or fallback), `error`.
- **`outbox_event`** — the transactional outbox. `aggregate_type`/`aggregate_id`, `type`, `payload`
  (jsonb), `status` (`pending`|`published`), `publish_attempts`, indexed on `(status, created_at)`
  for the relay.
- **`idempotency_key`** — `key` (unique, client-supplied), `session_id` (FK), `request_hash`,
  stored `response` + `status_code` for verbatim replay.

**Relationships:** `onboarding_session` *N→1* `flow_version`; `onboarding_session` *1→N* `answer`;
`onboarding_session` *1→1* `external_lookup`; `onboarding_session` *1→N* `idempotency_key`.
`outbox_event` references an aggregate id (the `external_lookup`) without a hard FK so the relay stays
decoupled.

---

## Testing

Three levels; integration and e2e use **Testcontainers** to bring up real Postgres + Redis (Docker
must be running). Every test uses randomly generated ids so it is idempotent against a persistent DB.

```bash
cd backend
npm run test:unit          # FlowEngine + pure logic — breadth of branches/validation lives here
npm run test:integration   # services + repositories + outbox/queue wiring vs real Postgres + Redis
npm run test:e2e           # full HTTP journeys (supertest) vs real API + worker + infra

cd ../frontend
npm run test               # component + reducer + polling-hook + money-path journey (vitest, mocked API)
```

- **Unit** — the FlowEngine pure functions (branching, skip/irrelevant, `currentQuestion`,
  `validateAnswer`, `reconcile`, `completionChecklist`), the flow-definition validator, the simulated
  service's outcome logic (delay/fail injected), the generation guard. No I/O.
- **Integration** — real infra: idempotent double-submit → one write; stale `expectedVersion` → 409;
  edit reconciliation persists `irrelevant`; a trigger writes answer + outbox atomically; the relay
  publishes and the processor advances lookup status; the generation guard drops a stale job.
- **E2E** — a full journey over HTTP: start → answer through a branch → address triggers the lookup →
  keep answering while it runs → poll until terminal → complete → assert summary shape; plus a forced
  failure → retry → permanent failure → fallback completion journey.

**How Testcontainers is used:** each integration/e2e suite starts `@testcontainers/postgresql` and
`@testcontainers/redis` containers, runs migrations against them, points the app at the ephemeral
instances, and tears them down after. The same mechanism runs in CI — no external services required.

### Compose smoke test (integrated verification)

```bash
docker compose up --build -d
# wait for the api to be healthy, then walk a journey:
SID=$(curl -s -XPOST localhost:3000/onboarding/sessions | jq -r .sessionId)
# submit full_name, date_of_birth, residence_type, property_address (with Idempotency-Key + expectedVersion),
# then poll GET localhost:3000/onboarding/sessions/$SID until externalLookup.status leaves not_started/loading.
curl -s localhost:3000/docs   -o /dev/null -w "docs %{http_code}\n"
curl -s localhost:3000/metrics -o /dev/null -w "metrics %{http_code}\n"
# confirm the SPA serves:
curl -s localhost:8080 -o /dev/null -w "frontend %{http_code}\n"
docker compose down
```

### CI

GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs on PR + push to `main`:
**backend** — install → lint → build → `test:unit` → `test:integration` → `test:e2e` (Testcontainers
brings up Postgres + Redis in the runner); **frontend** — build + test.

---

## Trade-offs

- **Queue + outbox vs in-process job** — chose the production-grade path (BullMQ worker +
  transactional outbox). Cost: Redis + a worker process + more moving parts. Benefit: durable
  retries, survives mid-lookup restarts, horizontally scalable workers, and "answer committed ⇒
  lookup enqueued" is exactly-consistent rather than best-effort.
- **Worker as a separate process** — a separate `main.worker.ts` container demonstrates decoupled,
  independently-scalable queue processing, at the cost of a second entrypoint and shared-module
  wiring. Could collapse into the API for a smaller footprint.
- **Polling vs WebSocket/SSE** — polling `GET /sessions/:id` is trivial and robust for a wizard; push
  would be lower-latency but adds transport complexity for little UX gain here.
- **At-least-once delivery** — outbox + queue give at-least-once, so the `LookupProcessor` is made
  idempotent (generation guard + status checks) rather than chasing exactly-once.
- **Predicate flow model vs graph** — simpler edit-recalc and testing, at the cost of not modeling
  explicit "next-edge" flows; fine for this domain.
- **Soft-marking irrelevant answers vs deleting** — keeps an audit trail and makes branch re-switching
  cheap, at the cost of a `status` filter wherever answers are read.
- **Session UUID as bearer (no auth)** — appropriate for a take-home; anyone with the id can act on
  the session. Production would need real auth/authorization.
- **TypeORM `synchronize` off + migrations** — a little more setup than auto-sync, but honest about
  schema management. In compose the `api` container runs migrations against the compiled `dist/`
  before starting (the ts-node dev scripts aren't shipped in the slim runtime image).

---

## Environment reference

Copy [`.env.example`](.env.example) to `.env`. Every value has a default and is validated at boot
(Joi, `backend/src/config`).

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | Runtime environment. |
| `LOG_LEVEL` | `info` | pino log level. |
| `HTTP_PORT` | `3000` | API HTTP port (`/onboarding`, `/docs`, `/metrics`). |
| `WORKER_METRICS_PORT` | `3001` | Worker `/metrics` port. |
| `DB_HOST` / `DB_PORT` / `DB_USERNAME` / `DB_PASSWORD` / `DB_NAME` | `localhost` / `5432` / `postgres` / `postgres` / `onboarding` | PostgreSQL connection. |
| `REDIS_HOST` / `REDIS_PORT` | `localhost` / `6379` | Redis (BullMQ). |
| `EXTERNAL_LOOKUP_MAX_TRIGGERS` | `3` | Enqueue triggers (initial + manual retries) before permanent failure. |
| `OUTBOX_POLL_INTERVAL_MS` | `500` | OutboxRelay poll cadence. |
| `LOOKUP_DELAY_MIN_MS` / `LOOKUP_DELAY_MAX_MS` | `3000` / `8000` | Simulated lookup delay range. |
| `LOOKUP_FAILURE_RATE` | `0.1` | Simulated failure rate (0..1). |
| `LOOKUP_JOB_ATTEMPTS` | `3` | BullMQ attempts per trigger. |
| `VITE_API_URL` | `http://localhost:3000` | Dev-only Vite proxy target (`npm run dev`). |
| `FRONTEND_PORT` | `8080` | Host port for the compose `frontend` (nginx) service. |
| `PROMETHEUS_PORT` / `GRAFANA_PORT` | `9090` / `3300` | Observability profile host ports. |
| `GRAFANA_USER` / `GRAFANA_PASSWORD` | `admin` / `admin` | Grafana admin credentials. |

## Metrics

Prometheus text on both API (`:3000/metrics`) and worker (`:3001/metrics`):
`http_request_duration_seconds` (histogram), `answers_submitted_total`,
`external_lookup_duration_seconds`, `external_lookup_total{status}`,
`external_lookup_triggers_total`, `outbox_events_published_total`, `bullmq_queue_depth`.
