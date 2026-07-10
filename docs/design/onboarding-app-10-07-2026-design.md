# Onboarding Application — Design Spec

**Date:** 2026-07-10
**Status:** Draft for review
**Author:** Ron (with Claude)

A Lemonade-style dynamic onboarding wizard: a customer is guided through a branching sequence of questions; at the address step the backend fires a simulated slow external property lookup that runs asynchronously while the customer keeps answering unrelated questions; onboarding completes once all required questions are answered and the external data is available (or has permanently failed and a fallback is applied).

---

## 1. Scope & Decisions

Decisions locked during brainstorming. **Target level: "go big" — 100% of required functionality + every bonus item.**

| Area | Decision |
|---|---|
| **Frontend** | React + Vite (SPA, `fetch`/axios to the Nest API). Visual design is not graded. |
| **Backend** | NestJS + TypeScript. |
| **Database** | PostgreSQL via **TypeORM** (native `@nestjs/typeorm`, `@VersionColumn` for optimistic locking). |
| **Async lookup** | **Queue-based**: BullMQ + Redis. Triggered via the **outbox pattern** (event written in the same DB tx as the answer), relayed to the queue, processed by a **worker** with retry/backoff. Status persisted in DB; frontend **polls** `GET /sessions/:id`. |
| **Flow engine** | **Predicate / visibility model** (see §4). |

### Bonus items — all included
| Bonus | How |
|---|---|
| OpenAPI/Swagger | `@nestjs/swagger` at `/docs`. |
| **Outbox pattern** | `outbox_event` table written in the answer transaction; an **OutboxRelay** publishes to BullMQ. Guarantees the lookup is enqueued iff the answer commit succeeded (at-least-once). §7. |
| **Queue-based processing** | BullMQ `external-lookup` queue on Redis; a dedicated **worker** consumes it. §7. |
| Optimistic locking | TypeORM `@VersionColumn` + `expectedVersion` on all writes → 409. |
| Structured logging | `nestjs-pino`, JSON, correlation id propagated into queue jobs. |
| **Metrics** | `prom-client` via `@willsoto/nestjs-prometheus`; `/metrics` on API **and** worker; optional Prometheus+Grafana compose profile. |
| CI workflow | GitHub Actions: lint → build → unit → integration/e2e (Testcontainers). |
| Seed script | Registers the active `FlowVersion` (idempotent); `npm run seed` + on boot. |
| Flow-definition validation | `validateFlowDefinition()` fails fast at boot. §4. |
| **Testcontainers** | Integration + e2e spin up real Postgres **and** Redis via `@testcontainers/*`. §10. |

### Non-goals
- **Auth / users.** The session UUID is the bearer token; anyone with the ID can act on the session. Called out as a deliberate simplification.
- **Real external API.** The property service is simulated inside the worker.

---

## 2. Architecture Overview

Monorepo — API + worker share one backend codebase (two entrypoints), plus the SPA:

```
lemonade-hw/
├── backend/                 # NestJS — one codebase, two entrypoints:
│   ├── src/main.ts          #   API process (HTTP)
│   ├── src/main.worker.ts   #   Worker process (OutboxRelay + BullMQ consumer)
│   └── ...
├── frontend/                # React + Vite SPA
├── docker-compose.yml       # postgres + redis + api + worker + frontend
│                            #   (+ optional `observability` profile: prometheus + grafana)
├── ops/prometheus.yml       # scrape config for api + worker /metrics
├── .env.example
├── .github/workflows/ci.yml
├── docs/
└── README.md
```

### Runtime topology

```
                       ┌─────────── Postgres ───────────┐
 Browser ──HTTP──► API │ sessions/answers/outbox (1 tx) │
   ▲   poll GET        └────────────────┬───────────────┘
   │                                    │ outbox rows
   │                          OutboxRelay (worker) ──publish──► Redis (BullMQ)
   │                                                               │
   └──────── status in DB ◄── Worker consumer ◄──────────────────┘
                               simulate 3–8s / ~10% fail / retry+backoff
   API /metrics ─┐
   Worker /metrics ─┴──► Prometheus ──► Grafana   (optional profile)
```

### Backend layering (strict separation — a graded requirement)

