---
name: dependency-audit
description: Review Appins npm dependencies, lockfile integrity, lifecycle scripts, advisories, Node compatibility, and GitHub Actions supply-chain exposure. Use for dependency updates and before release.
---

# Appins Dependency and Supply-Chain Review

## Workflow
1. Inspect root/workspace package manifests, `package-lock.json`, Node engine declarations, CI workflows, and dependency-update configuration before recommending changes.
2. Verify the supported runtime from executable configuration. Flag drift between docs and package metadata instead of guessing.
3. Use `npm ci` to verify lockfile reproducibility. Never use `npm install` as a silent repair in CI or commit a generated lockfile without explaining the dependency change.
4. Run `npm audit --audit-level=high` and report the exact result. Distinguish direct/transitive dependencies, production/development reachability, advisory severity, fixed versions, and whether the vulnerable code path is used. Do not dismiss an advisory solely because it is transitive or dev-only.
5. For any proposed upgrade, check changelogs and official package documentation, compatibility with the current Node engine, workspace constraints, and breaking changes. Prefer the smallest compatible update and preserve lockfile consistency.
6. Inspect GitHub Actions:
   - least-privilege top-level and job-level permissions;
   - whether untrusted pull-request code can access secrets or write tokens;
   - third-party Actions pinned to full, verified commit SHAs when practical;
   - explicit Node version and npm cache correctness;
   - no implicit publishing, branch commits, or deployment side effects.
7. Do not claim an SBOM, provenance, signature verification, or vulnerability remediation exists unless the workflow produces it and its result is inspected.
8. Never fix an audit by blindly applying `npm audit fix --force`, removing packages without call-site analysis, or lowering the audit threshold.

## Output
- Findings grouped by severity and reachability.
- Evidence: manifest/lockfile/workflow path, advisory identifier/link, affected and fixed versions.
- Commands run and exact outcomes.
- Minimal recommended update, compatibility risks, and remaining uncertainty.
