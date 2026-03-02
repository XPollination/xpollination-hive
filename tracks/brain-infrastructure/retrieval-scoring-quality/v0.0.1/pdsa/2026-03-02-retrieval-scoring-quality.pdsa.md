# PDSA: Quality-Aware Retrieval Scoring

**Date:** 2026-03-02
**Task:** retrieval-scoring-quality
**Status:** PLAN

## Plan

### Problem
Brain retrieval scoring has partial quality awareness (correction boost, keyword_echo penalty, superseded penalty) but:
1. **Gardener-classified keyword echoes** (`topic=="keyword-echo"`) are NOT penalized — only contribution-time detected echoes (`quality_flags includes "keyword_echo"`) get a mild 0.8 penalty
2. **All scoring multipliers are hardcoded** in `thoughtspace.ts` lines 410-442 — no config file, no way to tune without code changes
3. **Neuroimaginations-Coach problem:** wrong facts may still outrank corrections because the keyword_echo penalty (0.8) is too mild for gardener-confirmed noise

### Root Cause Analysis
Two signals exist for keyword echoes:
- `quality_flags: ["keyword_echo"]` — detected at contribution time via 60% word overlap heuristic (lines 43-53 in memory.ts). Mild signal, false positives possible.
- `topic: "keyword-echo"` — assigned by gardener during curation. Deliberate, high-confidence classification.

The scoring code (thoughtspace.ts:429-433) only checks `quality_flags`, ignoring the stronger gardener signal entirely. The 0.8 multiplier is also too gentle — gardener-confirmed echoes should be penalized more aggressively.

### Design

#### Change 1: Scoring Config File
**New file:** `api/src/scoring-config.ts`

Export a `SCORING_CONFIG` object with all scoring multipliers:

```typescript
export const SCORING_CONFIG = {
  // Penalties
  supersededByRefinement: 0.7,     // Thought has newer refinement
  supersededByCorrection: 0.5,     // Correction marked this wrong
  keywordEchoFlag: 0.8,           // Contribution-time echo detection
  keywordEchoTopic: 0.3,          // Gardener-confirmed echo (stronger)

  // Boosts (pre-cap — all boosts capped at 1.0)
  correctionCategory: 1.3,        // Correction thoughts
  refinementOfSuperseded: 1.2,    // Refinement replacing bad thought
};
```

Why a code module, not JSON: type safety, importable, no file I/O, can add validation later.

#### Change 2: Topic-Based Keyword Echo Penalty
**File:** `api/src/services/thoughtspace.ts` (score adjustment section, ~line 429)

After the existing `quality_flags` check, add:

```typescript
// Stronger penalty for gardener-confirmed keyword echoes
const topic = (thoughtPayload.topic as string) ?? "";
if (topic === "keyword-echo") {
  m.score *= SCORING_CONFIG.keywordEchoTopic; // 0.3
}
```

Stacking: If a thought has BOTH `quality_flags: ["keyword_echo"]` AND `topic: "keyword-echo"`, both penalties apply (0.8 × 0.3 = 0.24). This is correct — doubly-confirmed noise should rank very low.

#### Change 3: Use Config for All Existing Multipliers
**File:** `api/src/services/thoughtspace.ts`

Replace all hardcoded multipliers in lines 410-442 with `SCORING_CONFIG.*` references:
- `0.7` → `SCORING_CONFIG.supersededByRefinement`
- `0.5` → `SCORING_CONFIG.supersededByCorrection`
- `1.3` → `SCORING_CONFIG.correctionCategory`
- `0.8` → `SCORING_CONFIG.keywordEchoFlag`
- `1.2` → `SCORING_CONFIG.refinementOfSuperseded`

#### Change 4: Deploy
Run deployment script to activate changes on the live brain API.

### NOT Changed
- No new Qdrant fields or indexes
- No API contract changes (scores are internal)
- No changes to contribution-time quality assessment
- Pheromone decay and reinforcement logic untouched
- Response format unchanged

### Files Modified
| File | Change |
|------|--------|
| `api/src/scoring-config.ts` | NEW — scoring constants |
| `api/src/services/thoughtspace.ts` | Import config, add topic check, replace hardcoded values |

### Risks
- **Stacking too aggressive?** A thought with both echo flags gets 0.24 final multiplier. If this buries legitimate thoughts, reduce `keywordEchoTopic` to 0.5 in config.
- **No tests exist** — changes verified by manual API queries against known thoughts

## Do
(To be completed by DEV agent)

## Study
- Query brain for "Neuroimaginations-Coach qualification" — correction should appear in top 3
- Query brain for a topic with known keyword echoes — verify echoes score below real content
- Verify no regression: queries without echo/correction thoughts return same results as before
- Verify config values are used (not hardcoded) by checking import in thoughtspace.ts

## Act
- If Neuroimaginations-Coach still doesn't rank in top 3, consider increasing correction boost or decreasing echo penalty
- Monitor retrieval quality over next 2 days for unexpected ranking changes
- Future: consider making config hot-reloadable (env vars or file watch)
