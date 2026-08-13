# Positioning (current)

**Last updated: August 13, 2026**

## The product in one line

**Hermes** (working name): managed AI agents for non-tech-savvy SMBs — specialized per-client
agents sharing one context/brain, deployed on a dedicated VPS per company, branded as the
client company's own AI, and sold directly to C-suites via forward-deployed engineering.

## Document hierarchy

[`brief.md`](./brief.md) is the **source of truth** — it synthesizes Amir's dictation
(authoritative) with Plan v2 and resolves every conflict explicitly in its Appendix.
[`plan.md`](./plan.md) survives as research-grade planning (guardrails, economics, VPS spec,
pilot plan) wherever it doesn't contradict the brief.

## Pivot log

- **Aug 13, 2026 (later) — Hermes brief becomes source of truth.** The product is the Hermes
  agent: forward-deployed, per-client specialized agents (finance, ops, …) sharing one
  brain, branded as the client's own AI. Key rulings over Plan v2: the chat↔analytics
  dashboard toggle is a **launch feature** (Plan v2 had deferred dashboards); channels are
  **iMessage + email** (WhatsApp dropped for now, no voice calls); models are
  **cheap-capable via OpenRouter (DeepSeek-class)** with the all-Claude table demoted to a
  benchmark; finance tools are **QuickBooks + Mercury**; and **this repository is the
  LibreChat fork** that gets stripped down into the Hermes web interface. Interface polish
  ("everything should be beautiful") is an explicit product requirement.
- **Aug 13, 2026 (earlier) — "Chief of Staff" → "Company Brain".** The anchor moved from an
  AI chief-of-staff persona to the shared brain / cross-tool synthesis. The Hermes brief
  absorbs and refines this: the brain is the shared context all specialized agents and
  surfaces (web chat, iMessage, email) hit — one brain, one memory.

## What stays true

- Buyer: non-tech-savvy SMB leadership reached through a warm connector's community — never
  horizontal. The buyer doesn't care about AI, doesn't self-serve, doesn't trial; they buy
  outcomes through peers.
- Model: done-for-you managed service, one bundled monthly fee ($4–6k setup, $1.5–2.5k/mo
  retainer), no API keys or server bills visible to the client, never metered.
- Moat: forward-deployed engineering + the private skills library (client N's fix ships to
  N+1) + cross-tool synthesis that single-tool incumbents (Intuit, Copilot) can't do.
- Guardrails in [`brief.md`](./brief.md) §6 are non-negotiable and contractual.
- Bookkeeping rule: assistant, never the bookkeeper — suggestions and anomaly flags only.
- The brain fills itself from what the agents touch; the client never populates a wiki.
- Plan v2 numbers and third-party pricing claims are research-grade — re-verify before
  relying on them externally.
