# Silkroad — Channels Spec (iMessage + email)

**Created: August 30, 2026.** Elaborates roadmap Track A3 (channels) on top of the brain
ingestion v1 that already runs in this fork ([`ingestion.md`](./ingestion.md) Status).
Goal from [`brief.md`](./brief.md): the CEO can text it or email it and it answers, and
everything on every surface lands in one brain. Guardrails from brief §6 bind every
decision below. Until Silkroad core exists (Track A), channels live in this repo — the same
recorded deviation as ingestion v1.

## Starting point

An untracked iMessage prototype already works on Amir's Mac (`config/ingest-imessage.js`,
`config/imessage-agent.js`, `config/ingest-lib.js`; state at `data/imessage-ingest-state.json`,
last seen ROWID 19654). It proves the hard parts: reading `~/Library/Messages/chat.db` with
the `sqlite3` CLI, decoding `attributedBody` typedstream blobs, detecting the self-chat as
"the agent chat", replying via `osascript`, and a `🧠` reply marker for loop prevention.

What is wrong with it as a foundation, and what this plan fixes:

| Prototype | Plan |
|---|---|
| Plain JS in `config/` with its own `strict: false` Mongo models | Logic in TypeScript under `packages/api/src/channels/`, models via `createMethods` from `@librechat/data-schemas`; `config/` keeps only thin runners (the `brain-worker.js` pattern) |
| Runs a `gpt-5.5` to-do extraction **inside the connector**, per message, synchronously | Connector is a dumb append. All model work (triage, to-dos, injection flag, distill) moves to the distiller worker — the cold path, exactly as the ingestion spec demands |
| Encodes provenance by prefixing `text` with `[iMessage received from X]` | Provenance is structured (`sender`, `subject` fields on `BrainLog`) and passed to the gate as context |
| Gate prompt hardcodes "surface: chat, from the user" | Gate receives `{surface, direction, sender, subject}`; third-party content is classified as *reported by X*, never as the owner's own statement |
| No kill switch | "pause everything" over iMessage or email sets a DB flag every connector and the worker honour |

## Shared model

**Direction semantics (redefined for multi-surface).** `direction: 'inbound'` = authored by
a human (the owner *or* a third party) and therefore a candidate for the brain;
`direction: 'outbound'` = authored by the agent (chat replies, iMessage answers, email
drafts). The worker keeps claiming only `inbound`. This makes the owner's own sent texts and
sent emails — the highest-signal facts the CEO states — distillable, while agent output
stays raw-log only. (`candidate.ts` already maps chat this way: user → inbound, assistant →
outbound.)

**`BrainLog` schema additions** (`packages/data-schemas/src/schema/brainLog.ts`):

- `sender?: string` — handle or `Name <email>`; `subject?: string` — email subject or chat
  name. Both optional; chat leaves them empty.
- `outcome` gains `'flagged'` (injection detected) and `'bulk'` (newsletter/notification
  mail skipped before triage).
- `appendBrainLog` gains an optional `resolution` so a connector can append an entry
  already resolved as `skipped/bulk` — logged forever, never sent to a model.

**Gate changes** (`packages/api/src/brain/gate.ts`):

- `triage(text, index, source)` where `source = {surface, direction, sender?, subject?}`
  renders a header block instead of the hardcoded "surface: chat". The system prompt gets
  one sentence: third-party messages are *claims by the sender*, not established facts.
- Triage output grows two fields, both cheap on the nano model since it already reads the
  message: `actionItems: string[]` (explicit, concrete tasks the owner must do — same rules
  as the prototype's `TODO_PROMPT`) and `injection: boolean` (instructions addressed to an
  AI/assistant inside the content).
- Distill is unchanged except it receives the same source header so notes can say
  "per J. Henderson (email, Aug 30)".

**Worker changes** (`packages/api/src/brain/worker.ts`):

