# Silkroad — Brain Ingestion Spec

**Created: August 13, 2026.** Elaborates roadmap Track A2 (the brain) based on Amir's
direction: the brain ingests from every surface (iMessage, email, web chat, documents the
agent touches), responding must never wait on ingestion, and ingestion must be selective —
skip what is already known or irrelevant. Constraints inherited from
[`brief.md`](./brief.md) §6 are non-negotiable.

## Core principle: log everything, distill selectively

Two stores with different jobs:

1. **Raw log** — every message in and out, on every surface, plus every document the agent
   touches, appended **synchronously** at the moment it happens. A dumb append (Postgres
   insert + embedding), no LLM involved, adds no perceivable latency. This is what makes
   "it remembers everything across the stack" literally true: nothing is ever dropped,
   everything is searchable.
2. **Curated brain** — the entity/wikilink notes the graph explorer visualizes (deals,
   people, companies, programs, numbers, decisions). Written **asynchronously and
   selectively** by the distiller (below). This is what keeps the brain high-signal instead
   of a transcript dump.

A venting text ("crashout") therefore is never lost — it sits in the raw log if ever
needed — but it never becomes a brain note polluting the graph.

## Hot path (respond) vs. cold path (ingest)

**Hot path — what the CEO feels.** Inbound message → append to raw log (sync, ~ms) →
triage (cheap model, **no tools** — the §6 injection guardrail) → agent loop answers using:

- the conversation thread itself (in context — so within a conversation the agent never
  needs ingestion to have run),
- retrieval over the **curated brain AND the recent raw log** in one query.

Because the raw log is written synchronously and retrieval covers it, cross-surface memory
is fresh even when distillation lags: text Silkroad about a new deal, open web chat ten
seconds later, and the deal is retrievable — from the raw log first, from a curated note
once the distiller catches up.

**Cold path — a separate worker process.** Every raw-log append enqueues a distillation
job (Postgres-backed queue — pg-boss/graphile-worker class, no new infra; the queue and
both stores live in the same Postgres). The worker is its own process in the client VPS's
Docker Compose, so responding and ingesting are parallel by construction and an ingestion
backlog can never slow a reply. Batches per conversation lull (not per message) to keep
token cost near zero on chatty threads.

## The ingestion gate (when to remember, when not to)

The distiller runs on a cheap model and decides one of four outcomes per candidate:

1. **Skip — ephemeral.** Venting, small talk, logistics with no durable content. Stays in
   raw log only.
2. **Skip — already known.** Embedding nearest-neighbor against existing brain notes; if
   the fact is covered and nothing new is added, at most bump a last-confirmed timestamp.
3. **Merge — update.** The fact updates an existing entity (deal stage change, revised
   number, new contact detail): edit that note, never create a near-duplicate node.
4. **Create — novel durable fact.** New entity or relationship: write a typed, wikilinked
   note so it lands in the graph.

Precedence: dedup (2) is checked by embedding similarity *before* spending model tokens on
classification. The gate's prompt is a skill in the private skills repo, so per-client
tuning ("this client's 'deals' live in HubSpot exports") compounds.

## Guardrails that bind this spec (from brief §6)

- **Memory-write approval** for month 1 per client: gate outcomes 3 and 4 land in an
  approval queue, not the brain. Outcomes 1–2 need no approval (they write nothing).
- **Inbound email is untrusted input**: the distiller, like triage, has **no tools** and
  treats message content as data. Instructions found inside content are flagged, never
  executed, and never written into the brain as fact.
- Raw log and brain are per-client Postgres on the client's VPS — no cross-client flow.

## Status — implemented v1 in the fork (August 13, 2026)

Amir called the build ("go ahead and implement"), and since Silkroad core does not exist
yet, v1 lives in this repo — a deliberate, recorded deviation from the section below. The
architecture is exactly the spec; the substrate differs:

- **Raw log + queue**: Mongo collection `brainlogs` (schema/model/methods in
  `packages/data-schemas`, `brainLog.*`) instead of Postgres — the fork already runs
  Mongo, and the queue semantics (atomic claim, quiet-window debounce, attempts cap,
  stale requeue) are substrate-independent. Enqueue is a `saveMessage` wrapper in
  `api/models/index.js` (fire-and-forget append; candidate filter in
  `packages/api/src/brain/candidate.ts` drops temporary/errored/unfinished/empty).
- **Distiller**: separate process — `npm run brain:worker` (`config/brain-worker.js`,
  also `BRAIN_WORKER_ONCE=true` for one-shot/cron). Gate + worker in
  `packages/api/src/brain/{gate,worker}.ts`. Triage runs on `BRAIN_TRIAGE_MODEL`
  (default `gpt-5.4-nano`), distill on `BRAIN_DISTILL_MODEL` (default `gpt-5.5` — nano
  proved too weak to keep all facts). Both have **no tools** and treat content as data.
- **Dedup deviation**: skip-known is judged by the distill model reading the related
  notes' full content (fine at 26-note scale) instead of embedding nearest-neighbor;
  pgvector dedup returns when the brain moves to Silkroad core.
- **Scope deviation**: only *inbound* (user) messages are distilled; outbound agent
  replies land in the raw log but are not mined for facts (they restate known data).
  Chat is the only live surface until email/iMessage channels exist.
- **Approval guardrail**: `BRAIN_WRITE_APPROVAL` env, default **on** — merge/create park
  as `awaiting_approval`; `/api/brain/approvals` (+ `/:id/approve`, `/:id/reject`) and
  `/api/brain/ingest/stats` are live. Follow-up: surface these in the dashboard's
  Actions/approvals panel. `off` auto-applies (dogfood mode).
- Verified end-to-end Aug 13: chat message about a $250k Vannevar Labs pilot → complete
  wikilinked vault note; a venting message → `skipped (ephemeral)`, raw log only.
- **Aug 30 update ([`channels.md`](./channels.md))**: iMessage and email now feed the same
  raw log. The scope deviation above is narrowed: `direction` now means human-authored
  (`inbound`, incl. the owner's own sent texts/mail) vs agent-authored (`outbound`), so
  everything a human wrote is distilled. The gate takes a source header (surface, author,
  subject), triage also returns `actionItems` (written as to-dos, approval-gated) and
  `injection` (parked as `flagged`, never distilled), and bulk mail/SMS is logged
  pre-resolved as `bulk` without a model call. A `ChannelState` pause flag halts the worker
  and every responder.

## What this spec originally assumed (kept for the Track A migration)

Original plan: implement in **Silkroad core** (Track A) on Postgres + pgvector. When core
exists, the fork's brain API switches from the static vault to core's curated-brain
endpoint, the raw log moves to Postgres, and embedding dedup replaces model-judged dedup;
the graph explorer UI is unchanged. The demo vault remains the sales/demo artifact and
the reference for note format (frontmatter type + wikilinks).

## Open questions (append answers here, dated)

- Raw-log retention: keep forever vs. summarize-then-archive after N months (storage is
  cheap; privacy expectations may decide instead).
- Whether outcome-4 notes should auto-link into the to-do stack when they imply an action
  (e.g. a new deal implies a follow-up) — leaning yes, but it widens the write surface
  during the approval-gated month.
