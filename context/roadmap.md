# Hermes — Implementation Plan

**Created: August 13, 2026.** Derived from [`brief.md`](./brief.md) (source of truth) and a
code survey of this repo. Two tracks run in parallel, matching brief §8: **Track A** is the
Hermes core (the always-on agent — lives in a separate repo), **Track B** is this repo (the
LibreChat fork → web interface), **Track C** is per-client infrastructure.

## Architecture decision (made here, revisit if wrong)

**The fork is a thin client; the brain lives in Hermes core.** LibreChat normally calls
model APIs directly, which would give the web chat its own separate memory. Instead, Hermes
core (a standalone service) owns the agent loop, memory (Postgres + pgvector), skills,
channels, and guardrails, and exposes an **OpenAI-compatible endpoint**. The fork points at
it as its single custom endpoint. Web chat, iMessage, and email then hit one brain with zero
deep surgery in LibreChat's backend. The fork keeps only auth, conversation UI, and the
dashboard; MongoDB stays for LibreChat's own conversation/user storage.

Consequences: we stop tracking upstream LibreChat after the strip (security patches get
cherry-picked manually — acceptable; the fork's surface shrinks drastically anyway).

---

## Track A — Hermes core (new repo, e.g. `hermes-core`; weeks 1–3)

**A1. Gateway + agent loop (week 1).** TypeScript service. OpenAI-compatible
`/v1/chat/completions` (streaming) in front of an agent loop that calls **OpenRouter**
(cheap-capable default model, fallback chain). Stable system-context prefix (identity +
skills list + memory digest) to maximize prompt caching.

**A2. Brain (week 1–2).** Postgres + pgvector: message log across all surfaces, document
index, entity memory. Everything the agent touches gets indexed automatically. Memory
writes go through an approval queue (guardrail: on for month 1 per client).

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
- `ENDPOINTS=` down to the single custom endpoint; `endpoints.custom` → Hermes gateway
  (OpenRouter example at `librechat.example.yaml:673` is the template).
- `SEARCH=false` (no Meilisearch), no `RAG_API_URL` (no rag_api/pgvector containers —
  the brain lives in Hermes core), `ALLOW_REGISTRATION=false` (invite-only via
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
swap `client/public/assets/*`, `interface.customWelcome`. One-time code pass: Hermes
naming in `client/index.html:5-17`, `Auth/AuthLayout.tsx:68` logo, `locales/en`. Polish is
a product requirement — budget real design time on typography, empty states, and the brief.

**B4. Wire to Hermes gateway (week 3).** Single custom endpoint, single model spec
(`modelSpecs` with `modelSelect` off — the CEO never picks a model). LibreChat auth session
proxies `/api/hermes/*` to the gateway so the dashboard and chat share auth.

**B5. Analytics/dashboard view (weeks 3–4).**
- Toggle in the top-right cluster of `client/src/components/Chat/Header.tsx:72-79`;
  route added in `client/src/routes/index.tsx` reusing the existing
  `routes/Layouts/Dashboard.tsx` auth-gated layout.
- V1 content: **to-do list** (CRUD, agent can add/complete via chat — stored in Hermes
  core so all surfaces see it) and **financial graphs** (cash position, AR aging, revenue
  trend) served pre-aggregated by Hermes core from QuickBooks/Mercury read-only connectors.
- Frontend per CLAUDE.md conventions: data-provider feature hooks + React Query, semantic
  theme tokens, Recharts (or the repo's existing chart dependency if one survives the
  strip). Beautiful is the bar.

## Track C — per-client infrastructure (weeks 2–4)

- **One provisioning script** (`hermes provision <client>`): Hetzner VPS (4 vCPU/8GB/80GB,
  2–4GB swap), Docker Compose running: Hermes core, LibreChat fork (api + client), MongoDB,
  Postgres + pgvector, Caddy/Traefik with TLS on the client's branded subdomain.
- Nightly encrypted off-box backups (Mongo + Postgres), uptime + RAM monitoring with
  alerting, per-client token-spend metering and 3× alert.
- Secrets: per-client `.env` vault; no cross-client anything (contractual).

## Milestones (mirrors brief §8)

| When | Milestone | Done means |
|---|---|---|
| End week 2 | Dogfood instance for ourselves | We text/email our own Hermes daily; brief + triage + AR-chase skills exist; fork stripped and pointing at the gateway |
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

Done and smoke-tested locally (backend :3080, vite :3090, Mongo in Docker `hermes-mongo`):
- **Config strip** via `librechat.yaml` + `.env`: single `openAI` endpoint pinned to
  `gpt-5.5` (OpenAI direct for now — OpenRouter deferred by decision), one enforced
  "Hermes" model spec (`modelLabel: Hermes`, gold icon), model selector hidden, presets /
  prompts / bookmarks / marketplace / code / web search / MCP / skills / shared links /
  registration / social login all off. Title generation on `gpt-5.4-nano`.
- **Branding**: Hermes wordmark + favicon (gold-on-dark placeholder), APP_TITLE, custom
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
  - Hermes at work: 7-day activity bars (answered/drafted/sent), inbox-triage donut,
    awaiting-approval queue (mirrors the draft+approval guardrail), recent-activity feed.
  - Today: schedule list + the real to-do panel (optimistic check-off).
  All finance/agent numbers are sample-badged until connectors exist; to-dos are live.

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