```
HTTP → Controller → Service → Repository → Postgres
                       │
                       ├── FlowEngine    (pure, no I/O)
                       └── OutboxWriter   (enqueue-intent, same tx as the answer)

Worker: OutboxRelay → BullMQ Queue → LookupProcessor → SimulatedPropertyService
```

- **Controller** — HTTP only. DTO validation via `ValidationPipe`, maps domain results/errors to HTTP. No business logic.
- **Service** — orchestration + transactions. Owns the use-cases (start, submit, edit, retry, complete). Calls FlowEngine for decisions, Repository for persistence, writes outbox events.
- **Repository** — all TypeORM access. No business rules. One repo per aggregate.
- **FlowEngine** — **pure functions**, zero I/O: visibility, current question, answer validation, reconciliation, completion checklist. 100% unit-testable. Where branching/skip/edit-recalc logic lives.
- **OutboxRelay** (worker) — polls `outbox_event` for `pending` rows, publishes to the BullMQ queue, marks them `published`. At-least-once.
- **LookupProcessor** (worker) — BullMQ consumer: runs the simulated slow service, persists status, relies on BullMQ retry/backoff, applies the fallback on permanent failure.
- **SimulatedPropertyService** — the 3–8s / ~10%-fail mock; delay + failure injectable for deterministic tests.

### Tech choices
- **Validation:** `class-validator` + `class-transformer`, global `ValidationPipe({ whitelist: true, transform: true })`.
- **Queue:** `@nestjs/bullmq` + BullMQ on Redis 7.
- **Docs:** `@nestjs/swagger` → `/docs`.
- **Logging:** `nestjs-pino` — structured JSON, per-request correlation id, propagated into job data so worker logs correlate to the originating request.
- **Metrics:** `@willsoto/nestjs-prometheus` (`prom-client`) — `/metrics` on both processes.
- **Config:** `@nestjs/config`, `.env` driven.
- **Migrations:** TypeORM migrations (no `synchronize` in non-test).

---

## 3. Domain: the onboarding flow

Home / renters insurance onboarding. **13 questions defined, 6 always-visible + branch-specific**, with a top-level branch (own vs rent) and a nested branch (security system). Any given customer answers 9–10 questions; the rest are skipped.

| # | questionId | type | visibleWhen | required | notes |
|---|---|---|---|---|---|
| 1 | `full_name` | text | always | ✓ | |
| 2 | `date_of_birth` | date | always | ✓ | must be 18+ |
| 3 | `residence_type` | choice(`own`,`rent`) | always | ✓ | **top-level branch** |
| 4 | `property_address` | address | always | ✓ | **triggers external lookup** |
| 5 | `year_built` | number | `residence_type == own` | ✓ | |
| 6 | `construction_type` | choice(`wood`,`brick`,`concrete`) | `residence_type == own` | ✓ | |
| 7 | `has_security_system` | boolean | `residence_type == own` | ✓ | **nested branch** |
| 8 | `security_system_monitored` | boolean | `residence_type == own && has_security_system == true` | ✓ | nested |
| 9 | `monthly_rent` | number | `residence_type == rent` | ✓ | |
| 10 | `landlord_has_insurance` | boolean | `residence_type == rent` | ✓ | |
| 11 | `num_roommates` | number | `residence_type == rent` | ✓ | |
| 12 | `coverage_start_date` | date | always | ✓ | not in the past |
| 13 | `wants_earthquake_coverage` | boolean | always | ✓ | |

**Skip semantics:** when `residence_type == own`, questions 9–11 are never shown (and vice-versa). If a customer answers as a renter, then edits `residence_type` to `own`, answers 9–11 are marked `irrelevant` and 5–8 become the remaining flow.

---

## 4. Flow Engine (the core)

**Model: ordered question list + pure visibility predicates.**

A `FlowDefinition` is a versioned, declarative object (hard-coded in code now, shaped to move to config/DB later):

```ts
interface QuestionDef {
  id: string;
  type: 'text' | 'number' | 'boolean' | 'date' | 'choice' | 'address';
  required: boolean;
  choices?: string[];
  // pure predicate over the current answer map; undefined ⇒ always visible
  visibleWhen?: (answers: AnswerMap) => boolean;
  // per-type validation beyond the base type check
  validate?: (value: unknown, answers: AnswerMap) => string | null;
}

interface FlowDefinition {
  version: number;
  questions: QuestionDef[];   // declaration order == presentation order
}
```

