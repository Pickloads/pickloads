# PickLoads — Engineering Rules

- **Visual reference**: the V4 prototype is FINAL. Convert, never redesign. All colors/spacing/typography come from `@theme` tokens in `src/app/globals.css` — never raw hex in components.
- **Stack is locked** (see README). Next.js pinned to 15.x — do not upgrade to 16. npm `overrides` patch postcss/sharp advisories; keep `npm audit` at 0.
- **Security model**: public-form writes go through server handlers with the service-role key after Zod + Turnstile + rate-limit checks. No anon insert policies. RLS is defense in depth (see `docs/modules/M-01-database.md`).
- **Every module ships with** `docs/modules/M-XX-*.md` covering: what, why, how, DB changes, endpoints, env vars, deployment, extension points.
- **Module gate** (all must pass before a module is "done"): functionality · responsiveness · accessibility (WCAG AA, decision Q7) · SEO · security · `npm run typecheck` · `npm run lint` · `npm run build` clean.
- **TypeScript**: strict, no `any`, no type assertions to silence errors.
- Deviations from Architecture v1.2 must cite an audit finding ID (F-xx/S-xx/U-xx/O-xx) in code comments.
