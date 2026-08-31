# Silkroad — One Brain, One Agent, Guardrails as Code

**Created: August 30, 2026. Status: BUILT August 30, 2026 — see the Status section at the end.** Follows
[`channels.md`](./channels.md). Three workstreams, in the order they should be built:

1. **One brain** — a single retrieval service (embeddings over vault notes *and* the recent
   raw log) consumed by Brain Search, the channel responder, and the distiller's dedup step.
2. **One agent** — the iMessage/email responder answers through the same model spec as
   web chat, via a gateway endpoint on the API server, and every exchange is persisted as a
   real conversation visible in the web UI.
3. **Guardrails as code** — audit trail on the hash-chained `AuditLog`, allowlisted draft
   domains, monthly token alert at N× expected, per-task turn budgets and timeouts.

Guardrails from [`brief.md`](./brief.md) §6 bind every decision. Where a choice was not
obvious the recommendation is stated and the alternative recorded; decisions that need
Amir's call are collected at the end.

---

## 0. What the code survey established (Aug 30)

- **No embeddings exist anywhere in the fork.** `RAG_API_URL`, `EMBEDDINGS_*`, `MEILI_*`
  are all unset; pgvector only appears in unused compose stacks (`rag.yml` port 5433,
  `search/` PoC port 5435). Local Mongo is community `mongod` (`mongodb://127.0.0.1:27017/hermes`),
  so Atlas `$vectorSearch` is off the table. No cosine helper exists.
- The three specs are plain `openAI` presets (`librechat.yaml:60-155`), no `agent_id`.
  Spec-level tool flags (`fileSearch`, `webSearch`, …) are honoured by
  `packages/api/src/agents/load.ts:68-91` (`loadEphemeralAgent`) and mirrored in
  `added.ts:199-214`, `client/src/utils/endpoints.ts:349`, and
  `client/src/hooks/Agents/useApplyModelSpecAgents.ts:102`. Tools are instantiated in the
  dispatch loop at `api/app/clients/tools/util/handleTools.js:331` (`file_search` at 359 is
  the template) with JSON schemas in `packages/api/src/tools/registry/definitions.ts`.
- Brain Search grounding is the `silkroad-brain` `promptPrefix` — a hardcoded list of the
  26 note titles plus "core facts". `channels/answer.ts:54` is token-overlap over note
  metadata; the distiller picks "related" notes by asking `gpt-5.4-nano` to choose titles
  from a flat index (`gate.ts`, `MAX_RELATED = 3`). Three retrieval paths, none searching
  the raw log.
- `vault.ts` re-reads every `.md` file on every `loadVault` call; no cache, no watcher.
- The run primitive `createRun(...)` + `run.processStream()` (`packages/api/src/agents/run.ts:1167`)
  is Express-free; `loadEphemeralAgent` takes a duck-typed `{ user, config, body }`;
  `initializeAgent` (`initialize.ts:579`) reads only `req.user`/`req.config`. The resumable
  controller already runs with a **stubbed `res`** (`request.js:1334`). Precedent for a
  synthetic request: `packages/api/src/files/sweep.ts:151`.
- A conversation written server-side appears in the sidebar if `saveConvo` gets
  `{ conversationId (UUID), user, title, endpoint, model, spec, iconURL }`
  (`conversation.ts:711` projection). `saveMessage` requires a UUID `conversationId`
  (`message.ts:10`) — **verify whether the regex is v4-only before choosing v5 ids.**
- Auth for trusted callers: `generateToken(user)` JWT (`user.ts:378`) or `sk-` agent API
  keys (`packages/api/src/apiKeys/middleware.ts:38`, tied to the `remoteAgents` permission
  and an agent-VIEW check on `body.model`). No service-account concept exists.
- Turn budgets: `resolveRecursionLimit` (`packages/api/src/agents/config.ts:20`) — YAML
  `endpoints.agents.recursionLimit` → default **50** → per-agent `recursion_limit` →
  clamp to `maxRecursionLimit`. This fork has **no `endpoints.agents` block**, so web chat
  runs at 50 with no cap. No per-run timeout exists anywhere. The plain `recursionLimit`
  property on the run config (`client.js:3133`, `openai.js:789`) is the enforcement point.
- **Transactions are written even with balance off** (`transaction.ts:356` saves before the
  `balance.enabled` check; `transactions.enabled` defaults true). The `transactions`
  collection is therefore already a complete spend ledger — but it has no `createdAt`
  index and no aggregate query exists. `tokenValue` = credits = USD × 1e6.