Core pure functions (all unit-tested, no I/O):

- `visibleQuestions(flow, answers)` → the questions whose `visibleWhen` holds given current answers.
- `currentQuestion(flow, answers)` → first **visible & unanswered** question, or `null` when none remain.
- `validateAnswer(flow, questionId, value, answers)` → type + rule validation; returns errors or ok.
- `reconcile(flow, answers)` → after any write, returns which stored answers are now **irrelevant** (answer exists for a question no longer visible) so the service can mark them.
- `completionChecklist(flow, answers)` → which required visible questions are still unanswered.

**Why this model:** branching, skipping, and — critically — **edit-recalculation** all fall out of one idea: *visibility is a pure function of the answer set.* Editing an earlier answer just changes the answer map; re-running `visibleQuestions` / `reconcile` yields the new remaining flow and the now-irrelevant answers, with no graph surgery. It's trivial to test and impossible to create unreachable nodes.

**Alternative considered — graph/edge model:** each question holds explicit transition edges with conditions. Rejected: edit-recalculation requires re-walking and pruning the traversed path, unreachable nodes are easy to introduce, and it's harder to unit-test. The predicate model is strictly simpler for these requirements.

**Flow-definition validation (bonus):** at boot, a `validateFlowDefinition()` checks: unique question ids; `choices` present for `choice` type; predicates only reference declared question ids; at least one always-visible question. Fails fast on a bad definition.

**Versioning:** the active `FlowDefinition.version` is persisted as a `FlowVersion` row; every session pins the `flow_version_id` it started under, so in-flight sessions are stable even if the flow changes.

---

## 5. Data Model

The five required entities + summary storage + an **`outbox_event`** table (outbox pattern).

### `onboarding_session`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `status` | enum(`in_progress`,`completed`) | |
| `flow_version_id` | fk → flow_version | pinned at creation |
| `version` | int | **`@VersionColumn`** — optimistic lock |
| `summary` | jsonb null | populated on completion |
| `created_at`/`updated_at`/`completed_at` | timestamptz | |

### `answer`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `session_id` | fk | |
| `question_id` | text | |
| `value` | jsonb | normalized answer value |
| `status` | enum(`active`,`irrelevant`) | irrelevant = superseded by a branch change |
| `created_at`/`updated_at` | timestamptz | |
| | | **unique(`session_id`,`question_id`)** |

### `flow_version`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `version` | int unique | |
| `definition` | jsonb | serialized structural snapshot (metadata; predicates live in code) |
| `created_at` | timestamptz | |

### `external_lookup`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `session_id` | fk unique | one lookup per session |
| `status` | enum(`not_started`,`loading`,`completed`,`failed`,`permanently_failed`) | |
| `generation` | int | bumped when the address changes; jobs carry it, stale jobs are ignored |
| `triggers` | int | # of enqueue triggers (initial + manual retries) |
| `max_triggers` | int | default 3 (config) |
| `job_attempts` | int | BullMQ attempts on the current trigger |
| `result` | jsonb null | mock property data (or fallback, with `fallback:true`) |
| `error` | text null | last failure reason |
| `created_at`/`updated_at`/`last_attempt_at` | timestamptz | |

### `outbox_event`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `aggregate_type` | text | e.g. `external_lookup` |
| `aggregate_id` | uuid | |
| `type` | text | e.g. `external_lookup.requested` |
| `payload` | jsonb | `{ lookupId, sessionId, generation }` |
| `status` | enum(`pending`,`published`) | |
| `publish_attempts` | int | relay retry counter |
| `created_at`/`published_at` | timestamptz | index on `(status, created_at)` for the relay |

### `idempotency_key`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `key` | text unique | client-supplied `Idempotency-Key` header |
| `session_id` | fk | |
| `request_hash` | text | hash of method+path+body; mismatch on same key ⇒ 422 |
| `response` | jsonb | stored response for replay |
| `status_code` | int | |
| `created_at` | timestamptz | |

---

## 6. API Design

Base path `/onboarding`. All write responses return the **full session state** so the frontend never guesses.

