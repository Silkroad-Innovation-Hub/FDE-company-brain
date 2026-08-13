# AI Operations Layer for Non-AI-Native SMBs — Plan v2

**Updated: August 10, 2026.** Supersedes the "AI consulting strategy + AI stack" doc.
Changes from v1: pilot scope cut, model table corrected and repriced, guardrails added,
full unit economics added, VPS spec finalized.

> **Framing note (added Aug 13, 2026):** this plan predates the pivot from "Chief of Staff"
> to "Company Brain" as the anchor concept — see [`positioning.md`](./positioning.md).
> Operational content below is still current; read CoS-first language with the framing
> inverted (the brain is the product, the assistant is the interface).

## 1. Strategy (one paragraph, read it twice)

We are not building a horizontal AI product for "SMBs." We are a managed AI operations
service for one specific community of non-AI-native businesses — the segment defined by our
warm access through [connector's name]. The buyer doesn't care about AI; they care about
outcomes. We sell done-for-you, one bundled monthly fee, no API keys, no dashboards to
learn. The product compounds through a private skills library: every workflow we fix for
client N ships to clients N+1 automatically. Social media, CRM, and everything "universal"
are add-on modules pulled in by paying clients — never the anchor.

**Why not horizontal:** Microsoft bundles Copilot into M365 Business at $18–21/user. Fyxer,
Motion, Lindy, and a dozen YC companies own the tech-native EA buyer at $20–50/seat. Our
buyer doesn't self-serve, doesn't trial, and buys through peers — which means high-touch
sales, which only pencils at $20k+/year ACV, which means managed service in a concentrated
segment where delivery repeats.

## 2. Pilot scope (build this, nothing else)

**Core product — deployed identically to every client:**

- **Always-on Chief of Staff** on WhatsApp + iMessage + email. Client texts it anytime.
  Drafts emails, answers questions, updates tasks, remembers everything.
- **Morning brief (cron):** inbox triaged and ranked, calendar, open tasks, cash snapshot.
  Delivered 7am to their phone.
- **One money workflow — AR chasing / cash visibility:** pulls QuickBooks aging weekly,
  drafts polite chase emails for approval, "who owes you what" in every brief. Legible,
  measurable ("collected $X faster"), low blast radius.
- **Company brain as a byproduct:** every document/email/invoice the agent touches gets
  indexed. The brain fills itself; we never ask the client to "populate a wiki."

**Explicitly deferred until a paying client asks:** social media module (n8n-based, add-on
pricing), bookkeeping categorization (assistant-mode only — suggestions and anomaly flags,
never autonomous writes; Intuit is commoditizing this inside QuickBooks), CRM integrations,
dashboards, meeting bots.

**Bookkeeping positioning rule:** we are a bookkeeping *assistant*, never the bookkeeper.
Errors surface at tax time; that's a churn event with a fuse. Our defensible ground is
cross-tool synthesis (books + email + calendar + docs in one brain) — the thing Intuit
structurally can't do.

**Training** remains a separate high-margin service line and the trust-building first
purchase for cold-ish prospects.

## 3. Stack (updated)

| Layer | Choice | Change from v1 |
|---|---|---|
| Infra | 1 dedicated VPS per client (spec in §6); Mac Mini on-prem as premium option | Mac Mini = sales story ("your AI lives in your office"), not default — it's an ops liability (residential internet, power, someone unplugs it) |
| Models | Claude via API, routed through OpenRouter (fallback chains, multi-provider, no custom abstraction code) | Kimi swap deferred — saves ~$2/client/month, not worth a second provider dependency at pilot |
| Harness | Hermes (one profile per client = the CoS; finance/compliance/etc. are skills inside it, not separate agents) | Multiple profiles only when a client explicitly wants a separately-addressable persona. Never point two agent processes at one profile (memory corruption). |
| Workflow engine | Hermes native cron for pilot; n8n deferred | Introduce n8n at the first workflow needing deterministic retries/webhooks (social posting, invoice ingestion). Don't run two schedulers per client on day 1. |
| Memory/brain | Postgres + pgvector (not Qdrant at pilot scale) | One client's corpus doesn't justify a dedicated vector DB. Graduate to Qdrant when a corpus demands it. External memory provider = how profiles share a brain later. |
| Connectors (pilot cap: five) | Gmail/Outlook · Google Calendar · Google Drive · QuickBooks/Xero · messaging surface (WhatsApp Cloud API + iMessage via Photon Spectrum) | Cut from pilot: Firecrawl self-hosted, Playwright pool, Reddit/Twitter/review scrapers, Excel MCP, HubSpot/Salesforce/Attio, Monid/Postiz. Each added MCP = a credential, a failure mode, an 11pm debug. Add on paying-client demand; each addition becomes a tap skill so the next client gets it free. |
| Web research | Hosted search API (Brave/Tavily) + one shared scraping box for all clients if we self-host Firecrawl later | Scraped public pages aren't client data; isolation story survives. Never per-client Firecrawl. |
| Skills IP | Private GitHub tap (`hermes skills tap add`), versioned; agent-authored skills reviewed then promoted into the tap | This repo is the company's moat. Client #4's fix propagates to #1–3 with a pull. |

### Model routing table (corrected pricing — v1 doc was right, verified Aug 2026)

| Component | Model | Price (in/out per MTok) | Note |
|---|---|---|---|
| Main agent (CoS, drafting, orchestration) | Sonnet 5 | $2/$10 intro → $3/$15 from Sept 1 | Budget at $3/$15 now. Don't cheap out here. |
| Deep research subagent | Opus 5 | $5/$25 | Isolated context, writes report to file. ~$2.25/run. |
| Quick research | Sonnet 5 | — | |
| Daily brief + triage classification | Haiku 4.5 | $1/$5 | Entire daily pipeline ≈ $2–5/client/month. |
| Memory upkeep / summarization | Haiku 4.5 | — | |
| Analysis/charts | Sonnet 5 | — | Owned by main agent |

Prompt caching (cache reads = 10% of input price) is doing real work: Hermes's base context
(SOUL.md + skills list + memory) is identical every call. Keep it stable; don't churn the
system prompt mid-day.

## 4. Guardrails (non-negotiable, in every deployment and in the client contract)

**Threat model:** an always-on agent that reads inbound email is a prompt-injection
surface — any email is attacker-controlled input to an agent with tools. And our buyer's
trust is unrecoverable after one bad autonomous action.

- **Outbound = draft + approval.** Always, for the first 90 days per client. Emails, social
  posts, financial writes — the agent drafts, the human taps approve on WhatsApp ("Draft
  ready for the Henderson invoice chase — send?"). This is also the trust ramp that converts
  a skeptical owner. Graduation to auto-send is per-workflow, per-client, opt-in, logged.
- **No payment or banking authority. Ever.** No bank credentials, no payment initiation, no
  wire details handling. QuickBooks access is read + draft-invoice only.
- **Read-only by default** on every new integration. Write scopes are granted one workflow
  at a time.
- **Inbound email is untrusted input.** Triage/classification runs on the cheap model with
  no tool access; content from emails never executes as instructions.
  Weird-instruction-in-email → flag to human, never act.
- **Container hardening on.** Hermes Docker backend with namespace isolation; inline shell
  in skills stays off (default) for anything from outside our own tap; community skills are
  never installed on client boxes without review.
- **Blast-radius caps.** Hermes 90-turn task budget stays on (subagents share it).
  Per-client monthly token alert at 3× expected. Allowlisted email domains for auto-drafts
  in week 1–2.
- **Memory write approval on** for the first month per client (prevents the brain learning
  garbage during onboarding).
- **Kill switch + audit.** One command pauses a client's gateway; every outbound action and
  approval is logged. Client can text "pause everything" and it works.
- **Data isolation as contract language:** dedicated server per client, no cross-client data
  flow, no training on client data, deletion on termination.

## 5. Economics

### Per-CEO token spend (modeled, standard Sept-1 pricing, caching on)

| Persona | Behavior | Tokens/mo |
|---|---|---|
| Light | 4 chats/day, 40 emails triaged, 1 deep research/mo | ~$24 |
| Medium ("uses it like an EA") | 12 chats/day, 80 emails, 3 deep research/mo | ~$65 |
| Heavy | 30 chats/day, 150 emails, 8 deep research/mo | ~$153 |

Interactive Sonnet chat = 60–70% of every bill. The daily brief pipeline is $2–5/mo. Error
bars ±2× per individual client (interaction count is the wild variable); budget every client
as Medium. Natural circuit breakers: 90-turn cap, and deep research is human-initiated.

### Full per-client COGS

Fixed infra ≈ $55/mo: VPS $25 · search API $10 · WhatsApp Cloud API $5 ·
backups/monitoring $5 · buffer (TTS, extras) $10.

| Persona | All-in COGS/mo | Margin @ $1,500 | @ $2,000 | @ $2,500 |
|---|---|---|---|---|
| Light | ~$79 | 95% | 96% | 97% |
| Medium | ~$120 | 92% | 94% | 95% |
| Heavy | ~$208 | 86% | 90% | 92% |

### Pricing (bundled — client never sees a VPS bill or API key; the bundle is part of the product)

- **Setup: $4,000–6,000 one-time.** Covers the real cost: 20–30 founder-hours of onboarding
  (integrations, document ingestion, skill tuning, training the CEO). Filters non-serious
  buyers.
- **Retainer: $1,500–2,500/mo by scope** (CoS + brief + AR at the low end; +
  research/social modules higher). Never meter the client — usage anxiety kills adoption,
  adoption is retention.
- **Fair-use clause** in contract, not pitch ("up to N deep-research reports/mo") as
  insurance only.
- **Pitch math:** "$2,000/month all-in ≈ 3–5% of a loaded EA salary, answers at 11pm, and
  after setup it already knows your business."

### Year-1 sketch

10 clients by month 12 @ $5k setup + $2k/mo → ~$196k revenue vs <$9k infra+token COGS
(~96% gross on compute).

### The honest cost line

True COGS is founder time: 20–30 hrs/onboarding + 3–6 hrs/mo/client care. At 10 clients
that's 30–60 hrs/mo — one person's attention. The skills tap is the economic answer: hours
fixing client #3's skill must reduce hours for #4–10. **Tripwire:** if per-client care hours
aren't falling by client #6, we're a consultancy, not a product — stop and fix delivery
before selling more.

## 6. VPS spec per client

- **Standard: 4 vCPU / 8GB RAM / 80GB NVMe** — Hetzner US (Ashburn/Hillsboro), ~$8–15/mo
  (DO/Vultr equivalent $24–48; budget line stays $25).
- CPU is nearly irrelevant (inference is API-side; box idles ~5%). RAM is the constraint,
  and Chromium is why: Hermes browser tasks spike 0.5–1.5GB. Without headroom, one bad
  afternoon OOM-kills Postgres mid-conversation — the one failure "always-on" can't have.
- Runs: Hermes gateway (~0.5GB) + Postgres w/ pgvector (~0.3GB) + OS/Docker (~1GB) +
  browser burst headroom. Add a 2–4GB swapfile as crash cushion.
- Honest minimum after §3 simplifications (no Qdrant, no n8n, no per-client Firecrawl):
  2 vCPU/4GB (~$5–8) — but the delta is ~$7/mo against a $2,000 retainer. Provision 8GB and
  never think about it.
- **Do not consolidate clients onto shared Swarm nodes yet.** Physical isolation is doing
  sales work; 10 small boxes are negligible overhead. Consolidation is the ~50-client
  conversation.

## 7. Build order & pilot success criteria

- **Weeks 1–2:** One Hermes instance on a VPS for ourselves. Wire email + WhatsApp/iMessage.
  Hand-write 3 skills (brief, triage, AR-chase) to learn the format cold. Start the private
  tap.
- **Weeks 3–4:** Deploy client #1 (via connector). Exactly two capabilities live: morning
  brief + AR chasing in draft-only mode. Guardrails §4 all on.
- **Weeks 5–8:** Let the client's actual asks drive the next skills. Promote agent-authored
  skills into the tap after review. Deploy clients #2–3.

**Pilot is a success iff:** (a) client sends the agent an unprompted message 3+ times/week
by week 4 (the only retention signal that matters), and (b) agrees to a price by week 8. If
neither, the workflow choice is wrong — interview, re-cut, redeploy before adding clients.

**60-day GTM test** (from market research): 3 paid design partners from warm intros, or the
access advantage is unproven — pause and reassess rather than push.

## 8. Open questions / risks register

| Risk | Mitigation | Status |
|---|---|---|
| SMB churn graveyard | Managed service, data gravity (brain + books history), annual contracts after pilot | Structural |
| Segment definition still fuzzy | Pin down connector's actual network: industry, size, tools — before week 3 | **Open — decide now** |
| Copilot/Intuit commoditization | Cross-tool synthesis positioning; never compete on single-tool features | Watch |
| Prompt injection via email | §4 guardrails; triage model has no tools | Designed |
| Provider outage vs "always-on" promise | OpenRouter fallback chains | Designed |
| Founder-time ceiling | Skills tap leverage; tripwire at client #6 | Measured monthly |
| Sonnet 5 price step-up Sept 1 | Already budgeted at $3/$15 | Closed |
