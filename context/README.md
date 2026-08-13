# Product Context

This folder holds the **business/product context** for **Hermes** — managed AI agents for
non-tech-savvy SMBs, deployed per-client, sold to C-suites.

**This repository is the LibreChat fork that becomes the Hermes web interface** (chat +
analytics/dashboard toggle). It is to be stripped down — everything unnecessary for the
Hermes use case gets removed. The code is currently unmodified upstream LibreChat; product
direction lives here in `context/`, not in the code.

`CONTEXT.md` at the repo root is unrelated: it defines codebase domain language for
LibreChat engineering work.

## How to navigate

Read in this order:

1. [`positioning.md`](./positioning.md) — the current framing and pivot log. Always read
   first: it records pivots and overrides older framing in other documents.
2. [`brief.md`](./brief.md) — **the source of truth.** The Hermes project brief: core idea,
   product (background agent + LibreChat-fork interface), model layer, GTM, pilot scope,
   guardrails, economics, build order, risks. Its Appendix resolves every conflict with
   Plan v2 (dictation wins).
3. [`roadmap.md`](./roadmap.md) — the implementation plan (Aug 13, 2026): tracks, phases,
   milestones, and open decisions, grounded in this codebase.
4. [`plan.md`](./plan.md) — Plan v2 (Aug 10, 2026): the underlying research document.
   Superseded by `brief.md` wherever they conflict; still the detailed reference for
   guardrails, unit economics, VPS spec, and pilot mechanics.

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
