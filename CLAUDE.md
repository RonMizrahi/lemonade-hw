# Lemonade-style Onboarding App

Dynamic onboarding wizard: a branching question flow where the address step fires a simulated
slow external property lookup that runs asynchronously (outbox → BullMQ → worker) while the
customer keeps answering; onboarding completes once all required questions are answered and the
lookup is terminal (completed, or permanently-failed with a fallback applied).

- **Design spec:** `docs/design/onboarding-app-10-07-2026-design.md`
- **Implementation plan / milestone record:** `docs/plans/onboarding-app-10-07-2026-plan.md`

## Structure
- `backend/` — NestJS, one codebase / **two entrypoints**: `src/main.ts` (HTTP API), `src/main.worker.ts` (OutboxRelay + BullMQ consumer).
  - `src/onboarding/` — controller → service → repositories; the use-cases (start/get/submit/edit/retry/complete), `session-state.assembler`, `summary-builder`, idempotency, `outbox/outbox-writer`.
  - `src/flow-engine/` — **pure** predicate engine (visibility/validation/reconcile/completion) + `flow-definition.ts` (13 questions) + boot-time `validate-flow-definition`. Zero I/O.
  - `src/async-lookup/` — `SimulatedPropertyService`, `OutboxRelay`, `LookupProcessor` (BullMQ), `LookupTriggerService`.
  - `src/metrics/` — Prometheus `/metrics` (API + worker). `src/database/` — entities, migrations, seed, `data-source`.
- `frontend/` — React + Vite SPA wizard (served via nginx in compose, reverse-proxying `/onboarding`,`/docs`,`/metrics` to the api).
- `docker-compose.yml` — db + redis + api + worker + frontend; `--profile observability` adds prometheus + grafana.
- `.github/workflows/ci.yml` — lint → build → unit → integration → e2e (Testcontainers).

## Commands (in `backend/`)
- `npm run build` · `npm run lint`
- `npm run test:unit` · `npm run test:integration` · `npm run test:e2e` — integration/e2e use **Testcontainers** (real Postgres + Redis; Docker required)
- `npm run migration:run` · `npm run seed`
- **Full stack** (repo root): `docker compose up --build` → api `:3000` (`/docs`, `/metrics`), worker `:3001` (`/metrics`), frontend `:8080`

## Architecture / conventions
- **Strict layering:** Controller → Service → Repository → Postgres. `FlowEngine` pure (no I/O). `OutboxWriter` writes in the **same transaction** as the answer.
- **Data:** PostgreSQL via TypeORM (`synchronize:false`, migrations only). **Optimistic locking** via a guarded conditional version UPDATE (`WHERE id AND version`; `expectedVersion` mismatch → 409).
- **Async pipeline:** transactional outbox → `OutboxRelay` (`FOR UPDATE SKIP LOCKED`) → BullMQ `external-lookup` queue → `LookupProcessor` (generation guard, retry/backoff, `permanently_failed` + fallback after `max_triggers`). Frontend **polls** `GET /onboarding/sessions/:id`.
- **Idempotency:** `Idempotency-Key` header on submit/retry (request-hash replay; 422 on reuse with a different body).
- No `any`/casting; DTOs + global `ValidationPipe`; structured logging (`nestjs-pino`); Swagger at `/docs`.
- **No auth** — the session UUID is the bearer token (deliberate take-home simplification; see plan/README trade-offs).

## Status
All 8 milestones (M1–M8) merged to `main`. Test pyramid: **unit 114 · integration 41 · e2e 2**. Per-milestone PRs are recorded in the plan file's Execution Record.