### Session state shape (returned by GET and every write)
```jsonc
{
  "sessionId": "uuid",
  "status": "in_progress | completed",
  "version": 7,                       // send back as expectedVersion on next write
  "currentQuestion": { "id": "...", "type": "...", "choices": [...] } | null,
  "answeredQuestions": [ { "questionId": "...", "value": ..., "status": "active" } ],
  "externalLookup": { "status": "loading", "attempts": 1, "result": null },
  "completion": { "canComplete": false, "missingRequired": ["coverage_start_date"] },
  "summary": null                     // populated when completed
}
```

### Endpoints

| Method & path | Purpose | Key inputs | Success | Notable errors |
|---|---|---|---|---|
| `POST /onboarding/sessions` | Start | — | 201 + state (first question) | |
| `GET /onboarding/sessions/:id` | Fetch state (**polling target**) | — | 200 + state | 404 |
| `POST /onboarding/sessions/:id/answers` | Submit current answer | header `Idempotency-Key`; body `{questionId, value, expectedVersion}` | 200 + state | 400 validation, 409 stale version / not-current-question, 422 idempotency-key reuse w/ different body |
| `PUT /onboarding/sessions/:id/answers/:questionId` | Edit a prior answer | body `{value, expectedVersion}` | 200 + state (recalculated) | 400, 404 (not answered), 409 stale |
| `POST /onboarding/sessions/:id/external-lookup/retry` | Retry failed lookup | header `Idempotency-Key` | 202 + state (re-enqueued) | 409 (not in `failed` state / `max_triggers` reached) |
| `POST /onboarding/sessions/:id/complete` | Complete | body `{expectedVersion}` | 200 + summary | 409 (requirements unmet / lookup not terminal / stale) |

### Cross-cutting

- **Idempotency (POST answers):** `Idempotency-Key` header required. First call executes and stores the response; replays with the same key + same body return the stored response verbatim; same key + different body ⇒ 422. Guarantees a retried "submit" never double-writes.
- **Optimistic locking (all writes):** client echoes `expectedVersion`; a mismatch (concurrent update landed first) ⇒ **409 Conflict** with the current state so the client can reconcile. Backed by TypeORM `@VersionColumn`; writes happen inside a transaction that bumps the version.
- **Error format:** consistent `{ statusCode, error, message, details? }` via a global exception filter.
- **Validation:** DTOs + `class-validator`; unknown fields stripped (`whitelist`).

---

## 7. Async External Lookup — outbox → queue → worker

The whole point of the assignment's async requirement, done the reliable way. Four stages.

### Stage 1 — Trigger (API, transactional)
When `property_address` is answered (POST, or an edit that *changes* the address), the service, **in one DB transaction**:
1. upserts the answer,
2. upserts the `external_lookup` row → status `not_started`, `generation += 1`, `triggers += 1`,
3. inserts an `outbox_event` (`external_lookup.requested`, payload `{ lookupId, sessionId, generation }`),
4. bumps the session `version`, commits.

The HTTP response returns **immediately** with `externalLookup.status` (`not_started`/`loading`). Nothing async happens inside the request. The outbox insert being in the *same transaction* as the answer is the guarantee: the lookup is enqueued **iff** the answer actually committed — no lost triggers, no phantom triggers.

