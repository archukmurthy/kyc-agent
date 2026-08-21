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

Phase 1-3 IDV changes are constrained to:

- `idv/**`
- `docs/idv/**`
- the two additive `package.json` scripts

Evidence currently changes none of those paths. IDV deliberately does not add
a database migration, edit `.env.example`, or mount routes in `src/setupProxy.js`;
all three are active Evidence merge surfaces or integration concerns.

## Landing sequence

1. Finish and review IDV Phase 1-3 on `codex/standalone-idv`.
2. Rebase the IDV branch onto the then-current `main` before its PR lands.
3. Run `npm run idv:test` and `npm run build` after the rebase.
4. Merge IDV as an additive module. Do not merge Evidence into the IDV branch.
5. Create a separate integration PR after the production secure store is
   selected. That PR receives the next migration number available at that time
   and mounts deployment routes if required.
6. Create the IDV-to-Evidence adapter only after Evidence publishes a stable
   ingestion contract. Keep that adapter in its own commit/PR so either domain
   remains independently revertible.

## Why migration numbering is deferred

The Evidence branch already owns migrations `010` through `013`, while `main`
currently ends at `009`. Adding an IDV `010` in parallel would guarantee a
renumbering conflict. Deferring only the durable repository adapter—not the IDV
domain—removes that artificial consolidation problem.

## Merge audit

Before either branch lands, compare file surfaces:

```powershell
git diff --name-only main...codex/standalone-idv
git diff --name-only main...feature/evidence-platform
```

Any overlap beyond an intentionally coordinated integration file should stop
the merge and be separated into a follow-up commit.
