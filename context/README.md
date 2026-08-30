# Product Context

This folder holds the **business/product context** for **Silkroad** — managed AI agents for
non-tech-savvy SMBs, deployed per-client, sold to C-suites.

**This repository is the LibreChat fork that becomes the Silkroad web interface** (chat +
analytics/dashboard toggle). The build is underway — see the Status sections in
[`roadmap.md`](./roadmap.md) for what already exists: config strip + Silkroad branding,
chat pinned to OpenAI `gpt-5.5` via three enforced model specs (`silkroad` /
`silkroad-brain` / `silkroad-deep` — Chat, Brain Search, and Deep Research modes switched
from a composer mode selector, with seeded specialist subagents), a live to-do stack, the analytics
dashboard, and the company-brain graph explorer backed by the Obsidian vault in `brain/`
(currently a demo vault on Anduril — swap per client). Product direction still lives here
in `context/`, not in the code.

`CONTEXT.md` at the repo root is unrelated: it defines codebase domain language for
LibreChat engineering work.

## How to navigate

Read in this order:

1. [`positioning.md`](./positioning.md) — the current framing and pivot log. Always read
   first: it records pivots and overrides older framing in other documents.
2. [`brief.md`](./brief.md) — **the source of truth.** The Silkroad project brief: core idea,
   product (background agent + LibreChat-fork interface), model layer, GTM, pilot scope,
   guardrails, economics, build order, risks. Its Appendix resolves every conflict with
   Plan v2 (dictation wins).
3. [`roadmap.md`](./roadmap.md) — the implementation plan (Aug 13, 2026): tracks, phases,
   milestones, and open decisions, grounded in this codebase.
4. [`plan.md`](./plan.md) — Plan v2 (Aug 10, 2026): the underlying research document.
   Superseded by `brief.md` wherever they conflict; still the detailed reference for
   guardrails, unit economics, VPS spec, and pilot mechanics.
5. [`ingestion.md`](./ingestion.md) — brain ingestion spec (Aug 13, 2026): raw log vs.
   curated brain, hot/cold path split, and the selective-ingestion gate. **v1 is
   implemented in this fork** (Mongo raw log + `npm run brain:worker` distiller — see the
   spec's Status section for the deviations); migrates to Silkroad core (Track A) later.
6. [`channels.md`](./channels.md) — channels spec (Aug 30, 2026): how iMessage and email
   feed the raw log and answer the owner, on top of ingestion v1. **Implemented in this
   fork** (`npm run channel:imessage`, `npm run channel:gmail`; see its Status section —
   Gmail awaits OAuth credentials for a live run).

## Rules for agents working in this folder

- **Hierarchy: positioning.md > brief.md > plan.md.** Newest framing wins; conflicts are
  resolved explicitly (see brief.md's Appendix), never by silently editing old documents.
- When the product direction changes, record the pivot in `positioning.md` with a date, and
  add or update dated documents rather than rewriting history.
- Guardrails in `brief.md` §6 are non-negotiable and contractual — never design or propose
  features that violate them.
- Plan v2 numbers (pricing, token costs, competitor pricing) are research-grade estimates —
  re-verify before external use.

## References

- Market-research form responses: https://docs.google.com/forms/d/1M0c2LkYeOIC8zqcyduq4De_MK2DXfo2-mpczvMj0XdQ/edit#responses
