# PDSA: Domain Summary Discovery

**Date:** 2026-03-02
**Task:** domain-summary-discovery
**Status:** PLAN

## Plan

### Problem
Gardener creates domain summaries but they don't surface via vector search — query embeddings for "domain summary" don't match the content well. Agents can't discover what domain summaries exist without knowing exact thought_ids. No structural discovery mechanism exists.

### Options Evaluated
| Option | Discoverability | Effort | Stale Risk |
|--------|----------------|--------|------------|
| Dedicated API endpoint | Excellent | Low | None |
| Index meta-thought | Good | Medium | High |
| Naming convention only | Fair | Very low | None |

### Design: Option 1 + 3 (Endpoint + Convention)

#### Change 1: Add `domain_summary` to ThoughtCategory
**File:** `api/src/services/thoughtspace.ts` (line 87)

Add `"domain_summary"` to the ThoughtCategory union type. This enables Qdrant filtering.

#### Change 2: New `listDomainSummaries()` function
**File:** `api/src/services/thoughtspace.ts`

Follow the existing `listUncategorizedThoughts()` pattern (lines 828-858):

```typescript
export async function listDomainSummaries(
  limit: number = 50,
  offset?: string | number
): Promise<{ thoughts: Array<{thought_id: string; topic: string; content_preview: string; access_count: number; created_at: string}>; next_offset?: string | number }> {
  const scrollResult = await client.scroll(COLLECTION, {
    filter: {
      must: [
        { key: "thought_category", match: { value: "domain_summary" } },
      ],
    },
    limit,
    with_payload: true,
    with_vector: false,
    ...(offset !== undefined ? { offset } : {}),
  });

  return {
    thoughts: scrollResult.points.map(p => ({
      thought_id: String(p.id),
      topic: (p.payload?.topic as string) ?? "unknown",
      content_preview: ((p.payload?.content as string) ?? "").slice(0, 120),
      access_count: (p.payload?.access_count as number) ?? 0,
      created_at: (p.payload?.created_at as string) ?? "",
    })),
    next_offset: scrollResult.next_page_offset ?? undefined,
  };
}
```

#### Change 3: New endpoint `GET /api/v1/memory/domains`
**File:** `api/src/routes/memory.ts`

Follow the `GET /api/v1/memory/thoughts/uncategorized` pattern (lines 557-573):

```typescript
app.get("/api/v1/memory/domains", async (request, reply) => {
  const { limit, offset } = request.query;
  const result = await listDomainSummaries(
    Math.min(parseInt(limit ?? "50", 10) || 50, 100),
    offset ? (isNaN(Number(offset)) ? offset : Number(offset)) : undefined
  );
  return reply.send(result);
});
```

#### Change 4: Deploy
Run deployment script to activate changes on the live brain API.

#### Naming Convention (Already in place)
Gardener SKILL.md (line 259) already documents: domain summaries start with `"DOMAIN SUMMARY (domain-slug):"`. No code change needed — this is the fallback discovery mechanism for agents that don't use the API.

### NOT Changed
- No Qdrant schema changes (thought_category is already indexed)
- No changes to gardener logic (it already creates summaries)
- No MCP tool changes (agents use curl or the API directly)
- No changes to the main POST /api/v1/memory endpoint

### Files Modified
| File | Change |
|------|--------|
| `api/src/services/thoughtspace.ts` | Add `domain_summary` to ThoughtCategory, new `listDomainSummaries()` |
| `api/src/routes/memory.ts` | New `GET /api/v1/memory/domains` endpoint |

### Risks
- If no thoughts have `thought_category: "domain_summary"` yet, the endpoint returns empty. This is fine — gardener will populate on next deep pass.
- Naming convention alone would be insufficient (vector search unreliable for structural queries).

## Do
(To be completed by DEV agent)

## Study
- `curl http://localhost:3200/api/v1/memory/domains` returns list of domain summaries
- New domain summaries added by gardener appear automatically
- Existing domain summaries (if any with correct category) are listed
- Endpoint handles empty results gracefully

## Act
- Wire `GET /domains` into MCP tool or agent skills for easy agent access
- Monitor if agents actually use the endpoint vs convention
