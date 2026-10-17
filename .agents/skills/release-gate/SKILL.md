---
name: release-gate
description: Evaluate whether an Appins change or release is ready based on reproducible builds, tests, security review, migrations, configuration, and explicitly verified operational requirements. Use before merge or deployment decisions.
---

# Appins Release Gate

## Rule
Produce a decision backed by evidence: **PASS**, **PASS WITH EXPLICIT ACCEPTED RISKS**, or **BLOCKED**. A green build alone is not a production-readiness certificate.

## Gate checklist
### Change integrity
- [ ] Confirm branch, base/head, changed-file list, and diff; ensure no unrelated changes or accidental generated files.
- [ ] Confirm docs and tests reflect actual behavior.
- [ ] Confirm no credentials, tokens, private URLs, or sensitive logs are present.

### Reproducibility and code quality
- [ ] `npm ci` succeeds from the committed lockfile.
- [ ] `npm run typecheck` succeeds.
- [ ] `npm run build` succeeds.
- [ ] `npm test` succeeds, including relevant integration tests.
- [ ] `npm audit --audit-level=high` reviewed; all findings have an explicit disposition.
- [ ] Report skipped commands, unavailable services, and non-reproducible checks as not verified.

### Security and behavior
- [ ] Relevant security review and regression tests cover authentication, authorization, session/CSRF, secret handling, TLS, rate limits, webhooks, and external calls as applicable.
- [ ] GitHub Actions permissions are minimal; no unreviewed write/deploy/publish behavior.
- [ ] Database migration and rollback/forward-recovery implications are understood.
- [ ] Configuration schema, `.env.example`, and deployment docs agree; no real secret values are committed.
- [ ] Health/readiness semantics distinguish application health from database/provider availability.
- [ ] Observability does not leak sensitive values and failures are actionable.

### Live-operation boundary
- [ ] Any claim of Meta/Instagram, Telegram, database-host, or deployment success is backed by a real authorized environment and recorded evidence.
- [ ] Test credentials and sandbox mocks are not described as production verification.
- [ ] Rollback/recovery, operator owner, and required environment variables are documented for releases that need them.

## Decision procedure
1. Mark every checklist item PASS, FAIL, or NOT VERIFIED; never leave an implicit status.
2. A failed mandatory check or unresolved critical/high-risk issue blocks release unless an authorized risk owner explicitly accepts a documented exception.
3. Missing live credentials may be acceptable for a code-only PR, but live functionality must remain marked NOT LIVE-VERIFIED.
4. State evidence and date/context for each decision. Avoid unsupported claims of compliance, security, or readiness.
5. Do not merge or deploy as part of this skill unless the user explicitly authorized that action.

## Report
Decision; evidence per gate; unresolved risks; exact commands and results; manual/operator actions; rollback considerations.
