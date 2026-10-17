---
name: security-audit
description: Perform an evidence-driven security review of Appins authentication, sessions, CSRF, authorization, database access, secrets, TLS, webhooks, rate limiting, and provider integrations. Use before security-sensitive changes or release reviews.
---

# Appins Security Audit

## Goal
Find and prioritize exploitable weaknesses in the actual implementation, not hypothetical issues based on names or architecture notes. Follow the repository's `AGENTS.md`.

## Method
1. Map trust boundaries: browser ↔ API, API ↔ PostgreSQL, API ↔ Meta/Instagram, API ↔ Telegram, background jobs, CI, and deployment/proxy boundaries.
2. Inspect implementation, call sites, tests, configuration schemas, migrations, and relevant docs. Trace attacker-controlled input to sensitive sinks and verify the authorization decision at the point of use.
3. Build a threat-specific checklist:
   - Authentication/session: cookie flags, expiry, rotation, revocation, fixation, logout, concurrent sessions, missing/invalid secrets.
   - CSRF: state-changing routes, cookie policy, Origin/Referer absence or mismatch, content types, proxy behavior, and non-browser clients.
   - Authorization/IDOR: owner context at every repository/service boundary, object IDs from user input, background-job actor context.
   - Injection/input: parameterized SQL, schema validation, path/URL construction, unsafe deserialization, command execution, output encoding.
   - Secrets/crypto: explicit purpose-specific keys, entropy/length, key rotation strategy, authenticated encryption, nonce handling, no plaintext token persistence or log leakage.
   - Network/TLS: certificate and hostname verification, timeout, redirect behavior, SSRF exposure, retry bounds, response-size limits.
   - Rate limiting: key selection, proxy/IP trust, resource exhaustion, multi-process/multi-replica behavior, cleanup and memory bounds.
   - Webhooks: signature verification over the exact raw payload where required, replay/idempotency handling, timestamp policy, constant-time comparison where applicable.
   - Data safety: tenant/owner scoping, migration locking, transaction boundaries, retention and sensitive logs.
   - CI/supply chain: token permissions, untrusted PR code, action pinning, dependency lockfile, secret exposure.
4. For each issue, record:
   - severity (Critical/High/Medium/Low/Informational) and rationale;
   - exact file and line(s);
   - preconditions and realistic impact;
   - confirmed vs suspected vs not verified;
   - reproducible steps or a regression test;
   - minimal remediation and residual risk.
5. Check whether an existing control truly mitigates the risk. Do not treat SameSite as a universal CSRF solution, TLS encryption as certificate verification, a unit test as live-provider proof, or an in-memory limiter as distributed.
6. If fixing is requested, first write/identify a failing regression test, implement the smallest safe fix, run relevant checks, and inspect the final diff. If only an audit is requested, do not modify files.

## Output format
1. Scope and files examined.
2. Findings ordered by risk; explicitly say if no confirmed issue was found in a category.
3. Tests/commands actually run and results.
4. Assumptions, blind spots, and residual risk.
5. Recommended next actions, ranked by risk reduction and implementation cost.

## Non-goals
- Do not claim a complete penetration test from code review.
- Do not infer exploitable behavior without tracing the relevant path.
- Do not disable security controls to make tests pass.
- Do not disclose or copy real credentials into reports.
