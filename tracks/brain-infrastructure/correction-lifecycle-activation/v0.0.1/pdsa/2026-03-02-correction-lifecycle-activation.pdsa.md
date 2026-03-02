# PDSA: Correction Lifecycle Activation

**Date:** 2026-03-02
**Task:** correction-lifecycle-activation
**Status:** PLAN

## Plan

### Problem
The correction lifecycle mechanism exists in code but was never activated on real data. The Neuroimaginations-Coach case is the test case:

- **f15a0a60** — Original wrong thought: "Neuroimaginations-Coach Thomas Pichler certification coaching qualification" (uncategorized, score 0.76, just keywords — Thomas is NOT a certified Neuroimaginations-Coach)
- **8bdaa9bc** — Correction #1: "CRITICAL CORRECTION — Thomas Pichler is NOT a certified Neuroimaginations-Coach..." (uncategorized, score 0.74, full detail)
- **f45935fa** — Correction #2: "CRITICAL CORRECTION: Thomas Pichler is NOT a Zertifizierter Neuroimaginations-Coach..." (uncategorized, score 0.72, full detail with actual qualifications listed)
- **cf864910** — Already categorized as `noise` (query-echo). No action needed.
- **21cfafc6** — Keyword echo: "Neuroimaginations-Coach correction old facts reinforcement..." (uncategorized). Should be categorized as noise.

**Current state:** All three substantive thoughts are `uncategorized`. The original wrong thought ranks #1 (0.76) above both corrections (0.74, 0.72). The scoring engine changes from `retrieval-scoring-quality` task (superseded_by_correction: -50%, correction category: +30%) exist but have no data to act on.

### Design

#### Gap: PATCH metadata lacks `superseded_by_correction` support

The existing `PATCH /api/v1/memory/thought/:id/metadata` endpoint only accepts `thought_category` and `topic`. To retroactively mark thoughts as superseded, we need to extend it.

**Why retroactive support is needed:** The automatic superseding mechanism (lines 263-275 of `thoughtspace.ts`) only fires when a new correction thought is contributed with `supersedes: [id]`. These corrections were contributed before that mechanism existed. We need a way to fix existing data.

#### Change 1: Extend PATCH metadata endpoint
**File:** `api/src/services/thoughtspace.ts` — `updateThoughtMetadata()`

Add `superseded_by_correction` boolean field:

```typescript
export async function updateThoughtMetadata(
  thoughtId: string,
  fields: { thought_category?: string; topic?: string; superseded_by_correction?: boolean },
): Promise<boolean> {
  // ... existing validation ...

  const payload: Record<string, unknown> = {};
  if (fields.thought_category) payload.thought_category = fields.thought_category;
  if (fields.topic !== undefined) payload.topic = fields.topic;
  if (fields.superseded_by_correction !== undefined) payload.superseded_by_correction = fields.superseded_by_correction;

  // ... existing setPayload call ...
}
```

**File:** `api/src/routes/memory.ts` — PATCH route

Update type and destructure:

```typescript
app.patch<{ Params: { id: string }; Body: { thought_category?: string; topic?: string; superseded_by_correction?: boolean } }>(
  "/api/v1/memory/thought/:id/metadata",
  async (request, reply) => {
    const { thought_category, topic, superseded_by_correction } = request.body ?? {};

    if (!thought_category && topic === undefined && superseded_by_correction === undefined) {
      return reply.status(400).send({...});
    }

    const updated = await updateThoughtMetadata(id, { thought_category, topic, superseded_by_correction });
    // ...
  },
);
```

**Validation:** `superseded_by_correction` must be boolean. No other validation — it's a simple flag.

#### Change 2: Apply data fixes (DEV executes via curl)
After Change 1 is deployed, execute these PATCH calls:

```bash
# 1. Mark original wrong thought as superseded
curl -X PATCH http://localhost:3200/api/v1/memory/thought/f15a0a60-d9c9-4635-a460-5941842a357f/metadata \
  -H "Content-Type: application/json" \
  -d '{"superseded_by_correction": true}'

# 2. Categorize correction #1
curl -X PATCH http://localhost:3200/api/v1/memory/thought/8bdaa9bc-6c2f-4140-af50-073c85fbe239/metadata \
  -H "Content-Type: application/json" \
  -d '{"thought_category": "correction"}'

# 3. Categorize correction #2
curl -X PATCH http://localhost:3200/api/v1/memory/thought/f45935fa-9890-4b13-a557-d1996e6b1219/metadata \
  -H "Content-Type: application/json" \
  -d '{"thought_category": "correction"}'

# 4. Categorize keyword echo as noise
curl -X PATCH http://localhost:3200/api/v1/memory/thought/21cfafc6-b72d-4c38-b281-fb0717d00850/metadata \
  -H "Content-Type: application/json" \
  -d '{"thought_category": "noise", "topic": "keyword-echo"}'
```

#### Expected scoring after activation
With `retrieval-scoring-quality` scoring config applied:
- **f15a0a60** (original): 0.76 × 0.5 (superseded_by_correction) = **0.38** — drops to bottom
- **8bdaa9bc** (correction #1): 0.74 × 1.3 (correction category boost) = **0.96** — rises to top
- **f45935fa** (correction #2): 0.72 × 1.3 = **0.94** — rises to #2
- **21cfafc6** (noise): filtered out entirely by noise exclusion

### Files Modified
| File | Change |
|------|--------|
| `api/src/services/thoughtspace.ts` | Add `superseded_by_correction` to `updateThoughtMetadata()` signature and payload |
| `api/src/routes/memory.ts` | Add `superseded_by_correction` to PATCH route type and destructure |

### NOT Changed
- Scoring engine (handled by retrieval-scoring-quality task)
- Contribution flow (automatic superseding on new corrections already works)
- Brain MCP tools
- Gardener

### Risks
- **Data changes are permanent** — setting `superseded_by_correction: true` on the wrong thought requires a manual PATCH to undo. Low risk since thought IDs are verified.
- **No rollback for category changes** — can be undone by PATCHing back to `uncategorized`. Low risk.

## Do
(To be completed by DEV agent)

## Study
- Query "Thomas Pichler qualifications" returns corrections in top 2 positions
- Original wrong thought ranks below corrections
- Keyword echo thought excluded from results (noise)
- PATCH endpoint accepts superseded_by_correction boolean

## Act
- Document correction lifecycle process for future use
- Monitor: do agents stop propagating the wrong Neuroimaginations-Coach claim?
- Consider: automated correction detection (thoughts with "CRITICAL CORRECTION" prefix)
