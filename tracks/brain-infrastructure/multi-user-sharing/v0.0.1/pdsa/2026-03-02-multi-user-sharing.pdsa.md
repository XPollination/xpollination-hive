# PDSA: Multi-User Sharing — /share endpoint + shared collection

**Date:** 2026-03-02
**Task:** multi-user-sharing
**Parent:** multi-user-brain-research
**Depends On:** multi-user-routing (collection resolution), multi-user-maria-test (isolation verified)
**Status:** PLAN

## Plan

### Problem
Users have isolated private brains. There is no way to share a thought from a private brain to the communal `thought_space_shared` collection. The shared collection exists (created by migration/provisioning) but has no mechanism to populate it.

### Design Scope (this task)
1. `POST /api/v1/memory/share` — copy a thought from private to shared
2. Preserve attribution, add sharing metadata
3. Independent lifecycle for shared copy
4. Access control: only the original contributor can share their own thoughts

### Deferred (future tasks)
- Integration with reflection skill (design scope item 7) — separate task
- User-configurable domain privacy settings (design scope item 8) — separate task

### Endpoint: `POST /api/v1/memory/share`

**File:** `api/src/routes/memory.ts` (MODIFIED — add new route)

#### Request
```typescript
interface ShareRequest {
  thought_id: string;     // Qdrant point ID to share (from caller's private collection)
}
```

No `from_space`/`to_space` parameters needed — sharing is always private→shared. The caller's private collection is resolved from their auth token.

#### Response (200 OK)
```json
{
  "success": true,
  "original_thought_id": "uuid-in-private",
  "shared_thought_id": "uuid-in-shared",
  "shared_at": "2026-03-02T16:30:00.000Z"
}
```

#### Error Responses
| Status | Condition |
|--------|-----------|
| 400 | Missing `thought_id` |
| 401 | Invalid/missing auth |
| 404 | Thought not found in caller's private collection |
| 403 | Thought's `contributor_id` doesn't match caller's `user_id` (can only share own thoughts) |
| 409 | Thought already shared (duplicate `shared_from_id` in shared collection) |

### Implementation

#### Step 1: Add route in memory.ts
```typescript
fastify.post("/api/v1/memory/share", async (request, reply) => {
  const user = (request as any).user;
  const { thought_id } = request.body as { thought_id: string };

  if (!thought_id) return reply.code(400).send({ error: "thought_id required" });

  const privateCollection = user.qdrant_collection;
  const result = await shareThought(thought_id, privateCollection, user.user_id);

  if (result.error) return reply.code(result.status).send({ error: result.error });
  return reply.send(result);
});
```

#### Step 2: Add shareThought() in thoughtspace.ts
```typescript
async function shareThought(
  thoughtId: string,
  sourceCollection: string,
  userId: string
): Promise<ShareResult> {
  // 1. Retrieve source thought from private collection
  const points = await client.retrieve(sourceCollection, {
    ids: [thoughtId],
    with_payload: true,
    with_vectors: true
  });
  if (!points.length) return { error: "Thought not found", status: 404 };

  const source = points[0];

  // 2. Verify ownership
  if (source.payload.contributor_id !== userId) {
    return { error: "Can only share your own thoughts", status: 403 };
  }

  // 3. Check for duplicate sharing
  const existing = await client.scroll("thought_space_shared", {
    filter: { must: [{ key: "shared_from_id", match: { value: thoughtId } }] },
    limit: 1
  });
  if (existing.points.length > 0) {
    return { error: "Already shared", status: 409,
             shared_thought_id: existing.points[0].id };
  }

  // 4. Create shared copy with new ID
  const sharedId = crypto.randomUUID();
  const now = new Date().toISOString();

  await client.upsert("thought_space_shared", {
    points: [{
      id: sharedId,
      vector: source.vector,   // Same embedding
      payload: {
        // Core content — preserved from original
        content: source.payload.content,
        contributor_id: source.payload.contributor_id,
        contributor_name: source.payload.contributor_name,
        thought_type: source.payload.thought_type,
        tags: source.payload.tags || [],
        thought_category: source.payload.thought_category,
        topic: source.payload.topic,

        // Sharing metadata — NEW fields
        shared_from_id: thoughtId,           // Original thought ID
        shared_from_collection: sourceCollection,  // Source collection
        shared_by: userId,                   // Who shared it
        shared_at: now,                      // When shared

        // Independent lifecycle — reset
        created_at: source.payload.created_at,  // Preserve original creation time
        last_accessed: now,
        access_count: 0,         // Fresh access tracking
        accessed_by: [],
        access_log: [],
        pheromone_weight: 1.0,   // Fresh pheromone
        co_retrieved_with: [],

        // Preserved categorization
        knowledge_space_id: "ks-shared",
        quality_flags: source.payload.quality_flags || [],
        temporal_scope: source.payload.temporal_scope
      }
    }]
  });

  // 5. Optionally mark original as shared
  await client.setPayload(sourceCollection, {
    points: [thoughtId],
    payload: {
      shared_to: "thought_space_shared",
      shared_copy_id: sharedId,
      shared_at: now
    }
  });

  return {
    success: true,
    original_thought_id: thoughtId,
    shared_thought_id: sharedId,
    shared_at: now
  };
}
```