### Stage 2 — Relay (worker → Redis)
`OutboxRelay` polls `outbox_event` for `pending` rows (short interval, e.g. 500ms; `FOR UPDATE SKIP LOCKED` so multiple workers don't double-publish), publishes each to the BullMQ `external-lookup` queue, marks the row `published`. At-least-once delivery; the processor is idempotent (Stage 3) so a duplicate publish is harmless.

### Stage 3 — Process (worker → BullMQ consumer)
`LookupProcessor` handles a job `{ lookupId, generation }`:
1. Load the lookup. **Generation guard:** if `job.generation !== lookup.generation`, the address has since changed — ack and drop (stale job).
2. Set status `loading`, `last_attempt_at = now`, `job_attempts += 1`.
3. `SimulatedPropertyService`: random **3–8s** delay, **~10%** random failure (both injectable for tests).
4. **Success** → status `completed`, `result` = mock property data (estimatedValue, squareFeet, yearBuilt, floodZone, roofType, hazards…).
5. **Failure** → throw. BullMQ retries the job automatically (`attempts: N`, exponential `backoff`). On exhaustion the `failed` handler sets status `failed`.

### Stage 4 — Retry & permanent failure
- **Automatic:** BullMQ backoff within a single trigger (transient failures self-heal).
- **Manual:** `POST …/external-lookup/retry`, allowed only when status is `failed` and `triggers < max_triggers`. It re-runs Stage 1's trigger machinery (new `outbox_event`, same generation) → new job. Idempotency-Key supported to guard double-clicks.
- **Permanent:** once `triggers >= max_triggers` and it still fails, status → `permanently_failed` and `result` = fallback record (`{ fallback: true, dataSource: 'fallback', … }`). This unblocks completion (§9).

### Why this survives the hard parts
- **Async + keep answering:** the trigger returns instantly; status lives in Postgres; the customer answers other questions freely and the frontend **polls** `GET /sessions/:id` to watch `not_started → loading → completed | failed`. Answering non-address questions touches different rows — zero contention with the running lookup.
- **Reliability:** outbox ⇒ no trigger lost on a crash between "answer saved" and "job enqueued"; BullMQ ⇒ durable retries; generation guard ⇒ editing the address mid-flight can't be clobbered by a stale success.
- **Correlation:** the request's correlation id rides in the job payload, so worker logs tie back to the originating HTTP call.

### UI state mapping
DB `not_started/loading/completed/failed` map 1:1 to the four required UI states; `permanently_failed` renders as "Failed — fallback applied," which enables Complete.

---

## 8. Edit & Recalculation Semantics

On `PUT …/answers/:questionId`:
1. Optimistic-lock check (`expectedVersion`).
2. Validate the new value.
3. Upsert the answer.
4. `reconcile(flow, answers)` → mark any answers now hidden as `irrelevant` (kept in the DB for audit, excluded from `active` set and summary).
5. If the edited question is `property_address` **and the value changed** → re-trigger the lookup (new attempt generation).
6. Recompute `currentQuestion` + completion checklist; return full state.

Irrelevant answers are **retained** (soft-marked), not deleted — so re-editing back to the original branch could even restore context, and there's an audit trail. Summary only ever includes `active` answers.

---

## 9. Completion

`POST …/complete` succeeds only when **all** hold:
- Every **required & visible** question has an `active` answer (`completionChecklist` empty).
- External lookup status is `completed` **or** `permanently_failed` (fallback applied).
- `expectedVersion` matches.

On success: build the **normalized summary** (jsonb) — personal details, residence type, branch-specific answers, resolved property data (real or fallback + a `dataSource` flag), coverage selections — persist it, set `status=completed`, `completed_at`. Completing an already-completed session returns the stored summary (idempotent).

---

## 10. Testing Strategy

Three levels (assignment requires all three), real infra via **Testcontainers**:

- **Unit** (Jest) — the FlowEngine pure functions: branching, skip, `currentQuestion`, `validateAnswer`, `reconcile` (edit recalculation, irrelevant marking), `completionChecklist`; the flow-definition validator; the `SimulatedPropertyService` outcome logic (delay/fail injected deterministically); the generation-guard logic. No I/O.
- **Integration** (Jest + **Testcontainers** Postgres *and* Redis) — services + repositories + the outbox/queue wiring against real infra: idempotent double-submit returns one write; stale `expectedVersion` → 409; edit recalculation persists `irrelevant`; a trigger writes both the answer and the outbox row atomically; the relay publishes and the processor advances `external_lookup` status; generation guard drops a stale job. Randomly-generated ids so tests are idempotent against the container DB.
- **E2E** (Jest + `supertest`, ≥1, Testcontainers Postgres + Redis, real API + worker) — a full journey over HTTP: start → answer through a branch → address triggers lookup → keep answering while it runs → poll until terminal → complete → assert summary shape. A second e2e covers the edit-branch-switch path; a third forces a lookup failure → manual retry → permanent failure → completion with fallback.

Deterministic async in tests: delay/failure in `SimulatedPropertyService` are injected via config/seeded RNG so tests force fast success or guaranteed failure without flakiness. `@testcontainers/postgresql` and `@testcontainers/redis` bring real Postgres + Redis up per suite (also used by CI).

---

## 11. Deliverables

- Working source (backend + frontend).
- **README** — setup, run, architecture summary, API docs pointer, trade-offs.
- **Architecture explanation** (this doc + README section).
- **API documentation** — Swagger UI at `/docs` + summary table.
- **Database schema** — TypeORM migrations + an ER description in the README.
- **Test instructions** — commands per level.
- **Trade-offs** — dedicated README section (see §12).
- **docker-compose.yml** — postgres + backend + frontend, one `docker compose up`.
- **`.env.example`** — every configurable value.

### Frontend (React + Vite) screens
Single-page wizard: start button → one question at a time (input rendered by question type) → Back/Edit to revisit answers → a persistent **lookup-status badge** (polls in the background) → Retry button when failed → Complete button (enabled only when `canComplete`) → summary view. Minimal styling; correctness first.

### Docker Compose
- `db`: postgres:16, healthcheck, named volume.
- `redis`: redis:7, healthcheck.
- `api`: builds Nest (`main.ts`), waits for db+redis health, runs migrations + seed on boot, exposes 3000 (`/docs`, `/metrics`).
- `worker`: same image, `main.worker.ts` entrypoint — OutboxRelay + BullMQ consumer; exposes its own `/metrics`.
- `frontend`: builds Vite, serves static (nginx), exposes 8080.
- **Optional `observability` profile** (`docker compose --profile observability up`): `prometheus` (scrapes api + worker via `ops/prometheus.yml`) + `grafana`. Off by default so the core stack stays light.

One `docker compose up` brings up db + redis + api + worker + frontend.

### Metrics (bonus)
`/metrics` (Prometheus text) on both API and worker. Series: `http_request_duration_seconds` (histogram), `answers_submitted_total`, `external_lookup_duration_seconds`, `external_lookup_total{status}`, `external_lookup_triggers_total`, `outbox_events_published_total`, `bullmq_queue_depth`. Scraped by the optional Prometheus, visualized in Grafana.

### Seed script (bonus)
Registers the current `FlowVersion` row (idempotent) and optionally a demo session. Runs on API boot and via `npm run seed`.

### CI (bonus)
GitHub Actions: install → lint → build → unit → integration + e2e (Testcontainers brings up Postgres + Redis inside the runner; Docker is available on GitHub-hosted runners). Runs on PR + main.

---

## 12. Trade-offs (to expand in README)

- **Queue + outbox vs in-process job** — chose the production-grade path: BullMQ worker + transactional outbox. Cost: Redis + a worker process + more moving parts to run and test. Benefit: durable retries, survives restarts mid-lookup, horizontally scalable workers, and no lost/phantom triggers. The outbox is what makes "answer committed ⇒ lookup enqueued" exactly-consistent instead of best-effort.
- **Worker as a separate process vs in-API processor** — separate `main.worker.ts` container demonstrates decoupled, independently-scalable queue processing; the trade-off is a second entrypoint and shared-module wiring. Could collapse into the API for a smaller footprint.
- **Polling vs WebSocket/SSE** — polling `GET /sessions/:id` is trivial and robust for a wizard; push would be lower-latency but adds transport complexity for little UX gain here.
- **At-least-once delivery** — outbox + queue give at-least-once, so the `LookupProcessor` is made idempotent (generation guard + status checks) rather than chasing exactly-once.
- **Predicate flow model vs graph** — simpler edit-recalc and testing (see §4), at the cost of not modeling "explicit next-edge" flows; fine for this domain.
- **Soft-marking irrelevant answers vs deleting** — keeps an audit trail and makes branch re-switching cheap, at the cost of a `status` filter everywhere answers are read.
- **Session UUID as bearer (no auth)** — appropriate for a take-home; production would need real auth/authorization.
- **TypeORM `synchronize` off + migrations** — a little more setup than auto-sync, but honest about schema management.

---

## 13. Open Questions / Assumptions

- Assumed **home/renters insurance** domain (matches the assignment's own/rent example). Swappable — the flow lives in one definition file.
- Assumed `max_triggers = 3` enqueue triggers (initial + manual retries), each with BullMQ automatic backoff, before permanent failure + fallback (config).
- Assumed 18+ age validation and "coverage start not in the past" as representative business rules to demonstrate `validate`.
- Assumed no multi-user concurrency in the UI, but the optimistic-locking + idempotency machinery is built and tested as required regardless.
```
