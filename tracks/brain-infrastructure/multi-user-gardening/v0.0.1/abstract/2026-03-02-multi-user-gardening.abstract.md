# Completion Abstract: multi-user-gardening

**Date:** 2026-03-02
**Status:** Complete
**Project:** best-practices

## Outcome

Extended gardener skill with `--space=private|shared` parameter. Default gardens user's private collection. `--space=shared` targets `thought_space_shared`. All gardener API calls (discover, consolidate, refine) pass space parameter. Also fixed `getThoughtById` and `getThoughtsByIds` to be collection-aware, enabling consolidation in shared space.

## Key Decisions

- **Skill-only change (mostly):** SKILL.md updated with space parameter. API code also updated for collection-aware thought retrieval.
- **Governance model A:** Any user can garden the shared brain (simplest, recommended by PDSA, Thomas can revisit later).
- **Collection-aware getThoughtById:** DEV enhanced beyond original design — necessary to make consolidation work in shared space.
- **Default private:** Without `--space`, gardener operates on private collection only.

## Changes

- `.claude/skills/xpo.claude.mindspace.garden/SKILL.md`: Added `--space=private|shared`, SPACE variable, space param in API calls, shared gardening examples
- `api/src/services/thoughtspace.ts`: `getThoughtById()` and `getThoughtsByIds()` now accept optional collection parameter
- `api/src/routes/memory.ts`: Passes resolved collection to getThoughtById for refines/consolidates validation
- Commit: 2ab2ec2

## Test Results

- 12/12 tests pass
- QA PASS, PDSA PASS
- All 7 ACs verified (AC-MUG1 through AC-MUG7)

## Related Documentation

- PDSA: [2026-03-02-multi-user-gardening.pdsa.md](../pdsa/2026-03-02-multi-user-gardening.pdsa.md)
- Part of: multi-user-brain initiative (task 8 of 8 — INITIATIVE COMPLETE)
