# Silkroad — Project Brief

**Status: SOURCE OF TRUTH (added August 13, 2026).** Synthesizes Amir's dictated product
vision (authoritative) with Plan v2 ([`plan.md`](./plan.md), Aug 10, 2026). Where the two
conflict, the dictation wins; conflicts are resolved in the Appendix at the end.

**Managed AI agents for non-tech-savvy small and medium businesses, deployed per-client, sold to C-suites.**

---

## 1. The core idea

We set up AI agents for small-to-medium companies whose leadership is not tech-savvy. We are
not building one horizontal product and selling it to everyone. Instead, we operate as
**forward-deployed engineers**: we go talk to each company, figure out what agents they
actually need, and build the corresponding specialized agents for them — a finance agent, or
an agent specialized in some other single function, whatever the business calls for. All of
these agents **share context** with each other. The whole thing is **branded as the client
company's own AI**, and it is sold directly to the C-suite.

The buyer doesn't care about AI; they care about outcomes. They don't self-serve, don't do
free trials, and buy through peers. That means high-touch sales and a done-for-you managed
service: one bundled monthly fee, no API keys, nothing for the client to learn or maintain.

## 2. The product: the Silkroad agent

The product is the **Silkroad agent** (working name — the original dictation called it
"Hermes" / H-E-R-M-E-S; renamed to Silkroad on Aug 13, 2026, see the pivot log in
[`positioning.md`](./positioning.md) — treat "Silkroad" as canonical). One Silkroad deployment is set up **per
company, on a dedicated VPS** that we run. The client never sees a server bill or an API
key — the infrastructure is bundled into the product.

Silkroad has two faces:

### 2a. The always-on background agent

Silkroad runs **constantly in the background** on the client's VPS. It responds to the CEO's
**iMessages** and **emails** directly — the CEO can just text it or email it and it answers.
(Voice calling was considered and explicitly cut: no calls. Earlier dictation also floated
Telegram as a channel; the later, more considered dictation settled on iMessage + email as
the channel set for now, with room to add more later.) The design goal is that the CEO
reaches their company's AI through the communication surfaces they already live in, at any
hour, with the agent remembering everything.

### 2b. The web interface (LibreChat fork)

The main visual interface is a **chat**, built by forking **LibreChat** — the fork is
already copied into our GitHub org and needs to be **stripped down**, removing everything
unnecessary for this use case. The chat runs on the same underlying model and, critically,
has the **same shared context as Silkroad itself** — chatting on the web, texting via
iMessage, and emailing all hit one brain, one memory.

In the top-right of the interface there is a **toggle between two views**:

1. **Chat** — the user asks questions and gets things done conversationally, with full
   company context behind every answer.
2. **Analytics / dashboard** — a statistics view containing the **to-do list** plus
   **graphs**, for example financial graphs pulled from whatever tools the client uses
   (**QuickBooks**, **Mercury**, and similar — the third tool Amir mentioned was garbled in
   transcription and is unconfirmed). Which data sources and which graphs appear is scoped
   out per client during the forward-deployed engineering engagement — we find out what they
   use, wire it up, and build the dashboards for them.

Everything should be **beautiful**. Polish of the interface is an explicit product
requirement, not an afterthought — this is a branded product being sold to executives.

## 3. Model layer

Inference is API-side, routed through **OpenRouter**. The model strategy is to use the
**cheapest models that are still highly capable** — Amir's reference point in dictation was
a DeepSeek-class model (he said something like "DeepSeek v4 Pro"; the exact model name was
garbled, but the intent is clear: frontier-adjacent open/cheap models, not premium-priced
APIs, for the bulk of the workload). OpenRouter also gives fallback chains and
multi-provider redundancy without writing custom abstraction code, which matters for an
"always-on" promise.