- Before distilling: if `triage.injection`, resolve `skipped/flagged` with the reason,
  write nothing, extract no to-dos. Flagged entries appear in `/api/brain/ingest/stats`
  and the dashboard's Actions panel (the "flagged to a human" half of the §6 rule).
- After triage (any verdict): dedupe `actionItems` against open to-dos and write them with
  `createTodo`. This is a write surface, so it respects `BRAIN_WRITE_APPROVAL` the same way
  merge/create do — parked as `awaiting_approval` on the log entry (a new `todoItems`
  field), applied by the existing approve route. Dogfood runs with approval `off`.
- `BrainWorkerMethods` gains `getTodos`/`createTodo` (already in `createTodoMethods`).

**Kill switch.** New `channels.paused` document (tiny `ChannelState` model, or a key on the
existing `Config` model). Set when the owner texts/emails exactly "pause everything";
cleared with "resume". While set: connectors keep appending to the raw log (memory is not
the danger), but the responders send nothing and the worker writes nothing. Every flip is
logged to the existing `AuditLog`.

**Connector shape.** `packages/api/src/channels/`:

```
channels/
  ingest.ts      appendFromChannel(): messageId dedup, direction, source header → appendBrainLog
  pause.ts       isPaused()/setPaused(); detects the "pause everything"/"resume" commands
  answer.ts      answerQuestion(): owner-only Q&A over open to-dos + vault (ported responder)
  imessage/
    db.ts        sqlite3 CLI queries (new rows, thread history, own handles)
    decode.ts    attributedBody typedstream decode (+ fixtures)
    poll.ts      poll loop, state file, self-chat detection, reply via osascript
  gmail/
    client.ts    googleapis OAuth2 client, history sync, drafts.create, send (owner-only)
    parse.ts     MIME → text: text/plain first, HTML stripped, quoted history removed
    poll.ts      poll loop, state file (historyId), bulk pre-filter, self-email answering
```

Runners: `config/channel-imessage.js`, `config/channel-gmail.js`, `config/gmail-auth.js`
(one-time OAuth consent → refresh token). Scripts: `npm run channel:imessage`,
`npm run channel:gmail`. Each connector is its own process, like the worker — responding
and ingesting stay parallel by construction.

The prototype files are deleted once the port lands (they are untracked; nothing to revert).

## iMessage

**Transport for dogfood: keep `chat.db` polling on the Mac.** It is proven, dependency-free
(`/usr/bin/sqlite3`, `/usr/bin/osascript`), and needs only Full Disk Access for the
terminal plus Messages signed in. Roadmap decision **D1** (Photon Spectrum vs BlueBubbles
on a Mac mini vs hosted relay) is *not* forced by this work: `imessage/db.ts` is the only
transport-specific module, and a BlueBubbles webhook source would replace it behind the
same `poll.ts` interface. When the connector runs on a Mac mini and the brain on a client
VPS, it stops talking to Mongo directly and POSTs to a token-authenticated
`POST /api/channels/ingest` — that endpoint is added when D1 is resolved, not now.

