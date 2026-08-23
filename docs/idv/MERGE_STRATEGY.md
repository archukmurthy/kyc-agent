# IDV isolation and merge strategy

## Branch topology

```text
main @ 454a040
├── feature/evidence-platform   (C:\kyc-evidence-platform)
└── codex/standalone-idv        (isolated IDV worktree)
```

IDV was branched directly from `main`, not from the active UBO branch and not
from Evidence. The IDV worktree contains no Evidence commits.

## Collision budget

IDV changes remain constrained to:

- `idv/**`
- `docs/idv/**`
- additive `package.json` scripts

Evidence currently changes none of the `idv/**` or `docs/idv/**` paths. IDV does
not edit repository-global `db/migrations/**`, `.env.example`, API routes, or
`src/setupProxy.js`; all are active Evidence merge surfaces. The IDV schema is a
module-local idempotent SQL file and consumes no global migration number.

## Landing sequence

1. Finish and review IDV Phase 1-3 on `codex/standalone-idv`.
2. Rebase the IDV branch onto the then-current `main` before its PR lands.
3. Run `npm run idv:test` and `npm run build` after the rebase.
4. Merge IDV as an additive module. Do not merge Evidence into the IDV branch.
5. Create a separate integration PR to mount deployment routes. It may apply the
   module schema independently or copy it under the next global migration number
   available at that time.
6. Create the IDV-to-Evidence adapter only after Evidence publishes a stable
   ingestion contract. Keep that adapter in its own commit/PR so either domain
   remains independently revertible.

## Why global migration numbering is deferred

The Evidence branch already owns migrations `010` through `013`, while `main`
currently ends at `009`. Adding an IDV global `010` in parallel would guarantee
a renumbering conflict. The module-local
`idv/persistence/migrations/001_idv_module_schema.sql` is an IDV namespace, not
the repository-global sequence. Durable repositories can be validated without
touching Evidence's migration surface.

## Merge audit

Before either branch lands, compare file surfaces:

```powershell
git diff --name-only main...codex/standalone-idv
git diff --name-only main...feature/evidence-platform
```

Any overlap beyond an intentionally coordinated integration file should stop
the merge and be separated into a follow-up commit.
