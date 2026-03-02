# PDSA: Add Dedicated Noise Thought Category

**Date:** 2026-03-02
**Task:** noise-thought-category
**Status:** PLAN

## Plan

### Problem
Gardener categorizes keyword echoes as `state_snapshot` with `topic: "keyword-echo"`. This is semantically wrong — real state snapshots (session handoffs, brain reviews) share the same category as garbage entries (hook echoes, recovery queries, keyword-only strings). Filtering by `state_snapshot` returns a mix of signal and noise.

### Design

#### Category Name: `noise`
Chose `noise` over `query_echo` because it's broader — covers hook echoes, keyword-only strings, context prefixes, not just query echoes. Short, clear, no ambiguity.

#### Change 1: Extend ThoughtCategory type
**File:** `api/src/services/thoughtspace.ts` (line 87)

Add `"noise"` to the union type:
```typescript
export type ThoughtCategory = "state_snapshot" | "decision_record" | "operational_learning" | "task_outcome" | "correction" | "uncategorized" | "transition_marker" | "design_decision" | "noise";
```

#### Change 2: Update VALID_CATEGORIES array
**File:** `api/src/services/thoughtspace.ts` (lines 799-802)

Add `"noise"` to the validation array:
```typescript
const VALID_CATEGORIES: ThoughtCategory[] = [
  "state_snapshot", "decision_record", "operational_learning", "task_outcome",
  "correction", "uncategorized", "transition_marker", "design_decision", "noise",
];
```

#### Change 3: Update gardener skill instructions
**File:** `.claude/skills/xpo.claude.mindspace.garden/SKILL.md`

In the noise flagging step (line 174), instruct gardener to recategorize noise entries with `thought_category: "noise"` instead of leaving them as `state_snapshot` with `topic: "keyword-echo"`. The PATCH `/api/v1/memory/thought/:id/metadata` endpoint already supports category updates.

#### Change 4: Deploy
Restart brain API to activate the new category.

### Interaction with `retrieval-scoring-quality` task
The scoring task adds a penalty for `topic=="keyword-echo"`. This task changes the *category* of those thoughts. Both work independently:
- Scoring penalty reduces rank of noise (scoring layer)
- Category change enables clean filtering (structural layer)
- No conflict — a thought can have `thought_category: "noise"` AND `topic: "keyword-echo"` AND `quality_flags: ["keyword_echo"]`

### NOT Changed
- No Qdrant schema/index changes (thought_category index already exists, accepts any string)
- No API contract changes (category is already a filter parameter)
- No migration — existing noise thoughts can be recategorized by gardener on next deep pass
- Tests for existing categories unchanged

### Files Modified
| File | Change |
|------|--------|
| `api/src/services/thoughtspace.ts` | Add `noise` to type + VALID_CATEGORIES |
| `.claude/skills/xpo.claude.mindspace.garden/SKILL.md` | Instruct gardener to use `noise` category |

### Risks
- Existing `topic: "keyword-echo"` thoughts remain as `state_snapshot` until gardener runs. This is fine — no breakage, just gradual cleanup.
- Scoring task checks `topic=="keyword-echo"` — this still works regardless of category.

## Do
(To be completed by DEV agent)

## Study
- Verify `noise` is accepted by PATCH metadata endpoint
- Verify gardener can recategorize thoughts to `noise`
- Verify `state_snapshot` filter no longer returns keyword echoes after recategorization
- Verify retrieval `filter_category=noise` returns noise entries

## Act
- Run gardener deep pass to recategorize existing keyword-echo thoughts
- Monitor state_snapshot purity after recategorization