**Ingestion.** Poll every `IMESSAGE_POLL_MS` (default 15s) for `ROWID > lastRowId`,
`associated_message_type = 0` (skips tapbacks). Per row: `messageId = imessage-<guid>`,
`conversationId = chat guid`, `sender` = handle or chat name, `direction` = `outbound` only
when the text starts with the `🧠` marker, otherwise `inbound` (both received texts and
the owner's own sent texts). Text is the row's `text` or the decoded `attributedBody`.
First run starts at *now*; `INGEST_BACKFILL=N` pulls the last N rows once. Group chats are
ingested like any other chat; the chat name becomes `subject`.

**Answering ("text it and it answers").** The agent chat is the owner's self-conversation
(Messages "Note to Self": the chat identifier equals one of the account's own handles;
`SILKROAD_AGENT_HANDLES` adds more). A new inbound row in that chat that is not the agent's
own reply → `answerQuestion` with the last 8 turns of the thread → `sendMessage`. Two
guardrails as code, both already in the prototype and kept: replies always carry the `🧠`
marker (loop prevention), and `sendMessage` refuses any handle outside the owner's own set
— the iMessage connector can never message a third party. Answering the owner in their own
chat is the same trust level as web chat and needs no approval. Later, when Silkroad core
exists, `answerQuestion` is replaced by a call to the same gateway web chat uses; until
then it is the ported prototype (vault token-overlap retrieval + open to-dos + `gpt-5.5`),
which is honest about being a stopgap.

## Email

**Transport: Gmail API via `googleapis` (new dependency in `packages/api`).** This is what
the roadmap specified, and its primitives map one-to-one onto what we need: `history.list`
for incremental sync from a stored `historyId`, `threadId` as `conversationId`, labels for
sent/bulk detection, and `drafts.create` for the draft+approval story. Scopes are
`gmail.readonly` + `gmail.compose` — the connector's code path only ever calls
`drafts.create`; the one place that sends is the approval decision route (below) and, for
self-addressed questions, `sendReply` which hard-refuses any recipient other than the
owner's own address. No `gmail.send`-only scope, no modify scope (read-only by default).

Auth for dogfood: a Google Cloud OAuth client (Desktop type), `node config/gmail-auth.js`
opens the consent URL and stores the refresh token in `.env` (`GMAIL_CLIENT_ID`,
`GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`). Caveat: while the consent screen is in
*Testing* status, refresh tokens expire after 7 days; move it to *In production* (unverified
is fine for our own accounts — it shows a warning at consent, then tokens persist). Per
client, a Google Workspace *Internal* app has neither problem. Non-Google clients (M365)
get an IMAP/Graph provider behind the same `gmail/client.ts` interface later — not now.

**Ingestion.** Poll every `GMAIL_POLL_MS` (default 60s; Pub/Sub push can replace polling
later without touching the rest). `history.list` since the stored `historyId`, falling back
to `messages.list q:newer_than:2d` when Google reports the history as expired (404). Fetch
each new message once (`format: full`):

- `messageId = gmail-<id>`, `conversationId = threadId`, `sender = From`, `subject`.
- `direction`: `inbound` for received mail *and* for `SENT` mail the owner wrote;
  `outbound` only when the message carries the `X-Silkroad-Agent: 1` header we add to
  everything the agent drafts.
- `text` = the new content only: prefer `text/plain`, else HTML stripped to text; quoted
  history (`>` lines, "On … wrote:", forwarded-header blocks) and signatures after `-- `
  are cut so a 20-message thread does not re-ingest itself 20 times. Attachments are named
  in the header block but not read (documents come with the Drive connector).
- **Bulk pre-filter** (no model call): `List-Unsubscribe` header, `Precedence: bulk/list`,
  or `CATEGORY_PROMOTIONS`/`CATEGORY_SOCIAL`/`CATEGORY_UPDATES`/`SPAM`/`TRASH` labels →
  appended with `skipped/bulk`. Logged, searchable, never triaged. Everything else goes to
  the worker as `pending`, where the injection flag and the owner's to-dos are extracted.

**Answering ("email it and it answers").** Mirror of the iMessage self-chat: a message whose
From and To are both the owner's address (or whose subject starts with `Silkroad:`) is a
question for the agent. The answer is sent as an in-thread reply to the owner only, with
the agent header. Drafting replies to third parties is **not** in this iteration — it is
the AR-chase/triage skill work in roadmap A4/A5. What *is* included is the plumbing they
need: an `Approval` of kind `email` whose payload carries a `draftId`, and a hook in
`PUT /api/approvals/:id` so that *approved* + `draftId` calls `drafts.send`. Denied deletes
the draft. This turns the seeded demo rows into the real workflow the brief describes
("Draft ready for the Henderson invoice chase — send?").

## Guardrail checklist (brief §6)

- Outbound = draft + approval: third-party email only ever leaves via an approved
  `Approval`; iMessage cannot address third parties at all; both responders answer only the
  owner. ✔
- Inbound email is untrusted: connectors run no model; the worker's triage/distill have no
  tools; `injection: true` parks the entry as `flagged` for a human and writes nothing. ✔
- Read-only by default: `gmail.readonly` + drafts; no modify, no labels written, no
  deletes except our own denied drafts. ✔
- Memory-write approval: to-dos extracted from any surface join merge/create behind
  `BRAIN_WRITE_APPROVAL`. ✔
- Kill switch + audit: "pause everything" over either channel; flips audited. ✔
- Data isolation: connectors are per-owner processes with per-client credentials; nothing
  cross-client. ✔

## Build order

1. **Shared plumbing** — schema fields + `bulk`/`flagged` outcomes, `appendBrainLog`
   resolution option, gate source context + `actionItems`/`injection`, worker to-do write
   and flagged handling, pause flag, `channels/ingest.ts`. Tests: extend `brainLog.spec.ts`
   and `worker.spec.ts` (real mongodb-memory-server + temp vault, fake gate chat).
2. **iMessage port** — move the prototype into `channels/imessage/*` + `answer.ts`; drop
   the in-connector to-do call; runner + npm script; delete the prototype files. Tests: a
   throwaway `chat.db` built with the `sqlite3` CLI in a temp dir for the queries, and
   captured `attributedBody` hex fixtures for the decoder.
3. **Gmail connector** — `gmail-auth.js`, client, parser (fixture MIME messages incl.
   HTML-only, quoted reply, newsletter), poller with bulk pre-filter and self-email
   answering; runner + npm script. Only the Gmail HTTP layer is mocked.
4. **Approval → send hook** — `draftId` in the approval payload, `decideApproval` hook in
   the route, `X-Silkroad-Agent` header on all agent mail.
5. **Docs** — `.env.example` block for the new variables, Status sections here and in
   `ingestion.md`/`roadmap.md` (A3), README reading order.

Env added: `SILKROAD_USER_EMAIL`, `SILKROAD_AGENT_HANDLES`, `IMESSAGE_POLL_MS`,
`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_POLL_MS`,
`INGEST_BACKFILL`, `INGEST_ONCE`.

## Launch checklist (dogfood — read before starting the connectors)

Three processes, all from the repo root with Mongo running: `npm run brain:worker`,
`npm run channel:imessage`, `npm run channel:gmail`. Before the first launch (and after any
rebuild of `packages/api`):

1. **Restart `npm run brain:worker`** after every `packages/api` rebuild — a running worker
   holds the old dist and the old prompt. As of Aug 30 there are ~197 pending iMessage
   entries waiting for it.
2. **`.env` needs `SILKROAD_USER_EMAIL=amirkhanaidarkhan06@gmail.com`** (the owner account
   every connector logs into and answers; the worker's pause check needs it too). The
   iMessage terminal needs Full Disk Access and Messages signed in.
3. **Gmail first run:** create a *Desktop* OAuth client in a Google Cloud project with the
   Gmail API enabled → put `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` in `.env` → run
   `npm run gmail:auth`, paste the printed `GMAIL_REFRESH_TOKEN=` line into `.env` → then
   `npm run channel:gmail`. Move the consent screen out of *Testing* status or the refresh
   token expires after 7 days. **Done Sep 2, 2026**: Google Cloud project `silkroad-507419`
   (personal gmail.com account, no organisation), Gmail + Calendar APIs enabled, Desktop
   client "Silkroad connector", consent screen *External / Testing* with the owner as the
   only test user — so the refresh token expires Sep 9, 2026 unless the app is published;
   re-run `npm run gmail:auth` then. The connector ran live from history 535805.

4. **Since Aug 30 the connectors answer through the API server** (`context/unification.md`):
   `SILKROAD_SERVICE_TOKEN` is in `.env` (generated Aug 30 — rotate with
   `npm run channels:token`); keep `npm run backend` running whenever a connector runs.
   Without the token the connectors fall back to the old local answerer (no tools, no
   mirrored conversations). `SILKROAD_USER_EMAIL` and `SILKROAD_MONTHLY_EXPECTED_USD=50`
   were added to `.env` at the same time — steps 2 and 4 are done.
5. ~~Run `npm run migrate:agent-permissions` once~~ — **done Aug 30** (2 private agents
   migrated); the Deep Research subagents are no longer skipped for the owner.

6. The worker now also runs the **morning brief** (7:00 local) and the **weekly invoice
   chase** (Monday 8:00); both arrive as notices over iMessage/email. Re-run
   `npm run gmail:auth` once Gmail is set up so the token also carries the calendar scope.

7. Local Mongo is the `silkroad-mongo` Docker container (publishes 127.0.0.1:27017; the
   compose `chat-mongodb` does not publish a host port). The API binds `localhost` → `::1`
   on this Mac, so `.env` carries `SILKROAD_API_URL=http://[::1]:3080` for the connectors.

Kill switch: text or email yourself "pause everything" / "resume".

## Status — implemented in the fork (August 30, 2026)

Built the same day as the spec, on top of ingestion v1. Everything above is live except
where noted:

- **Shared plumbing**: `BrainLog` has `sender`/`subject`/`todoItems` and the `flagged`/`bulk`
  outcomes; `appendBrainLog` accepts a pre-resolution; the gate takes a `BrainSource`
  header and triage returns `actionItems` + `injection`; the worker parks flagged content,
  writes deduped to-dos (behind `BRAIN_WRITE_APPROVAL`, applied by the existing approve
  route), and honours the pause flag. Kill switch = `ChannelState` model
  (`isChannelsPaused`/`setChannelsPaused`) instead of the hash-chained admin `AuditLog`,
  whose action enum is admin-specific; flips are logged, not audit-chained, until core.
  The shared OpenAI call lives in `packages/api/src/brain/openai.ts` (`createBrainChat`).
- **iMessage** (`npm run channel:imessage`, `packages/api/src/channels/imessage/`): ported
  as specified; the prototype files are gone. Smoke-tested Aug 30 against the real
  `chat.db`: one pass ingested ROWIDs 19655–19867 with sender/thread provenance and sent
  nothing (no fresh owner question). Marketing SMS from short codes and texts with
  STOP/unsubscribe footers are logged as `bulk`, mirroring the email pre-filter.
- **Gmail** (`npm run channel:gmail`, `npm run gmail:auth`, `packages/api/src/channels/gmail/`):
  built on `@googleapis/gmail` exactly as specified; 16 tests against an in-memory Gmail
  fake. **Not yet run live** — no OAuth client/refresh token in `.env`; first-run steps are
  in the Email section above and `.env.example`. Thread history for answers is per-process
  memory (resets on restart).
- **Approval → send hook**: `Approval.payload.draftId`; `PUT /api/approvals/:id` sends the
  draft on approve and deletes it on deny (`applyDraftDecision`), and reopens the approval
  to `pending` if the side effect fails. Nothing creates draft approvals yet — that is the
  AR-chase/triage skill work (A4/A5).
- **Tests**: 48 in `packages/api` (`src/brain`, `src/channels`) and 12 in `data-schemas`
  (`brainLog`, `channelState`, `approval` specs on mongodb-memory-server).
- Restart `npm run brain:worker` after this lands: a running worker holds the old dist and
  the old chat-only gate prompt.

## Open questions (append answers here, dated)

- Which handle is "the agent" for a client who does not use Note to Self — a dedicated
  Apple ID on the relay Mac mini (cleanest; also resolves D1) or the owner's own?
- Group-chat ingestion: fine for dogfood; per client it may need an allowlist of chats
  (privacy expectation of the other participants).
- Should the owner's *sent* mail be triaged at full cost, or only when it starts a thread?
  Start with everything; revisit against `ingest/stats` token counts.