- `AuditLog`: append-only, hash-chained, `recordAuditEntry(input)` at
  `methods/auditLog.ts:320`; **only two actions exist** (`grant.assigned`, `grant.removed`
  in `types/admin.ts:68`), added by editing `AUDIT_ACTIONS` and the exhaustive
  `AUDIT_ACTION_CATEGORY` map. Categories already include `approval`, `agent_run`,
  `tool_call`. Actor types include `agent`, `system`, `schedule`. Metadata is flat
  primitives only. Read API exists (`/api/admin/audit-log`, ADMIN + `READ_AUDIT_LOG`);
  **no client UI**.
- Notifications: the `Banner` is a global singleton with no per-user targeting and no create
  method; no server-driven toast; `sendEmail` exists (handlebars templates, SMTP/Mailgun).
- Outbound email: `sendReply` is owner-guarded; **`createDraft` has no recipient check and
  zero callers**; `sendDraft` trusts the draft. `POST /api/approvals` accepts an
  unvalidated caller-supplied `payload`. Approval decisions and kill-switch flips are not
  audited.
- No cron library; every background loop is `setInterval` (`startBrainWorker`,
  `startGmailPoller`). `LeaderElection.ts` exists if a loop must be single-instance.

---

## 1. One brain — the retrieval service

### 1.1 Decisions

- **Embeddings**: OpenAI `text-embedding-3-small` (1536-d, ~$0.02/M tokens — the whole
  vault plus a year of raw log is cents). Added next to `createBrainChat` as
  `createBrainEmbed` in `packages/api/src/brain/openai.ts`; injected like the chat fn so
  tests use a deterministic fake.
- **Store**: a new Mongo collection `brainvectors`, not fields on `BrainLog` or note files.
  One document per embedded unit: `{ user, kind: 'note' | 'log', refId (noteId or
  brainLog _id), surface?, hash (sha256 of embedded text), model, dims, vector: Buffer
  (float32, 6 KB), text: string (the chunk that was embedded, ≤ 2k chars), createdAt,
  tenantId }`. Indexes `{ user, kind, refId }` unique, `{ user, kind, createdAt }`. Storing
  the chunk text means search results need no second lookup.
- **Similarity**: in-process cosine over a per-process cache (`Float32Array`), loaded once
  per user and refreshed incrementally by `createdAt` cursor. Bound the log side to a
  window (`BRAIN_RETRIEVAL_LOG_DAYS`, default 90) so memory stays at tens of MB
  (5k entries ≈ 30 MB). This is deliberately the simplest thing that is correct at pilot
  scale; the `BrainRetriever` interface (below) is the seam where pgvector (already
  provisioned in `search/` on port 5435) replaces it without touching consumers.
- **Chunking**: notes are embedded whole when ≤ 1,500 tokens, otherwise per `##` section
  (the `vault.ts` heading parser already splits these) with the title prefixed to every
  chunk. Raw-log entries are embedded whole (they are short); bulk and outbound entries
  are never embedded.
- **Hybrid scoring**: cosine plus a small lexical bonus for exact title/`sender` matches
  (the current `tokenize` helper), because names like "Henderson" or "$61B" are what
  executives ask about and pure embedding similarity is weak on rare proper nouns. One
  scorer, tested against a fixture set.

### 1.2 Module layout (`packages/api/src/brain/retrieval/`)

```
retrieval/
  embed.ts       createBrainEmbed(): batched /embeddings call, retries, token-length guard
  store.ts       BrainVectorStore over the Mongo model: upsert(unit), listSince(user, kind, cursor), deleteByRef
  cache.ts       per-user Float32 matrix + ids; loadOrRefresh(user), cosineTopK(queryVec, k, filter)
  chunk.ts       noteChunks(note) / logChunk(entry) — pure, tested with fixtures
  index.ts       BrainRetriever interface + createBrainRetriever(deps)
```

```ts
interface BrainRetriever {
  search(user: string, query: string, opts: { k?: number; sources?: Array<'note' | 'log'>; sinceDays?: number }): Promise<BrainHit[]>;
  indexNote(user: string, note: BrainNote): Promise<void>;          // upsert all chunks, delete stale ones by hash
  indexLog(user: string, entry: BrainLogLean): Promise<void>;
  syncVault(user: string, vaultPath: string): Promise<{ indexed: number; unchanged: number }>;
  syncLog(user: string, opts: { limit: number }): Promise<number>;   // embed pending inbound, non-bulk entries
}
interface BrainHit { kind: 'note' | 'log'; refId: string; title: string; text: string; score: number; surface?: string; sender?: string; createdAt?: Date }
```

`data-schemas` additions: `schema/brainVector.ts`, `models/brainVector.ts`,
`methods/brainVector.ts` (`upsertBrainVector`, `listBrainVectorsSince`,
`deleteBrainVectorsByRef`), plus a `listBrainLogsForEmbedding(user, { limit, sinceDays })`
method (inbound, not bulk, no vector yet — tracked by an `embeddedAt` timestamp added to
`BrainLog` so the query is an index range, not a join).

