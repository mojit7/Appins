# Appins — Repository Engineering Rules

## Mission and product constraints
- Appins is a single-store Instagram shop assistant with a Persian-first RTL web UI, a server API, PostgreSQL, and Telegram integration.
- Never implement competitor monitoring. Keep Meta/Instagram capabilities within the official API and account permissions actually available.
- Do not claim a provider connection, live publication, metric, successful deployment, or end-to-end integration unless it was observed in a reproducible test or a real authorized environment. Distinguish **tested locally**, **CI-verified**, and **live-verified**.
- Keep credentials and privileged operations on the server. Never place tokens, secrets, or privileged provider credentials in browser code, logs, fixtures, screenshots, or commits.

## Source of truth
- Read the relevant code, tests, package manifests, lockfile, migrations, and docs before proposing changes. Treat repository code and executable configuration as authoritative over stale prose.
- The root `package.json` currently requires Node.js `>=22.12`; `docs/ARCHITECTURE.md` contains an older Node 20 statement. Do not silently choose one: mention the discrepancy when touching runtime/tooling documentation and update it deliberately.
- Use npm workspaces and the committed `package-lock.json`. Use `npm ci` for clean-install verification; never regenerate or change the lockfile merely to make CI pass without explaining why.
- Read `docs/ARCHITECTURE.md`, `docs/IMPLEMENTATION_CHECKLIST.md`, and the relevant domain guide before changing architecture or provider integrations.

## Required workflow
1. **Understand first:** inspect status, branch, recent history, relevant implementation, tests, and existing constraints. Do not assume a file or feature exists based on a plan or checklist.
2. **State the hypothesis:** identify the concrete behavior/risk, threat or failure model, affected boundary, and expected observable result.
3. **Plan a minimal change:** preserve public API and data compatibility unless a breaking change is explicitly requested. Prefer small, reviewable diffs.
4. **Test the behavior:** add or update regression tests that fail before the fix and pass after it. Include negative, boundary, and failure-path cases for security-sensitive changes.
5. **Verify honestly:** run the narrowest relevant tests first, then repository checks where feasible: `npm ci`, `npm run typecheck`, `npm run build`, `npm test`, and `npm audit --audit-level=high`. Report the exact command and outcome. If unavailable, say **not run** and why; never infer a pass.
6. **Review independently:** inspect the final diff for security regressions, unintended scope, missing tests, secret leakage, generated files, and documentation drift.
7. **Report:** summarize changed files, rationale, tests with results, residual risks, and any operator action needed.

## Security invariants
- Validate all untrusted input at boundaries; use parameterized SQL and server-side authorization checks.
- Treat authentication, authorization, session lifecycle/revocation, CSRF, rate limiting, webhooks/signatures, cryptography, TLS, migrations, and external API calls as security-sensitive.
- Never weaken certificate validation, authorization, CSRF controls, audit checks, or tests to obtain a green build. If a behavior is intentionally configurable, explain safe and unsafe modes and their deployment implications.
- Avoid logging secrets, session identifiers, access tokens, request bodies containing sensitive data, or full database URLs.
- For session/CSRF decisions, explicitly reason about missing Origin/Referer, cross-site requests, cookie attributes, reverse proxies, and non-browser clients; do not assume one control replaces another.
- Rate limits and revocation state must be evaluated against the actual deployment topology (single process versus multiple replicas); document limitations rather than claiming distributed enforcement.
- Cryptographic keys must be purpose-specific and configured explicitly. Do not silently reuse a generic session secret as an encryption key or silently fall back to weaker crypto behavior.
- Keep CI permissions least-privilege. Do not add workflows that commit to branches, publish artifacts externally, deploy, or use write permissions unless separately justified and explicitly authorized. Pin third-party Actions to verified full commit SHAs when practical and document the update process.

## Evidence and change control
- Separate **confirmed finding**, **plausible risk**, and **not verified**. For each finding give file/line, impact, preconditions, reproduction or test evidence, remediation, and residual risk.
- Do not claim the repository is secure, production-ready, or compliant based only on static review or passing unit tests.
- Do not merge, deploy, rotate credentials, modify production data, or perform destructive operations without explicit authorization.
- Do not add dependencies unless they solve a demonstrated need; explain maintenance, supply-chain, and runtime costs.
- Prefer official, versioned documentation. Record whether a source is final/stable or draft; drafts can inform future planning but must not be described as a finalized standard.

## Definition of done
A change is done only when its acceptance criteria are explicit, regression coverage is appropriate, relevant checks have real recorded outcomes, the diff is reviewed, docs match behavior, and unresolved risks are disclosed.
