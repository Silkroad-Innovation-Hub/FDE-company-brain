See CLAUDE.md.

## Product context

This repo is the LibreChat fork becoming the web interface for **Hermes** (managed AI agents
for non-tech-savvy SMBs). Product context lives in `context/` — start with
`context/README.md`, then `context/positioning.md` (current framing, always wins) and
`context/brief.md` (source of truth; `context/plan.md` is superseded research). The code is
unmodified upstream LibreChat for now; product direction comes from `context/`, not the
code. Guardrails in `context/brief.md` §6 are non-negotiable.

## Frontend theming and styling

For frontend work, compose existing `@librechat/client` primitives and variants before adding
feature-local styles. Use semantic theme/Tailwind roles for color and shared appearance; do not
introduce raw palette utilities, hard-coded colors, or arbitrary theme CSS. If the system cannot
express a reusable design need, deepen the shared primitive or versioned theme-token registry
instead of copying classes into a feature. Keep genuine layout and behavior local, and document
why any new custom CSS cannot be expressed by the shared system. See the detailed policy in
`CLAUDE.md` under “Theming and styling.”

When adding or changing code that mutates user documents, invalidate the auth user document cache for affected users. This includes single-user updates and bulk role/user mutations; otherwise OpenID JWT request burst caching can serve a stale `req.user` until its TTL expires.