(The Plan v2 research doc instead proposed an all-Claude routing table — Sonnet 5 for the
main agent, Opus 5 for deep research, Haiku 4.5 for triage/briefs. Per the dictation, the
default is cheap-capable models via OpenRouter; the Claude routing table should be treated
as one candidate configuration / cost benchmark, not the decision. The doc's general
principle survives either way: route expensive models only where quality is felt, cheap
models for classification, triage, and summarization, and lean hard on prompt caching by
keeping the agent's base context stable.)

## 4. Go-to-market and delivery model

**Forward-deployed engineering** is the delivery model and the moat. For each client:

1. Talk to the company. Understand their workflows, their tools, their pain.
2. Build the specific specialized agents they need (finance, ops, whatever), all sharing
   one context/brain.
3. Brand the whole deployment as *their* company's AI.
4. Sell and account-manage at the C-suite level.

The Plan v2 doc adds a compounding mechanism worth keeping: a **private skills library**
(versioned in a private GitHub repo). Every workflow fixed for client N is packaged as a
reusable skill and ships to clients N+1 automatically. This is what turns a consultancy into
a product over time — the doc's tripwire is apt: if per-client care hours aren't falling by
roughly client #6, delivery is broken and selling should pause.

Distribution at pilot stage runs through a warm network (a specific connector's community of
non-AI-native businesses), which is why a concentrated segment beats going horizontal
against Microsoft Copilot ($18–21/user bundled into M365) and the crowd of $20–50/seat EA
tools (Fyxer, Motion, Lindy, etc.) that own the tech-native buyer.

## 5. What ships in the pilot (from Plan v2, compatible with the dictation)

Core capabilities deployed identically to every client, then extended per-client:

- **Chief-of-staff behavior** over iMessage + email + web chat: drafts emails, answers
  questions, updates tasks, remembers everything.
- **Morning brief** (cron): triaged and ranked inbox, calendar, open tasks, cash snapshot,
  delivered to the CEO's phone at 7am.
- **One money workflow — AR chasing / cash visibility**: pull QuickBooks aging weekly,
  draft polite chase emails for approval, and answer "who owes you what" in every brief.
  It's legible, measurable ("collected $X faster"), and low blast radius.
- **Company brain as a byproduct**: every document, email, and invoice the agent touches
  gets indexed (Postgres + pgvector at pilot scale). The brain fills itself; the client is
  never asked to populate a wiki.
- **The analytics/dashboard view** with to-do list and financial graphs (per the
  dictation — note the research doc had deferred dashboards; the dictation overrides this
  and makes the dashboard toggle a launch feature of the interface).

Explicitly deferred until a paying client asks: social media module, autonomous bookkeeping
(assistant-mode only — suggestions and anomaly flags, never autonomous writes, because
bookkeeping errors surface at tax time and that's a churn event), CRM integrations beyond
scoped needs, meeting bots. Connector count at pilot is capped small (email, calendar,
Drive, QuickBooks/Mercury-class finance tools, iMessage) because every added integration is
a credential, a failure mode, and an 11pm debug.

Positioning rule worth preserving: our defensible ground is **cross-tool synthesis** —
books + email + calendar + docs in one brain — which single-tool incumbents (Intuit inside
QuickBooks, Copilot inside M365) structurally can't do.

## 6. Guardrails (non-negotiable, from Plan v2)

An always-on agent that reads inbound email is a prompt-injection surface: any email is
attacker-controlled input to an agent with tools, and the buyer's trust is unrecoverable
after one bad autonomous action. Hence:

- **Outbound = draft + approval** for the first 90 days per client. The agent drafts; the
  human taps approve ("Draft ready for the Henderson invoice chase — send?"). This doubles
  as the trust ramp. Graduation to auto-send is per-workflow, per-client, opt-in, and
  logged.
- **No payment or banking authority, ever.** No bank credentials, no payment initiation.
  Finance-tool access is read + draft only.
- **Read-only by default** on every new integration; write scopes granted one workflow at a
  time.
- **Inbound email is untrusted input.** Triage runs on a cheap model with no tool access;
  instructions found inside emails are flagged to a human, never executed.
- **Container hardening**: Docker namespace isolation; no unreviewed community skills on
  client boxes; inline shell off by default for anything outside our own skills repo.
- **Blast-radius caps**: per-task turn budgets, monthly token alerts at 3× expected,
  allowlisted email domains for auto-drafts in the first weeks.
- **Memory write approval** on for the first month per client (so the brain doesn't learn
  garbage during onboarding).
- **Kill switch + audit log**: one command pauses a client's gateway; the client can text
  "pause everything" and it works; every outbound action and approval is logged.
- **Data isolation as contract language**: dedicated server per client, no cross-client
  data flow, no training on client data, deletion on termination.

## 7. Infrastructure and economics (from Plan v2 — treat numbers as estimates)

**VPS per client**: ~4 vCPU / 8GB RAM / 80GB NVMe (Hetzner US class, ~$8–15/mo real cost,
$25/mo budget line). CPU barely matters since inference is API-side; RAM is the constraint
because browser automation bursts 0.5–1.5GB and an OOM-killed database mid-conversation is
the one failure "always-on" can't have. Clients are not consolidated onto shared nodes at
this stage — physical isolation is doing sales work, and consolidation is a ~50-client
conversation. A Mac Mini on-prem exists as a premium sales story ("your AI lives in your
office"), not a default, since it's an ops liability.

**Modeled costs** (from the doc's all-Claude assumption, so ceilings rather than floors if
cheaper OpenRouter models carry the load): token spend ~$24–$153/client/month across
light→heavy usage personas; fixed infra ~$55/mo (VPS, search API, messaging API, backups,
buffer). All-in COGS roughly $80–$210/client/month.

**Pricing**: setup fee $4,000–6,000 one-time (covers the real 20–30 founder-hours of
onboarding and filters non-serious buyers), then a retainer of $1,500–2,500/month by scope.
Never meter the client — usage anxiety kills adoption, and adoption is retention; a fair-use
clause lives in the contract as insurance only. Pitch math: "$2,000/month all-in is 3–5% of
a loaded EA salary, answers at 11pm, and already knows your business." Gross margins on
compute at those prices are ~86–97%. The honest cost line is founder time (~3–6
hrs/month/client of care after onboarding), which the skills library must drive down.

**Year-1 sketch**: 10 clients by month 12 at $5k setup + $2k/mo ≈ $196k revenue against
<$9k infra+token COGS.

## 8. Build order and success criteria (from Plan v2)

Weeks 1–2: one Silkroad instance on a VPS for ourselves; wire email + iMessage; hand-write
the first three skills (brief, triage, AR-chase); start the private skills repo. Weeks 3–4:
deploy client #1 via the warm connector with exactly two capabilities live (morning brief +
AR chasing, draft-only), all guardrails on. Weeks 5–8: let the client's actual asks drive
the next skills; promote reviewed agent-authored skills into the shared repo; deploy
clients #2–3. In parallel, strip the LibreChat fork and build the chat/analytics interface
with the toggle.

Pilot succeeds iff (a) the client sends the agent an unprompted message 3+ times a week by
week 4 — the only retention signal that matters — and (b) agrees to a price by week 8.
Separately, a 60-day GTM test: 3 paid design partners from warm intros, or the access
advantage is unproven and we pause rather than push.

## 9. Risk register (from Plan v2)

SMB churn graveyard → managed service + data gravity (the brain and books history) + annual
contracts after pilot. Segment definition still fuzzy → pin down the connector's actual
network (industry, size, tools) before week 3. Copilot/Intuit commoditization → never
compete on single-tool features; sell cross-tool synthesis. Prompt injection via email →
guardrails above; triage model has no tools. Provider outage vs. the always-on promise →
OpenRouter fallback chains. Founder-time ceiling → skills-repo leverage, measured monthly,
tripwire at client #6.

---

## Appendix: contradictions between dictation and Plan v2, and how they were resolved

Dictation is the source of truth throughout. Specifically:

1. **Dashboards.** Plan v2 says "no dashboards to learn" and defers dashboards entirely.
   Dictation makes the chat↔analytics toggle (to-do list + financial graphs) a core part of
   the interface. → **Dashboard view is in.**
2. **Channels.** Plan v2 specifies WhatsApp + iMessage + email. Dictation settled on
   **iMessage + email** (Telegram was floated early and dropped; "email is enough for now";
   calls explicitly rejected). → **iMessage + email**, WhatsApp/Telegram are possible later
   additions, no voice calls.
3. **Models.** Plan v2 routes everything to Claude models. Dictation says **OpenRouter with
   the cheapest still-capable models (DeepSeek-class)**. → Cheap-capable via OpenRouter is
   the default; the Claude routing table is a benchmark/candidate config only.
4. **Agent architecture.** Plan v2 insists on one Silkroad profile per client with
   capabilities as "skills inside it, not separate agents." Dictation describes **multiple
   specialized agents (finance agent, etc.) sharing context**. → Specialized agents sharing
   one context/brain is the product framing. (Whether they're implemented as separate
   processes or as skills within one runtime is an engineering decision; the doc's warning
   about never pointing two agent processes at one memory profile remains a valid
   implementation constraint.)
5. **Interface.** Plan v2 doesn't mention LibreChat. Dictation: **LibreChat fork, already
   in our GitHub, to be stripped down**, is the chat interface. → LibreChat fork is the
   frontend. **This repository is that fork.**
6. **Finance tools.** Plan v2 says QuickBooks/Xero; dictation names **QuickBooks and
   Mercury** (plus one garbled third tool). → QuickBooks + Mercury, exact integration set
   scoped per client.

Everything else in Plan v2 (guardrails, economics, VPS spec, pilot plan, skills library,
positioning) does not contradict the dictation and is carried forward as research-grade
planning — Amir has flagged that not all of it is verified, so numbers and third-party
pricing claims should be re-checked before being relied on externally.
