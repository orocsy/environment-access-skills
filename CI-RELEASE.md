# CI and release: what runs on a push (environment-access-skills)

The rule, the same in every repository: a push or merge runs only the work that can find something
for that change. Audit of 25 Nov 2026; the cross-repo table is in coachflow `docs/ops/CI-RELEASE-AUDIT.md`.

No Vercel and no deploy. Public repository, so the minutes are free; the runs still double up.

## What fires

68 runs from 30 Oct to 25 Nov. `test.yml` ran on `push` to every branch and on `pull_request`,
so every push to a PR branch ran the Ubuntu + Windows matrix twice (32 branch-push runs beside 30 PR runs).

| Workflow | Fires on | Filter today | Change | Expected saving |
| --- | --- | --- | --- | --- |
| `test.yml` (Ubuntu + Windows, browser handoff) | push any branch, PR, manual | none | push only `main`; PRs only when ready for review; `paths-ignore` prose (`docs/**/*.md`, `research_notes/**`, `reports/**`, `README.md`, `AGENTS.md`, `LICENSE`); concurrency | ~half the runs (the duplicate branch pushes), plus docs-only changes |

Tests read `docs/stack-setup/example.stack.yaml` and the skills' own files, so only Markdown under
`docs/` is skipped and `skills/**` always runs.

## Needs Nina

Nothing. No dashboard, plan or secret change.