### Files Modified

| File | Change |
|------|--------|
| `api/src/routes/memory.ts` | ADD: POST /api/v1/memory/share route handler |
| `api/src/services/thoughtspace.ts` | ADD: `shareThought()` function, export it |

### NOT Changed
- Auth middleware (already handles all routes)
- Qdrant schema (new fields are dynamic payload, no schema change needed)
- Provision scripts (thought_space_shared already exists)
- MCP connector (sharing is an API feature, MCP can call it via fetch)

### Acceptance Criteria

| ID | Criterion |
|----|-----------|
| AC-MUS1 | POST /api/v1/memory/share exists and requires auth |
| AC-MUS2 | Returns 400 when thought_id missing |
| AC-MUS3 | Returns 404 when thought not in caller's private collection |
| AC-MUS4 | Returns 403 when thought's contributor_id doesn't match caller |
| AC-MUS5 | Returns 409 on duplicate share attempt |
| AC-MUS6 | Copies thought to thought_space_shared with correct content and vector |
| AC-MUS7 | Shared copy has sharing metadata (shared_from_id, shared_from_collection, shared_by, shared_at) |
| AC-MUS8 | Shared copy has independent lifecycle (fresh pheromone_weight=1.0, access_count=0) |
| AC-MUS9 | Original thought gets shared_to, shared_copy_id, shared_at marked |
| AC-MUS10 | Shared thought retrievable via normal /api/v1/memory with space: "shared" |

### Risks
- **Vector format**: Qdrant `retrieve` with `with_vectors: true` may return vectors in different format than expected by `upsert`. Need to verify vector is passed through unchanged.
- **Large payloads**: Some thoughts have long content. Copy is fine — Qdrant handles large payloads.
- **Race condition on duplicate check**: Two simultaneous shares of same thought could both pass the scroll check. Acceptable for MVP — extremely unlikely in practice.

### Edge Cases
- **Sharing a refinement/consolidation**: Source IDs in the shared copy refer to IDs in the private collection. These won't resolve from the shared collection. Acceptable — shared_from_id provides the lineage link.
- **Sharing a correction**: `corrected_fact`/`correct_fact` fields are preserved in the copy, which is correct behavior.
- **Deleted user's shared thoughts**: If a user is deleted, their shared thoughts remain with their contributor_id. This is correct — attribution survives.

## Do
(To be completed by DEV agent)

## Study
- /share endpoint copies private thought to thought_space_shared
- Attribution preserved (contributor_id unchanged)
- Sharing metadata added (shared_from_id, shared_by, shared_at)
- Independent lifecycle (fresh pheromone, access counters)
- Original marked with shared_to link
- Duplicate sharing prevented (409)
- Ownership check prevents sharing others' thoughts (403)

## Act
- Test: Thomas shares a thought, Maria retrieves from shared space
- Test: Maria tries to share Thomas's thought → 403
- Test: sharing same thought twice → 409
- Next: multi-user-gardening (gardener works across multiple collections)