### 1.3 Keeping the index fresh without touching the hot path

- **Notes**: `writeBrainNote` gains an optional post-write hook; the worker and the brain
  approve route call `retriever.indexNote` after a successful write. `syncVault` runs at
  worker start and whenever the vault directory mtime changes (cheap stat per tick) so
  Obsidian edits are picked up too.
- **Raw log**: the connectors and the `saveMessage` wrapper stay dumb appends (no network
  call on the hot path — the ingestion spec's rule). Freshness comes from two places:
  `syncLog` at the top of every worker tick (15 s cadence), and **lazy catch-up at query
  time**: `search()` first embeds any un-embedded inbound entries newer than the cache
  cursor, capped at 50. Net effect: "text it, ask web chat ten seconds later" works even if
  the worker is down.
- `vault.ts` gets a memoised index keyed on directory mtime (also fixes the every-request
  re-read on `GET /api/brain/graph`).

### 1.4 Consumers

**(a) Brain Search and Chat — a `brain_search` tool.** Mirror `file_search` exactly:

1. `packages/data-provider`: `Tools.brain_search` enum value; `brainSearch?: boolean` on
   `tModelSpecSchema` (`models.ts` ~92); `AgentCapabilities.brain_search` added to
   `defaultAgentCapabilities` (`config.ts:761`).
2. `packages/api/src/tools/registry/definitions.ts`: `brainSearchSchema`
   `{ query: string; scope?: 'brain' | 'recent' | 'all' }`.
3. `packages/api/src/agents/load.ts` + `added.ts`: push `Tools.brain_search` when
   `modelSpec?.brainSearch === true`; mirror the flag in the two client files listed in §0
   so the UI knows the ephemeral agent has the tool.
4. `api/app/clients/tools/util/brainSearch.js` (thin JS) → `createBrainSearchTool({ userId, retriever })`
   returning a LangChain `tool()` with `responseFormat: 'content_and_artifact'`, formatted
   like file search results: numbered hits with `[[Note Title]]` for notes and
   `(iMessage from +1…, Aug 28)` provenance for log hits. Dispatch branch in
   `handleTools.js` next to `file_search`. The retriever instance lives on
   `app.locals` (built once at startup in `api/server/index.js`).
5. `librechat.yaml`: `silkroad-brain` and `silkroad` get `brainSearch: true`. The
   `silkroad-brain` `promptPrefix` loses the hardcoded note list and core facts and keeps
   only the protocol ("search the brain before answering; cite `[[Note]]`; if nothing
   matches, say so and name the closest notes"). Chat mode keeps its persona and is told
   to search when a question is about the company, people, deals, or numbers. (Recommended:
   both modes get the tool — "one brain" means Chat is brain-aware too; Brain Search stays
   the strict, citations-only mode.)

Alternative considered: making `silkroad-brain` a real seeded Agent with `tools:
['brain_search']`. Rejected for now because the mode selector, `modelSpecs.enforce`, and
`interface.agents.use: false` all assume presets; the spec-flag route is four small,
already-patterned touch points.

**(b) Channel responder.** Once workstream 2 lands, the responder *is* the `silkroad` spec
and gets the tool for free. Until then `channels/answer.ts` `relevantNotes` is replaced by
`retriever.search(user, question, { k: 5 })` — a one-line swap that also removes the
per-question `loadVault`.

**(c) Distiller dedup.** In `worker.ts distillEntry`, before triage:
`hits = retriever.search(user, entry.text, { k: 5 })`. Then:
- if the best **log** hit is an already-`applied`/`known` entry from the same user with
  score ≥ `BRAIN_DEDUP_THRESHOLD` (0.95 default) → resolve `skipped/known` with zero model
  calls (spec precedence: dedup before tokens);
- otherwise the top-3 **note** hits become `related` for distill, replacing the triage
  model's title guess (triage keeps verdict/actionItems/injection; its `related` field is
  ignored and later removed from the prompt).
Log the hit scores in `reason` so approvals show *why* something was judged known.

### 1.5 Tests

Fake embedder = deterministic hash-to-vector (so "Henderson invoice" and "Henderson
invoice overdue" land close, unrelated text far). `cache.spec` (top-k, incremental
refresh, window), `chunk.spec` (fixtures incl. a long note split by `##`), `store.spec`
on mongodb-memory-server (upsert by hash, stale-chunk deletion), `retrieval.spec` end to
end with a temp vault + seeded brain logs, `worker.spec` additions (dedup-by-log skip,
related-from-retriever), tool spec (`brainSearch.js` output format), and an opt-in
`retrieval.manual.spec.ts` that hits the real embeddings API with a dozen fixture
questions (already ignored by Jest config; run by hand with a key).

### 1.6 Migration to Silkroad core

`BrainRetriever` is the contract. When core exists, `createBrainRetriever` is swapped for
an HTTP client to core's retrieval endpoint (pgvector), and `brainvectors` is dropped.
Nothing in tools, worker, or gateway changes.

---

## 2. One agent — the channel gateway

### 2.1 Decision: a gateway endpoint on the API server, not an in-process run

Three options were weighed:

| Option | Verdict |
|---|---|
| **A. HTTP to the existing remote-agents surface** (`POST /api/agents/v1/chat/completions` with an `sk-` key) | Closest to "already supported", but it is stateless (nothing persisted), requires enabling `remoteAgents` and a real Agent (specs are presets), and the responses-API store path has a live bug (`responses.js:186` passes `req` as ctx). |
| **B. Headless run inside the connector process** (`loadEphemeralAgent` → `initializeAgent` → `createRun`) | Works, but drags app config, tool loading, MCP, and model keys into the connector — the process that will later run on a Mac mini with the least trust. |
| **C. New internal endpoint `POST /api/channels/answer` on the API server** that runs the spec headlessly where config, tools, and keys already live, persists the exchange, and returns plain text | **Recommended.** It is the shape the roadmap wants anyway (the fork's API plays "Silkroad core gateway" until core exists), and the connectors end up holding **no model keys at all**. |

### 2.2 Contract

```
POST /api/channels/answer          Authorization: Bearer <SILKROAD_SERVICE_TOKEN>
{ surface: 'imessage' | 'email', externalThreadId, question, sender, subject?, format: 'plain' | 'markdown' }
→ 200 { text, conversationId, messageId, usage: { promptTokens, completionTokens }, truncated: boolean }
→ 423 { error: 'paused' }          when ChannelState.paused (defence in depth — connectors also check)
→ 429 { error: 'budget' }          when the guardrail monitor has hard-paused (workstream 3)
```

Auth: `requireServiceToken` middleware — constant-time compare against
`SILKROAD_SERVICE_TOKEN` (32-byte random, generated by a `npm run channels:token` helper
and pasted into both `.env` files), then `req.user` = the owner resolved from
`SILKROAD_USER_EMAIL` (cached). Alternative: an `sk-` agent API key — rejected because it
binds to `remoteAgents` permissions and an agent-VIEW check on `body.model`, neither of
which fits a spec preset. The token is per-instance, per-client; rotating it is editing
two env files.

### 2.3 Implementation

- `api/server/routes/channels.js` (thin) → `packages/api/src/channels/gateway.ts`
  `answerViaSpec(deps, request)`:
  1. **Thread → conversation mapping.** New `ChannelThread` model
     `{ user, surface, externalThreadId, conversationId, lastMessageId, title }` (unique
     on `user+surface+externalThreadId`). First message in a thread creates a fresh UUID
     v4 conversation (satisfies the `saveMessage` UUID guard whatever its strictness);
     later messages continue it by passing `parentMessageId = lastMessageId`, so the
     agent gets the full thread as history from the message chain — this also replaces
     the Gmail connector's in-memory `ThreadMemory`.
  2. **Synthetic request** built like `createExpiredFileSweepRequest`: `{ user: owner,
     config: appConfig, body: { spec: 'silkroad', endpoint: 'openAI', model, promptPrefix,
     text, conversationId, parentMessageId, messageId }, _resumableStreamId }`, and the
     same stubbed `res` the resumable controller already uses.
  3. **Run** through the same path as web chat: `buildEndpointOption`-equivalent
     (`applyModelSpecPreset` from the spec in `req.config.modelSpecs.list`) →
     `initializeClient` → `client.sendMessage` with `progressOptions.res` stubbed, collecting
     the final text from the completion callback rather than SSE. Run config carries
     `recursionLimit = SILKROAD_CHANNEL_TURN_BUDGET` (default 12) and an
     `AbortController` armed with `SILKROAD_CHANNEL_TIMEOUT_MS` (default 90 s) — this is
     where workstream 3(d) lands for channels. **Verify-first item:** confirm
     `initializeClient` + `sendMessage` complete with the stubbed `res` when
     `_resumableStreamId` is unset; if not, follow `openai.js executeOpenAIChatCompletion`
     (envelope → `initializeAgent` → `createRun` → `processStream`) which is proven headless,
     and persist manually.
  4. **Persist** via `methods.saveMessage` / `saveConvo` from data-schemas **directly, not
     the `~/models` wrapper** — the connector already logged the iMessage/email to the raw
     log with the right surface and sender; going through the wrapper would create a
     duplicate `chat`-surface entry. Conversation fields: `endpoint: 'openAI'`, `model`,
     `spec: 'silkroad'`, `title` = `"iMessage · <first 40 chars>"` (or the email subject),
     `iconURL` = the spec icon. It then appears in the sidebar like any chat — the demo
     line is "text it on the train, finish the thread at your desk".
  5. **Format**: `format: 'plain'` strips markdown (bold, headings, links → text, lists →
     `-`) for iMessage; email keeps light markdown converted to text the same way (the
     Gmail client already sends `text/plain`).
  6. Usage from the run is recorded by the normal `spendTokens` path with
     `context: 'channel'` so the budget monitor can attribute it.
- **Connectors** (`imessage/poll.ts`, `gmail/poll.ts`): `respond()` calls a `GatewayClient`
  (`fetch` with the token) instead of `answerQuestion`; the kill-switch command handling
  stays local. `channels/answer.ts` is deleted once both are switched.
  `config/channel-*.js` lose `OPENAI_API_KEY`/`BRAIN_ANSWER_MODEL`/`BRAIN_VAULT_PATH` and
  gain `SILKROAD_API_URL` + `SILKROAD_SERVICE_TOKEN`.
- **Chat visibility**: a `ConversationTag` "iMessage"/"Email" (bookmarks are an existing
  feature, currently hidden by `interface.bookmarks: false`) is optional polish; the title
  prefix is enough for v1.

### 2.4 Tests

`gateway.spec` with a fake `runSpec` (asserts thread mapping, parentMessageId chaining,
persistence fields, plain formatting, paused → 423, budget → 429); route spec for the
token middleware (missing/wrong/right, timing-safe); connector specs updated to a fake
`GatewayClient`; one manual spec that runs the real spec end to end against local Mongo.

---

## 3. Guardrails as code

### 3.1 Audit trail (brief §6 "every outbound action and approval is logged")

Extend `AUDIT_ACTIONS` / `AUDIT_ACTION_CATEGORY` (`types/admin.ts:68-75`) and
`AUDIT_CATEGORIES` with two new categories, `channel` and `guardrail`:

| Action | Category | Actor | Target | Metadata (flat) |
|---|---|---|---|---|
| `approval.created` / `approval.approved` / `approval.denied` / `approval.reopened` | `approval` (exists) | `user` (owner) or `agent` (creator) | `approval:<id>` | `kind`, `recipientDomain`, `hasDraft` |
| `channel.paused` / `channel.resumed` | `channel` | `user` | `channels:<user>` | `via` |
| `channel.reply_sent` | `channel` | `agent` "silkroad" | `<surface>:<thread>` | `surface`, `conversationId`, `promptTokens`, `completionTokens`, `truncated` |
| `channel.draft_created` / `channel.draft_sent` / `channel.draft_deleted` / `channel.draft_blocked` | `channel` | `agent` / `user` | `draft:<id>` | `recipientDomain`, `approvalId`, `reason` |
| `brain.write_applied` / `brain.write_rejected` | `config`? → new `brain` category | `user` | `note:<id>` | `outcome`, `brainLogId` |
| `guardrail.budget_alert` / `guardrail.budget_pause` | `guardrail` | `system` | `budget:<yyyy-mm>` | `spendUsd`, `expectedUsd`, `multiple` |

Rules: never store message text, addresses, or prompts in metadata — domains, ids, counts
only (the schema comment at `auditLog.ts:84` says the same). Write sites: the approvals
route, the brain approve/reject route, `handlePauseCommand` (gets an injected `audit`
dep), the gateway (reply sent), and a `MailerWithAudit` wrapper around the Gmail client's
draft methods. Connectors reach `recordAuditEntry` through `createMethods` today; when the
ingest endpoint arrives (channels.md, D1) the writes move server-side automatically.
Fail-open (the default) everywhere except `channel.draft_sent`, which uses
`failClosed: true` — if we cannot record that mail left, mail does not leave.

Reading it: the admin API exists but needs `ADMIN` + `READ_AUDIT_LOG`. Add a narrow
owner-scoped `GET /api/guardrails/activity` (last 50 `channel`/`approval`/`guardrail`
entries for `req.user`) and an "Activity" list under the Actions panel. This is the
executive-facing proof that the guardrails are real; it is also the cheapest UI in this
plan because the rows are already structured.

### 3.2 Allowlisted draft domains

- `SILKROAD_DRAFT_DOMAINS` — comma-separated; empty means "owner's own domain only". A
  pure `policy.ts` in `channels/`: `assertRecipientsAllowed(policy, { to, cc })` throwing
  `RecipientNotAllowedError`, with subdomain matching and the owner's address always
  allowed.
- Enforced in three layers: (1) `createDraft` in `gmail/client.ts` (the current gap);
  (2) `POST /api/approvals` when `kind === 'email'` — the route stops accepting a raw
  caller-supplied `payload` and instead validates `to/cc/subject/body` and, for drafts,
  calls a new `draftEmailForApproval()` service that creates the Gmail draft *and* the
  approval together (so `draftId` can never be forged from the client); (3)
  `applyDraftDecision` re-reads the draft's recipients before `sendDraft` (defence in
  depth against a draft edited in Gmail's UI after approval was requested). Blocked
  attempts produce `channel.draft_blocked` audit entries and an `Approval` of kind
  `email` with `status: 'denied'` and a description explaining the block, so the owner
  sees what the agent tried to do.
- The seeded demo approvals (`config/seed-approvals.js`) have no `draftId`, so they are
  unaffected; the seed gets updated to use allowlisted example domains anyway.

### 3.3 Monthly token alert at N× expected

- **Ledger**: already there. Add index `{ user: 1, createdAt: -1 }` to `transaction.ts`
  and a `sumTransactionValueSince(user, since)` aggregate method (`$match` user +
  `createdAt`, `$group` `$sum: { $abs: '$tokenValue' }`, also grouped by `context` so
  the dashboard can split chat / channel / distiller / subagent spend). Credits ÷ 1e6 = USD.
- **Config**: `SILKROAD_MONTHLY_EXPECTED_USD` (the brief's modeled $24–153/client/month —
  set per client), `SILKROAD_BUDGET_ALERT_MULTIPLES` (default `1,2,3`),
  `SILKROAD_BUDGET_HARD_PAUSE` (default **off**; when `on`, crossing the last multiple
  sets `ChannelState.paused` with `pausedVia: 'budget'` — the brief asks for an *alert*,
  so pausing is opt-in).
- **Monitor**: `packages/api/src/guardrails/budget.ts` — `checkBudget(deps, user, now)`
  pure over injected `sumSince`; state in a new `GuardrailState` doc `{ user, month,
  alertedMultiples: number[] }` so each threshold fires once per month. Runs as a tick in
  the brain worker process (`startBudgetMonitor`, hourly, same `setInterval` shape) —
  no new process. Writes `guardrail.budget_alert` to the audit log.
- **Delivery**: the worker cannot send iMessage, so introduce the primitive the morning
  brief (roadmap A4) needs anyway: a `ChannelNotice` collection `{ user, text, createdAt,
  deliveredAt?, deliveredVia? }`. Connectors poll it each tick and deliver pending notices
  to the owner (self-chat / owner email) — through the same owner-only send guards. The
  dashboard shows the current month's spend vs expected as a stat tile fed by
  `GET /api/guardrails/status` (`{ spendUsd, expectedUsd, multiple, paused, pausedVia }`).
  No global `Banner` (it is a singleton with no per-user targeting).

### 3.4 Per-task turn budgets and timeouts

- `librechat.yaml`: add `endpoints.agents: { recursionLimit: 25, maxRecursionLimit: 40 }`
  so web chat no longer runs at the unbounded default of 50 with no cap; subagent turns
  derive as ⌊limit/3⌋ automatically. Deep Research may need more — set
  `recursion_limit` on the seeded specialist agents explicitly rather than raising the
  global cap.
- Channel answers: `recursionLimit` 12 and a 90 s abort (gateway, §2.3). Distiller: the
  gate is tool-less single calls, so its budget is `maxAttempts` (exists) plus a per-call
  timeout on `createBrainChat` (`AbortSignal.timeout`, 60 s) — today a hung model call
  hangs the worker tick.
- Record `truncated: true` in the audit entry when a budget or timeout cut a run, so
  "the agent stopped early" is visible rather than silent.

### 3.5 Read-only scopes and kill switch — already code

Gmail is `readonly + compose`; iMessage sends are owner-only; pause exists. No work here
beyond the audit entries above and moving the pause check into the gateway (§2.2).

---

## 4. Build order, sizing, and dependencies

| Phase | Scope | Depends on | Size |
|---|---|---|---|
| **A** | Retrieval core: `brainvectors` schema/methods, `embed/store/cache/chunk`, `BrainRetriever`, vault memoisation, `embeddedAt` on BrainLog, worker `syncLog`/`syncVault` ticks, tests | — | 1 session |
| **B** | Consumers: `brain_search` tool + spec flag + yaml prompt rewrite; distiller dedup-by-retrieval; responder swap (interim) | A | 1 session |
| **C** | Gateway: service token, `ChannelThread`, `answerViaSpec`, persistence, plain formatting, connectors switched, `answer.ts` removed, turn budget + timeout | B (for brain access in replies; C can start in parallel with B on the run path) | 1–2 sessions (the run-path verify-first item is the risk) |
| **D** | Guardrails: audit actions + write sites + activity endpoint/UI; draft-domain policy + `draftEmailForApproval`; budget ledger/monitor/notices/status tile; yaml recursion caps; distiller call timeout | C for the gateway audit/`context: 'channel'`; otherwise independent | 1–2 sessions |
| **E** | Docs: Status sections here, `channels.md`, `ingestion.md`, roadmap A2/A5, `.env.example`, CLAUDE.md product line | all | small |

Parallelisable: A and the D sub-items that do not touch the gateway (audit constants +
approvals-route audit, domain policy, budget aggregate/monitor) can run concurrently as
separate agents; B and C touch the same connector files as each other only at the
`respond()` seam, so B should land first.

New env (all documented in `.env.example` under a "Silkroad Core-in-fork" block):
`BRAIN_EMBED_MODEL`, `BRAIN_RETRIEVAL_LOG_DAYS`, `BRAIN_DEDUP_THRESHOLD`,
`SILKROAD_SERVICE_TOKEN`, `SILKROAD_API_URL`, `SILKROAD_CHANNEL_TURN_BUDGET`,
`SILKROAD_CHANNEL_TIMEOUT_MS`, `SILKROAD_DRAFT_DOMAINS`, `SILKROAD_MONTHLY_EXPECTED_USD`,
`SILKROAD_BUDGET_ALERT_MULTIPLES`, `SILKROAD_BUDGET_HARD_PAUSE`.

---

## 5. Risks and verify-first items

- **Headless run path** (§2.3 step 3): the stubbed-`res` behaviour of `initializeClient` +
  `sendMessage` outside the job manager is inferred from the resumable controller, not
  proven. First task of phase C is a 30-minute spike proving one headless turn end to end;
  fall back to the `openai.js` envelope path if it fails.
- **UUID guard** in `saveMessage` — v4-only or any UUID decides whether thread ids can be
  deterministic (v5) or need the `ChannelThread` mapping. The plan assumes the mapping
  (needed anyway for `lastMessageId`).
- **Memory of the in-process vector cache** on the API server: bounded by the log window;
  add `BRAIN_RETRIEVAL_MAX_VECTORS` (default 20k) as a hard cap with oldest-eviction.
- **Prompt regression** when the `silkroad-brain` prefix drops its hardcoded facts: the
  manual retrieval spec doubles as the acceptance test (same dozen questions the demo
  uses).
- **Audit category enum change** touches a Mongoose enum on an append-only collection —
  additive, safe; old entries validate unchanged.
- **Budget attribution** relies on `context: 'channel'` flowing through `spendTokens`
  from the gateway run; if the client path overwrites `context`, fall back to
  `conversationId ∈ ChannelThread` at aggregate time.

---

## 6. Decisions for Amir before phase A starts

**Answered Aug 30, 2026 — all six confirmed:** (1) Chat mode gets `brain_search` too;
(2) channel threads appear in the web sidebar; (3) `SILKROAD_MONTHLY_EXPECTED_USD=50`,
hard-pause **off**; (4) draft allowlist **empty** — and because the owner address is on a
public mailbox provider, "own domain" is not derived: the default is *owner's own address
only*, never the whole of gmail.com; (5) service token; (6) OpenAI `text-embedding-3-small`
with the existing key. Build has not started; awaiting the go.

1. **Chat mode gets `brain_search` too** (recommended) or only Brain Search mode?
2. **Channel conversations visible in the web sidebar** (recommended; titled
   "iMessage · …" / email subject) or kept out of the UI?
3. **Expected monthly spend** for the dogfood instance (`SILKROAD_MONTHLY_EXPECTED_USD`) —
   $50 is a reasonable first guess given current usage; and whether crossing 3× should
   **hard-pause** (default off).
4. **Draft-domain allowlist** for dogfood — which domains may the agent draft to?
5. Service token (recommended) vs `sk-` agent API key for the gateway.
6. Embeddings via OpenAI `text-embedding-3-small` (recommended, uses the existing key) —
   or keep the brain fully key-free until core (would mean lexical-only, which is what
   we have).

---

## Status — built in the fork (August 30, 2026)

All three workstreams landed the same day the plan was written. Deviations from the plan
above are called out; everything else is as specified.

**One brain.** `packages/api/src/brain/retrieval/` (`chunk`, `cache`, `embed` in
`brain/openai.ts`, `createBrainRetriever`) over the new `brainvectors` collection;
`BrainLog.embeddedAt` feeds `syncLog`. `vault.ts` is memoised on a directory stamp.
The worker dedups by retrieval before any model call, uses top-3 note hits as distill
context, re-indexes notes it writes, and syncs the vault/log every tick. The
`brain_search` tool (`api/app/clients/tools/util/brainSearch.js`, `Tools.brain_search`,
spec flag `brainSearch`) is on **both** `silkroad` and `silkroad-brain`; the Brain Search
prompt no longer hardcodes note titles or facts. Live Aug 30: 26 notes + 219 raw-log
entries embedded; "Fury production at Arsenal-1" → Arsenal-1 0.69, Fury 0.55.
*Follow-up:* `syncVault` does not yet remove vectors for notes deleted from the vault.

**One agent.** `POST /api/channels/answer` (`api/server/routes/channels.js`,
`packages/api/src/channels/gateway.ts`) loops back into the real chat pipeline
(`POST /api/agents/chat/openAI` + SSE until `final`) with a 5-minute owner JWT, maps each
external thread to one conversation (`ChannelThread`), and returns plain text. Connectors
use it when `SILKROAD_SERVICE_TOKEN` is set (`channels/remote.ts`), falling back to the old
local chat otherwise. Smoke-tested Aug 30 on a spare port: "Where is Fury being built?" →
13 s, grounded answer, `brain_search` tool call recorded on the agent message, conversation
visible under the `silkroad` spec, follow-up answered in 2 s from history,
`channel.reply_sent` audited. *Deviations:* (1) the loopback must present a browser-class
User-Agent (`uaParser` rejects others) and honour `HOST` (an IPv6-only `localhost` bind);
(2) `answer.ts` (local chat fallback) is kept, not deleted, so connectors still work
without the API server. The per-channel turn budget landed later the same day: the
request's `ephemeralAgent.recursion_limit` (new, clamped by `maxRecursionLimit`) is set
to `SILKROAD_CHANNEL_TURN_BUDGET` (default 12) by the gateway.

**Voice (Aug 30, later).** All three spec prompts now share one style block — answer
first, one to three sentences by default, lists only for list questions, no preamble or
closing offers, expand only when asked for detail/plan/report — and the Chat prompt's
hardcoded company facts were removed in favour of `brain_search`, the same way Brain
Search's were. Deep Research keeps its report shape but is capped to one screen.
`librechat.yaml` is now tracked in git (it holds no secrets), so these prompts and the
`endpoints.agents` caps are reproducible.

**Guardrails as code.** 15 new audit actions across `approval`, `channel`, `brain`,
`guardrail` categories, written from the approvals route, brain approve/reject, the
kill switch, drafts, and the gateway; `channel.draft_sent` is fail-closed.
`channels/policy.ts` enforces `SILKROAD_DRAFT_DOMAINS` in `createDraft`, in
`POST /api/approvals`, and again before `sendDraft`; `draftEmailForApproval` is the only
way to create a draft-backed approval. `guardrails/budget.ts` runs hourly inside the brain
worker, alerts through `ChannelNotice` rows the connectors deliver to the owner, and
hard-pauses only when `SILKROAD_BUDGET_HARD_PAUSE=on`. `GET /api/guardrails/status`
and `/activity` back a budget tile (replacing the sample "Emails handled" stat) and an
Activity list under the Actions panel. `librechat.yaml` caps agents at 25/40 turns;
the specialist subagents get `recursion_limit: 30`; the gate's model calls time out at
60 s. Live Aug 30: month-to-date spend $0.80 of $50 expected.

**Tests added:** data-schemas 6 specs (vectors, notices/threads/guardrail state, spend
rollup); `packages/api` retrieval ×3 + manual eval, worker, gateway, policy, drafts,
approval, budget, notices, connector gateway/notice paths, `load.spec`; api
`brainSearch.test.js`; client `BudgetTile`/`Activity`. Whole tree: tsc, ESLint, and
`circular-deps` clean.

**Finishing pass (Aug 30, evening).** Channel answers now run on a dedicated
`silkroad-channel` spec (same voice and brain, no subagent fan-out): 13 s → ~3 s per
answer in the smoke test. The API warms the retrieval index at boot. The proactive layer
landed (`packages/api/src/workflows/`: morning brief, weekly invoice chase, Intl-based daily
scheduler, read-only calendar), per-client deployment (`deploy/`, `npm run client:new`,
pm2 ecosystem, Mongo backup, heartbeats at `/api/health/silkroad`), and the trust-ramp UI
(memory approvals in the Actions panel, per-workflow Enabled/Auto-send with graduation
logged, audit CSV export, system health strip). Verified live: `npm run brief:now` produced
a correct brief; `npm run chase:now` found the overdue Henderson invoice and recorded a
draft-less approval (Gmail not configured on this machine).
