---
name: incident-debugging
description: Diagnose Appins defects and operational incidents using reproducible evidence, bounded hypotheses, logs without secrets, and minimal reversible changes. Use for flaky CI, production errors, integration failures, or regressions.
---

# Appins Incident Debugging

## Method
1. Establish impact and scope: user-visible symptom, start time/timezone, affected route/job/provider, environment, recent deploys/commits, frequency, and whether data integrity or security may be affected.
2. Preserve evidence before changing state. Use redacted logs and metadata; never request or print passwords, session cookies, access tokens, full connection strings, or customer content.
3. Form a small ranked hypothesis set. For each hypothesis, specify a falsifiable prediction and the safest observation/test that distinguishes it from alternatives.
4. Reproduce with a minimal fixture or test. Compare a known-good baseline to the failing revision where possible.
5. Inspect relevant dependency and environment versions, config parsing, timeout/retry behavior, database connectivity, migrations, and provider response shape. Distinguish a code defect from an environment/provider outage.
6. Make one minimal reversible change at a time. Do not suppress errors, broaden permissions, disable TLS validation, or increase retries blindly.
7. Add a regression test for the root cause. Run targeted tests, then wider checks. If a live system is involved, obtain explicit authorization before mutating data or restarting/deploying services.
8. Report timeline, evidence, confirmed root cause or unresolved hypotheses, exact change, validation results, residual risk, and next diagnostic step.

## Appins-specific cautions
- Distinguish process health, database readiness, and external provider connectivity.
- Consider PostgreSQL connection pool saturation, migration locks, transaction rollback, and schema/version drift.
- For Meta/Telegram failures, inspect status codes and redacted provider error metadata; do not infer successful publication from a queued job or mock response.
- For intermittent auth/CSRF/rate-limit issues, account for proxy configuration, multiple server instances, clocks, and state stored only in process memory.
- Keep customer and token data out of diagnostics.

## Stop conditions
Pause and ask for authorization before destructive database actions, credential rotation, production deployment, or any operation that could disrupt users. If evidence is insufficient, report uncertainty rather than inventing a root cause.
