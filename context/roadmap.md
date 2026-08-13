# Silkroad — Implementation Plan

**Created: August 13, 2026.** Derived from [`brief.md`](./brief.md) (source of truth) and a
code survey of this repo. Two tracks run in parallel, matching brief §8: **Track A** is the
Silkroad core (the always-on agent — lives in a separate repo), **Track B** is this repo (the
LibreChat fork → web interface), **Track C** is per-client infrastructure.

## Architecture decision (made here, revisit if wrong)

**The fork is a thin client; the brain lives in Silkroad core.** LibreChat normally calls
model APIs directly, which would give the web chat its own separate memory. Instead, Silkroad
core (a standalone service) owns the agent loop, memory (Postgres + pgvector), skills,
channels, and guardrails, and exposes an **OpenAI-compatible endpoint**. The fork points at
it as its single custom endpoint. Web chat, iMessage, and email then hit one brain with zero
deep surgery in LibreChat's backend. The fork keeps only auth, conversation UI, and the
dashboard; MongoDB stays for LibreChat's own conversation/user storage.

Consequences: we stop tracking upstream LibreChat after the strip (security patches get
cherry-picked manually — acceptable; the fork's surface shrinks drastically anyway).

---

## Track A — Silkroad core (new repo, e.g. `silkroad-core`; weeks 1–3)

**A1. Gateway + agent loop (week 1).** TypeScript service. OpenAI-compatible
`/v1/chat/completions` (streaming) in front of an agent loop that calls **OpenRouter**
(cheap-capable default model, fallback chain). Stable system-context prefix (identity +
skills list + memory digest) to maximize prompt caching.

**A2. Brain (week 1–2).** Postgres + pgvector: message log across all surfaces, document
index, entity memory. Everything the agent touches gets indexed automatically. Memory
writes go through an approval queue (guardrail: on for month 1 per client). Design detail
in [`ingestion.md`](./ingestion.md): synchronous raw log + async selective distiller in a
separate worker process, so replies never wait on ingestion.

**A3. Channels (week 2).**
- **Email**: Gmail API (watch/push or polling), send-as drafts. Inbound mail is untrusted:
  triage runs on a cheap model with **no tools**; instructions inside emails are flagged,
  never executed.
- **iMessage**: requires Apple hardware — a Linux VPS cannot speak iMessage. Options:
  Photon Spectrum (per Plan v2), BlueBubbles on a Mac mini relay, or a hosted relay.
  **Open decision D1** — resolve before week 2.

**A4. Cron workflows (week 2–3).** Morning brief at 7am (triaged inbox, calendar, tasks,
cash snapshot → iMessage). Weekly AR-chase: QuickBooks aging (read-only) → draft chase
emails → approval via iMessage tap → send.

**A5. Skills + guardrails (week 3, ongoing).** Skill format + private GitHub skills repo;
hand-write the first three (brief, triage, AR-chase). Guardrails from brief §6 implemented
as code, not policy: draft+approval on all outbound, read-only integration scopes,
per-task turn budget, allowlisted draft domains, audit log table, kill-switch command
("pause everything" over iMessage works), monthly token alert at 3× expected.

## Track B — this repo: strip, rebrand, dashboard (weeks 1–4, parallel)

**B1. Config-level strip (days 1–2, zero code risk).** `librechat.yaml` + `.env` gets ~80%:
- `interface:` flags off: presets, prompts, bookmarks, multiConvo, memories, marketplace,
  temporaryChat, runCode, webSearch, fileSearch, mcpServers, skills, remoteAgents,
  sharedLinks, peoplePicker (schema: `packages/data-provider/src/config.ts:1409-1573`).
- `ENDPOINTS=` down to the single custom endpoint; `endpoints.custom` → Silkroad gateway
  (OpenRouter example at `librechat.example.yaml:673` is the template).
- `SEARCH=false` (no Meilisearch), no `RAG_API_URL` (no rag_api/pgvector containers —
  the brain lives in Silkroad core), `ALLOW_REGISTRATION=false` (invite-only via
  `npm run invite-user`), no social-login env vars, `ALLOW_SHARED_LINKS=false`.

**B2. Code strip (week 1–2).** In order, keeping the app green after each step:
1. Trim the startup payload chokepoint `api/server/routes/config.js` and client routes
   `client/src/routes/index.tsx`.
2. Delete client feature dirs: `Agents/` (marketplace/builder UI), `Skills/`, `Projects/`,
   `Prompts/`, `Artifacts/`, `Bookmarks/`, `Plugins/`, `Tools/`, `MCP/`, `Web/`, `Share*/`,
   `Audio/`, `Banners/`, unused `SidePanel/*`, presets/bookmarks menus, multi-convo,
   input badges (code interpreter, web search, file search, memory, audio).
3. Delete backend: `routes/assistants` + `controllers/assistants` + assistant services,
   `api/app/clients/tools/`, Tool/Plugin/Action services, provider dirs
   `packages/api/src/endpoints/{anthropic,google,bedrock}` (keep `openai/` + `custom/`),
   plus fork extras: `admin/*` routes, Langfuse, RUM, tenant middleware, projects, skills.
   **Keep the agents execution engine** (`/api/agents/chat` is the chat path) — strip its
   UI only.
4. Delete unused schemas in `packages/data-schemas/src/schema/*` (preset, prompt,
   assistant, share, skill, project…). Remove OAuth/SAML/LDAP strategies in
   `api/strategies/` (config-disabled already; removal is hygiene). Keep local + JWT + 2FA.

**B3. White-label kit (week 2).** Per-client branding without code edits: `APP_TITLE`,
`CUSTOM_FOOTER`, `REACT_APP_THEME_*` tokens (`client/src/utils/getThemeFromEnv.js`),
swap `client/public/assets/*`, `interface.customWelcome`. One-time code pass: Silkroad
naming in `client/index.html:5-17`, `Auth/AuthLayout.tsx:68` logo, `locales/en`. Polish is
a product requirement — budget real design time on typography, empty states, and the brief.

**B4. Wire to Silkroad gateway (week 3).** Single custom endpoint, single model spec
(`modelSpecs` with `modelSelect` off — the CEO never picks a model). LibreChat auth session
proxies `/api/silkroad/*` to the gateway so the dashboard and chat share auth.

**B5. Analytics/dashboard view (weeks 3–4).**
- Toggle in the top-right cluster of `client/src/components/Chat/Header.tsx:72-79`;
  route added in `client/src/routes/index.tsx` reusing the existing
  `routes/Layouts/Dashboard.tsx` auth-gated layout.
- V1 content: **to-do list** (CRUD, agent can add/complete via chat — stored in Silkroad
  core so all surfaces see it) and **financial graphs** (cash position, AR aging, revenue
  trend) served pre-aggregated by Silkroad core from QuickBooks/Mercury read-only connectors.
- Frontend per CLAUDE.md conventions: data-provider feature hooks + React Query, semantic
  theme tokens, Recharts (or the repo's existing chart dependency if one survives the
  strip). Beautiful is the bar.

## Track C — per-client infrastructure (weeks 2–4)

- **One provisioning script** (`silkroad provision <client>`): Hetzner VPS (4 vCPU/8GB/80GB,
  2–4GB swap), Docker Compose running: Silkroad core, LibreChat fork (api + client), MongoDB,
  Postgres + pgvector, Caddy/Traefik with TLS on the client's branded subdomain.
- Nightly encrypted off-box backups (Mongo + Postgres), uptime + RAM monitoring with
  alerting, per-client token-spend metering and 3× alert.
- Secrets: per-client `.env` vault; no cross-client anything (contractual).

## Milestones (mirrors brief §8)

| When | Milestone | Done means |
|---|---|---|
| End week 2 | Dogfood instance for ourselves | We text/email our own Silkroad daily; brief + triage + AR-chase skills exist; fork stripped and pointing at the gateway |
| End week 4 | Client #1 live | Morning brief + AR chase in draft-only mode, all guardrails on, branded web UI with dashboard toggle |
| Week 8 | Clients #2–3; pilot verdict | Client #1 messages unprompted 3+/week (week-4 check) and agrees to a price (week-8 check) |

## Open decisions (resolve before they block)

- **D1 (blocks A3, week 2): iMessage transport.** Linux VPS can't do iMessage. Photon
  Spectrum vs BlueBubbles-on-Mac-mini relay vs hosted relay — pick one; affects cost,
  reliability, and the "dedicated per-client" isolation story.
- **D2 (blocks A1): default model on OpenRouter.** "Cheapest still-capable"
  (DeepSeek-class) — benchmark 2–3 candidates on drafting + triage quality vs the Claude
  table as reference before locking the default and fallback chain.
- **D3 (blocks B5 scope): confirm the third finance tool** Amir named (garbled in
  dictation) before scoping dashboard connectors past QuickBooks + Mercury.
- **D4 (soft): agent-loop build.** Hand-rolled TS loop vs an agent SDK. Recommendation:
  smallest thing that works — a hand-rolled loop with tools + skills; revisit if tool-use
  complexity grows.

## Status — August 13, 2026 (first build round, interface-first)

Done and smoke-tested locally (backend :3080, vite :3090, Mongo in Docker `silkroad-mongo`):
- **Config strip** via `librechat.yaml` + `.env`: single `openAI` endpoint pinned to
  `gpt-5.5` (OpenAI direct for now — OpenRouter deferred by decision), one enforced
  "Silkroad" model spec (`modelLabel: Silkroad`, gold icon), model selector hidden, presets /
  prompts / bookmarks / marketplace / code / web search / MCP / skills / shared links /
  registration / social login all off. Title generation on `gpt-5.4-nano`.
- **Branding**: Silkroad wordmark + favicon (gold-on-dark placeholder), APP_TITLE, custom
  footer, welcome copy.
- **To-do stack**: Mongo `Todo` schema/model/methods in `packages/data-schemas`,
  `/api/todos` CRUD route, data-provider endpoints/types/hooks — full CRUD verified via
  API and UI.
- **Analytics view** at `/analytics` with chat↔analytics toggle in the chat header,
  organized in three sections (feature set grounded in a survey of AI chief-of-staff tools
  and CEO-dashboard practice — triage categories, needs-reply queues, drafts/sent counts,
  cash/runway/AR/burn as the daily metrics):
  - 8 stat cards: cash on hand, runway (computed from burn), outstanding AR, revenue vs
    target, monthly burn, time saved, emails handled, open tasks (live).
  - Finance: cash-position area, receivables aging, revenue vs expenses, top overdue
    invoices, Mercury-style bank accounts, upcoming payables, company-brain index size.
  - Silkroad at work: 7-day activity bars (answered/drafted/sent), inbox-triage donut,
    awaiting-approval queue (mirrors the draft+approval guardrail), recent-activity feed.
  - Today: schedule list + the real to-do panel (optimistic check-off).
  All finance/agent numbers are sample-badged until connectors exist; to-dos are live.

**Demo round 2 (same day):** Company brain shipped as a real Obsidian vault (`brain/`,
26 wikilinked notes on Anduril researched via web search — products, programs, funding
through Series H at $61B, people, competitors). Vault parser + graph builder in
`packages/api/src/brain/`, auth-guarded `/api/brain` routes (path-traversal safe),
data-provider hooks, and an interactive d3-force **graph explorer as the Analytics hero
section** — hover-highlighting, type-colored nodes sized by degree, note search, and a
markdown note reader with clickable wikilinks. Chat gained a **Deep Research toggle**
(second model spec `silkroad-deep` with a structured-report protocol; full-page navigation
on toggle because the spec query param only applies on fresh mount) and **two seeded
Anduril specialist subagents** (`agent_anduril_finance`, `agent_anduril_programs`) enabled
via `modelSpecs.subagents` — verified running in parallel and feeding a synthesized report
with numbers tables, risks, and next steps. Swap `brain/` + specs + seed script per client.

**Demo round 3 (same day):** Live approval queue ("Awaiting your approval") at the top of
the Company brain section — the draft+approval guardrail as a real workflow, not a sample
widget. Mongo `Approval` schema/model/methods in `packages/data-schemas` (kinds: email,
message, document; status pending/approved/denied with pending-only decision guard),
auth-guarded `/api/approvals` (GET/POST/PUT), data-provider endpoints/types/hooks with
optimistic decide mutation, and `Analytics/Actions.tsx`: clickable rows (title,
description, kind icon, relative time, status chip) opening a detail dialog — email view
(to/cc/subject + body), message view (channel/recipient + bubble), financial-doc view
(summary + before→after changes table) — with Approve/Deny in the footer. Seeded via
`config/seed-approvals.js` (2 invoice-chase emails, 1 iMessage, 1 QuickBooks forecast
edit). The old sample-badged Approvals panel was removed. Silkroad core should create
approvals via `POST /api/approvals` when it drafts outbound work.

**Demo round 4 (same day):** Chat mode selection moved into the composer. The header Deep
Research toggle — and its full-page-navigation workaround — is gone, replaced by
`Chat/Input/ModeSelector.tsx`: a dropdown beside the input that switches between enforced
model specs in place via `useSelectMention` (no reload). Three modes: `silkroad` (Chat),
**`silkroad-brain` (Brain Search — new third spec)**, and `silkroad-deep` (Deep Research).
Brain Search answers only from the company brain and cites notes as `[[wikilink]]`s;
grounding is currently prompt-baked (note list + core facts in the spec's `promptPrefix`) —
real retrieval arrives when the brain moves to Silkroad core. Modes render only when their
spec exists in `librechat.yaml`, so the selector adapts per client (hidden entirely below
two modes). Graph explorer v2: `buildBrainGraph` now emits **satellite nodes** around each
note — topics (from `##` headings), facts (bolded phrases, truncated), and shared tag nodes
(frontmatter tags) — parsed in `vault.ts`; clicking a satellite opens its parent note.
Layout reworked: degree-scaled note radii, halo rings on the top-4 hubs, per-link
distances, fit-to-bounds stretch so the graph fills the canvas, text-halo labels (satellite
labels appear only on hover/search); `stats.links` now counts note↔note edges only. The
live Actions approval queue moved to the top of the Company brain section, and the
chat↔analytics toggle floats over the top-right of the analytics page instead of sitting in
a header row.

**Brain ingestion v1 (same day, later):** the [`ingestion.md`](./ingestion.md) spec is now
implemented *in the fork* (pragmatic deviation from "Track A owns it" — recorded in that
spec's Status section): every durable chat message is appended synchronously to a Mongo
`brainlogs` raw log via a `saveMessage` wrapper in `api/models/index.js` (fire-and-forget;
the reply path never waits), and a separate distiller process (`npm run brain:worker`,
`config/brain-worker.js`) claims inbound entries and runs the two-step gate in
`packages/api/src/brain/` — cheap triage (`gpt-5.4-nano`) kills ephemeral chatter, a
stronger distill call (`gpt-5.5`) decides known/merge/create and writes wikilinked vault
notes. `BRAIN_WRITE_APPROVAL` (default on) parks merge/create as `awaiting_approval`
behind `/api/brain/approvals` list/approve/reject endpoints; `/api/brain/ingest/stats`
exposes queue counts. Verified end-to-end: a chat message about a new $250k pilot became a
complete vault note; a venting message was skipped as ephemeral but kept in the raw log.
16 Jest tests (real mongodb-memory-server for the queue; real temp vaults for the worker).
Follow-ups: surface brain approvals in the dashboard Actions panel (converge with the
`/api/approvals` stack), distill outbound/email/iMessage surfaces when channels exist.

Known polish backlog: "Projects" section still visible in sidebar (fork feature to strip);
`interface.customWelcome` text not rendering on the landing (icon only); pre-existing tsc
error in `client/src/hooks/Chat/useChatFunctions.ts:619` (untouched by this work); PNG
favicons/touch icons still LibreChat's (SVG favicon replaces the main one).

## Sanity notes from the code survey

- This fork is **not vanilla upstream**: it already contains Skills, Projects, admin
  routes, Langfuse, RUM telemetry, and tenant middleware — all on the strip list.
- Meilisearch and the RAG stack are optional and off by config — no code needed to drop.
- All social/OIDC/SAML/LDAP auth is disabled by absent env vars — removal is cleanup, not
  a blocker.
