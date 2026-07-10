# Implementation Plan — Lemonade-style Onboarding App

**Date:** 2026-07-10
**Design spec:** `docs/design/onboarding-app-10-07-2026-design.md` (source of truth for architecture, data model, API contract, flow, async pipeline)
**Structured per:** `engineering-workflow:plan-guidelines` · test steps per `engineering-workflow:testing-standards`
**Status:** Ready to execute

---

## Context

Build the full "go big" onboarding application from the approved design spec: a NestJS +
Postgres/TypeORM backend, a React+Vite frontend, a predicate-based flow engine, and an
**outbox → BullMQ/Redis → worker** async property-lookup pipeline, with every bonus (Swagger,
optimistic locking, idempotency, structured logging, metrics, Testcontainers, seed, CI,
flow-definition validation).

The repo is greenfield (only the spec + `.gitignore` on `main`, pushed to
https://github.com/RonMizrahi/lemonade-hw). This plan turns the spec into milestones with
explicit implementation steps, test steps, and a code-quality gate each — the structure the
`/batch` execution (below) and its worktree agents follow.

**Outcome:** a runnable, tested, documented system that satisfies all required functionality
and technical points in the assignment, plus the bonus items, closed out and QA-signed-off.

---

## Branching Strategy — **D: delegate to `/batch`** (decided)

The **user** re-runs the `/batch` command and asks it to load `plan-guidelines`. `/batch`
researches, plans, and executes the change in parallel across isolated **worktree agents that
each open a PR**, every agent following these guidelines (its unit = a milestone below, and it
runs that milestone's test steps + the `code-quality-pipeline` step before opening its PR).

**Greenfield adaptation (mandatory ordering):** `/batch`'s "every unit independently mergeable
from empty main" model does not hold for a from-scratch, tightly-coupled build — workers would
collide on `package.json`, shared types, and module wiring. Therefore:

- **Milestone 1 (Foundation) is a SEQUENTIAL prerequisite** — it is shared state, so it is
  **not** parallelized. It is built and **merged to `main` first**, freezing the API contract
  and registering every provider/route/module as a stub.
- **Then the parallel wave fans out** off Foundation `main`. Parallelize only milestones with
  **zero shared state**; dependent milestones stay sequential (branch off the parent, or wait
  for the parent PR to merge).

**Dependency graph (drives what `/batch` may parallelize):**

```
M1 Foundation ──┬─► M2 Flow engine ──► M3 Answer flow ─┐
                ├─► M4 Async pipeline ─────────────────┴─► M5 Completion
                ├─► M6 Observability
                ├─► M7 Frontend + e2e
                └─► M8 Ops/CI/Docs (runs last — needs the assembled app)
```

Parallel-eligible immediately after M1 merges: **M2, M4, M6, M7** (disjoint files, no shared
state). **M3** waits on M2. **M5** waits on M3 + M4. **M8** runs last.

---

## Milestones

Every milestone below is a complete piece of functionality and includes, as mandatory steps,
its **test steps** (per `testing-standards`) and a **`code-quality-pipeline`** step run before
the milestone is considered done. Implementation detail lives in the design spec — steps here
name the work and the section to follow.

### M1 — Foundation & Scaffold  ·  *sequential prerequisite, merge to `main` first*
**Implementation steps**
1. Monorepo layout; backend NestJS 11 scaffold (`package.json` scripts: build/start/start:worker/lint/test/test:integration/test:e2e/migration:run/seed; tsconfig strict; nest-cli; eslint+prettier; jest).
2. `@nestjs/config` + env validation; `nestjs-pino` structured logging + correlation-id middleware; global exception filter (`{ statusCode, error, message, details? }`); global `ValidationPipe({ whitelist, transform })`.
3. TypeORM DataSource (`synchronize:false`) + **all 6 entities** and initial migration `0001-init`, exactly per spec §5 (`onboarding_session` w/ `@VersionColumn`, `answer`, `flow_version`, `external_lookup`, `outbox_event`, `idempotency_key`).
4. **Frozen contract** — `SessionStateDto` + enums + `QuestionDto` (spec §6); request DTOs (start/submit/edit/retry/complete) with class-validator.
5. `onboarding.module` + `onboarding.controller` wiring **all 6 routes** to handler classes (Swagger-annotated); handlers **stubbed** (`NotImplementedException`); **implement** repositories (6), `SessionStateAssembler`, `OutboxWriter`; `FlowEngine` interface + token + trivial stub; `SimulatedPropertyService` interface + processor/relay stubs; empty `metrics.module`; `setupSwagger` no-op stub.
6. Frontend Vite+React+TS scaffold; `src/api/types.ts` + `src/api/client.ts` mirroring the frozen contract; `App` stub.
7. Root: `docker-compose.yml` skeleton (db, redis, api, worker, frontend); `.env.example`; `ops/prometheus.yml` + `.github/workflows/ci.yml` skeletons.

**Test steps**
- **Unit:** env-config validation; exception-filter output shape; a repository CRUD smoke.
- **Integration (Testcontainers Postgres):** app boots; `migration:run` creates all 6 tables; each stubbed route is reachable and returns its wired status, asserting response **shape**.
- **`code-quality-pipeline`** step.

### M2 — Flow Engine (pure)  ·  *after M1 · parallel-eligible*
**Implementation steps**
1. `flow-definition.ts` — the 13-question flow with own/rent + nested security branch (spec §3).
2. Pure `visibleQuestions` / `currentQuestion` / `validateAnswer` / `reconcile` / `completionChecklist` (spec §4); replace Foundation's stub.
3. `validateFlowDefinition()` boot-time validator (unique ids, choice presence, predicate refs).

**Test steps**
- **Unit (breadth — this is where it lives):** own vs rent branching; nested security→monitored; skip/irrelevant marking; `currentQuestion` selection; per-type + business validation (18+, coverage-start not past); `reconcile` on branch-switch edit; `completionChecklist`; validator rejects dup ids / bad predicate refs. Random IDs where applicable.
- **`code-quality-pipeline`** step.

### M3 — Answer Flow: start · get-state · submit · edit  ·  *after M2*
**Implementation steps**
1. `start-session` + `get-state` handlers.
2. `submit-answer` handler — validate via FlowEngine, **idempotency** (`Idempotency-Key` + `idempotency_key` repo), **optimistic lock** (`expectedVersion`/`@VersionColumn`), persist answer, compute next, and **write outbox** on the address answer (via `OutboxWriter`).
3. `edit-answer` handler — validate, `reconcile` + mark irrelevant, re-trigger lookup on address change, optimistic lock.

**Test steps**
- **Unit (breadth):** submit validation paths; idempotency replay (same key+body → one write; same key+different body → reject); optimistic-lock mismatch; edit reconciliation marking; address-change re-trigger decision.
- **Integration (Testcontainers Postgres; per endpoint = happy + 2–3 key failures; assert shape; random IDs):** `POST /sessions` (201); `GET /sessions/:id` (200, 404); `POST /answers` (200, 400 invalid, 409 stale, 422 idempotency reuse); `PUT /answers/:qid` (200 recalculated, 400, 404 not-answered, 409 stale).
- **`code-quality-pipeline`** step.

### M4 — Async External Lookup Pipeline  ·  *after M1 · parallel-eligible*
**Implementation steps**
1. `SimulatedPropertyService` — 3–8s delay, ~10% fail, both injectable for tests.
2. `OutboxRelay` — poll `pending` (`FOR UPDATE SKIP LOCKED`) → publish to BullMQ → mark published.
3. BullMQ module/queue + `LookupProcessor` — generation guard, `loading`→`completed`/`failed`, BullMQ retry/backoff, `permanently_failed` + fallback after `max_triggers`.
4. `retry-lookup` handler (re-trigger via outbox, `Idempotency-Key`); `main.worker.ts` wiring (relay + processor).

**Test steps**
- **Unit (breadth):** sim outcome logic (forced success/fail via injected RNG); generation-guard drop of stale job; permanent-fail/fallback transition; retry gating (only `failed` & `triggers < max`).
- **Integration (Testcontainers Postgres + Redis):** trigger writes answer+outbox atomically; relay publishes; processor advances `external_lookup` status; forced failure → `failed`; `POST /external-lookup/retry` (202, 409 when not-failed / max reached); stale-generation job dropped. Random IDs.
- **`code-quality-pipeline`** step.

### M5 — Completion (+ backend full-journey e2e)  ·  *after M3 + M4*
**Implementation steps**
1. `complete` handler — gate on all required-visible answered **and** lookup `completed` or `permanently_failed`; `expectedVersion`; build normalized summary (active answers only, `dataSource` flag); set `completed`; idempotent re-complete returns the summary (spec §9).

**Test steps**
- **Unit (breadth):** gating combinations (missing required → blocked; lookup loading → blocked; `permanently_failed` → allowed w/ fallback); summary normalization.
- **Integration:** `POST /complete` (200 + summary shape; 409 requirements unmet; 409 stale).
- **Backend full-journey e2e (supertest — satisfies the assignment's "≥1 e2e"):** start → answer homeowner branch → address flips `externalLookup` to loading & returns immediately → keep answering while it runs → poll to `completed` → complete → assert summary shape. Second journey: forced failure → retry → exhaust `max_triggers` → `permanently_failed` + fallback → complete succeeds. Random IDs.
- **`code-quality-pipeline`** step.

### M6 — Observability: Swagger + Metrics  ·  *after M1 · parallel-eligible*
**Implementation steps**
1. `setupSwagger` → `/docs` (OpenAPI).
2. Prometheus module + `/metrics` on API and worker; series per spec §11; ensure correlation id propagates into job data.

**Test steps**
- **Integration:** `GET /docs` serves OpenAPI JSON; `GET /metrics` returns Prometheus text with the expected series present.
- **`code-quality-pipeline`** step.

### M7 — Frontend Wizard (+ Playwright e2e)  ·  *after M1 contract · parallel-eligible*
**Implementation steps**
1. SPA: start → one question at a time (input by type) → back/edit → persistent lookup-status badge polling `GET /sessions/:id` → retry on failed → complete gated on `canComplete` → summary view. Minimal styling.

**Test steps**
- **Unit/component:** per-type question renderer; state reducer; polling hook (mocked client).
- **E2E (Playwright — the UI critical journey, per `testing-standards` for UI projects):** start → homeowner branch → address triggers the lookup badge → keep answering while loading → badge reaches completed → complete → summary shown. One money-path journey.
- **`code-quality-pipeline`** step.

### M8 — Ops, CI & Docs  ·  *runs last (needs assembled app)*
**Implementation steps**
1. Finalize `docker-compose.yml` (db+redis+api+worker+frontend; migrations+seed on boot; optional `observability` profile: prometheus+grafana); Dockerfiles + `nginx.conf`.
2. `seed` script — real `FlowVersion` registration (idempotent).
3. GitHub Actions CI: lint → build → unit → integration/e2e (Testcontainers).
4. `README` + architecture explanation + API docs (link `/docs` + summary) + DB schema/ERD + test instructions + trade-offs + `.env` reference.

**Test steps**
- **Integration/smoke:** `docker compose up --build` brings the stack healthy; CI workflow green on push/PR.
- **`code-quality-pipeline`** step.

---

## Phase 3 — Close-out (after all milestones land)
1. **Update this plan file** — mark each milestone `[DONE]`/`[SKIPPED]`/`[DEFERRED]` with reasons; record key decisions that deviated from the spec; record verification results.
2. **Create/update the project root `CLAUDE.md`** (<100 lines) — structure (backend/frontend layout), commands (build/test/lint/migrate/seed/compose), architectural patterns (layering, flow engine, outbox→queue→worker), env requirements; link to the spec + this plan; no history duplication.
3. **Run `claude-md-management:claude-md-improver`** to validate the CLAUDE.md updates (or do it manually + note if the plugin is absent).

## Phase 4 — QA Handover (final acceptance gate)
1. Assemble & run the integrated system (all milestone PRs merged; real DB/Redis/config via `docker compose up`, not a test harness).
2. Hand to `qa-engineer` with the intake bundle: this plan file, changed endpoints/UI, how to run + reach the app, seed data, and two identities for authorization probing. It reads the committed tests first and targets only the delta (deploy/config/boot reality, BOLA/IDOR, injection, serialization leaks, fuzz).
3. Gate on the verdict: **PASS** → done. **PASS-WITH-ISSUES** → fix every S1/S2 on a fix branch, re-close, re-hand-over; S3/S4 become follow-ups. **BLOCK** → fix and re-hand-over.
4. Record the QA verdict in this plan's verification results, and convert each confirmed finding into a committed test at the right level per `testing-standards`.

---

## Definition of Done
- All required functionality + technical points from the assignment implemented and green at unit + integration levels; backend full-journey e2e + frontend Playwright e2e passing.
- All bonus items present (Swagger, outbox, queue/Redis worker, optimistic locking, structured logging, metrics, CI, seed, flow-definition validation, Testcontainers).
- `docker compose up` runs the whole system; `/docs` and `/metrics` reachable.
- Plan closed out (Phase 3) and QA signed off (Phase 4).

## Next action
**User runs `/batch` and asks it to load `plan-guidelines`**, pointing at this plan. `/batch`
builds **M1 (Foundation) first and merges it**, then fans out M2/M4/M6/M7 in parallel with
M3→M5 and M8 sequenced per the dependency graph — each worktree agent running its milestone's
test steps + `code-quality-pipeline` before opening its PR.
