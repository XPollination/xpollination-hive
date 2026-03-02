# Completion Abstract: consolidation-supersedes-originals

**Date:** 2026-03-02
**Status:** Complete
**Project:** best-practices

## Outcome

Gardener consolidation now automatically supersedes original duplicate thoughts. After creating a consolidated thought, the gardener marks all source originals with `superseded_by_consolidation:true`. These superseded originals receive a 0.7x score penalty in retrieval, ensuring the consolidation outranks its sources.

## Key Decisions

- **0.7 penalty (not 0.5):** Softer than correction superseding (0.5) because consolidation originals may still have unique value — they're duplicates, not wrong facts.
- **Automatic via think():** Superseding happens in the think() function after consolidation upsert, not as a separate API call.
- **source_ids linking preserved:** Consolidated thought's source_ids link back to originals for traceability.

## Changes

- `api/src/scoring-config.ts`: `supersededByConsolidation: 0.7`
- `api/src/services/thoughtspace.ts`: RetrieveResult interface, think() consolidation logic, retrieve() scoring penalty
- `api/src/routes/memory.ts`: Field in retrieval sources and drill-down response
- Commit: 992aa98

## Test Results

- 6/6 tests pass
- QA PASS, PDSA PASS

## Related Documentation

- PDSA: [2026-03-02-consolidation-supersedes-originals.pdsa.md](../pdsa/2026-03-02-consolidation-supersedes-originals.pdsa.md)
- Related: retrieval-scoring-quality (scoring config pattern), correction-lifecycle-activation (superseding pattern)
