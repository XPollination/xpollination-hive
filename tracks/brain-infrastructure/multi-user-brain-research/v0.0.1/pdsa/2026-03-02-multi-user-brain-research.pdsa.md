# PDSA: Multi-User Brain Architecture Research

**Date:** 2026-03-02
**Task:** multi-user-brain-research
**Status:** PLAN

## Plan

### Current Architecture (Single-User)
- **Brain API:** Fastify at localhost:3200, CORS origin:true, no auth
- **Storage:** Qdrant `thought_space` collection (384-dim vectors, cosine distance)
- **MCP:** Port 3201, hardcoded `agent_id="thomas"`, `agent_name="Thomas Pichler"`
- **Namespace:** `knowledge_space_id="ks-default"` exists as payload field but is hardcoded, never filtered
- **Identity:** `agent_id` is metadata only — all agents see all thoughts
- **Isolation:** None. Single collection, single namespace, public API

### Target Architecture (Multi-User)

#### Users
- Thomas (existing brain, ~46 thoughts)
- Maria (test user, Hetzner setup)
- Robin (self-service install later)

#### Spaces
- **PRIVATE** (per-user, default) — personal thoughts, beneficial for individual work
- **XPOLLINATION** (shared, opt-in) — collaboration space, thoughts shared by choice

---

### Research Area 1: Qdrant Isolation

#### Option A: Separate Qdrant Collections per User (Recommended)
```
thought_space_thomas     ← Thomas's private brain
thought_space_maria      ← Maria's private brain
thought_space_robin      ← Robin's private brain
thought_space_shared     ← XPollination shared space
```

**Pros:**
- Hard isolation at storage level — no accidental data leaks
- Each collection has its own index → no cross-user query pollution
- Existing `thought_space` becomes `thought_space_thomas` (rename or alias)
- Qdrant supports unlimited collections on single instance
- Collection-level operations (backup, delete, stats) are clean

**Cons:**
- More collections to manage
- Shared space requires explicit copy (not just a view)
- Collection creation needed per new user

#### Option B: Single Collection with Payload Filtering
Use existing `knowledge_space_id` field + add `owner_id`:
```
thought_space (single collection)
  - knowledge_space_id: "thomas" | "maria" | "robin" | "shared"
  - owner_id: "thomas" | "maria" | "robin"
```

**Pros:**
- Simpler infrastructure — one collection
- Cross-user search possible (shared space + private in one query)
- `knowledge_space_id` already exists (needs implementation)

**Cons:**
- Filter-based isolation is leaky — bugs can expose other users' data
- Single index covers all users — noise from large user bases
- No storage-level backup per user
- Performance degrades with many users (single index)

#### Option C: Separate Qdrant Instances per User
Run multiple Qdrant processes on different ports.

**Pros:** Complete process-level isolation
**Cons:** Memory overhead (Qdrant per user), port management, deployment complexity. Overkill for <10 users.

**Recommendation: Option A** — Separate collections. Hard isolation, clean operations, manageable for 3-10 users. `knowledge_space_id` can be used within a user's collection for sub-namespacing (e.g., `ks-work`, `ks-personal`).

---

### Research Area 2: Brain API Routing

#### Option A: Single API with User-Context Routing (Recommended)
```
POST /api/v1/memory
Headers: X-User-Id: thomas   (or via API key)
Body: { prompt, agent_id, agent_name, space: "private"|"shared", ... }
```

API reads user from auth header, routes to correct Qdrant collection:
- `space: "private"` (default) → `thought_space_{user_id}`
- `space: "shared"` → `thought_space_shared` (with `contributor_id: user_id`)

**Changes needed:**
1. Add auth middleware extracting user from API key
2. Make `COLLECTION` dynamic based on user context
3. Add `space` parameter to request schema
4. Route think/retrieve to correct collection
5. Shared space contributions attributed to user

**Pros:**
- Single deployment, single port
- Shared logic (scoring, gardening, etc.) reused
- User routing is a thin layer on top

**Cons:**
- All users share one process — crash affects everyone
- Auth layer must be bulletproof (routing to wrong collection = data leak)

#### Option B: Separate API Instances per User
```
thomas:  localhost:3200
maria:   localhost:3210
robin:   localhost:3220
shared:  localhost:3230
```

**Pros:** Process isolation
**Cons:** Port management, 4+ processes for 3 users, duplicated code, memory overhead

**Recommendation: Option A** — Single API with user routing. Add `space` parameter and auth middleware. Dynamic collection resolution.

---

### Research Area 3: Authentication

#### Design: API Key Authentication

Each user gets a unique API key (UUID v4). Keys are stored in a `users` table (SQLite, same DB as query_log).

```sql
CREATE TABLE users (
  user_id TEXT PRIMARY KEY,           -- "thomas", "maria", "robin"
  display_name TEXT NOT NULL,
  api_key TEXT UNIQUE NOT NULL,       -- UUID v4 (e.g., "a3f8b2c1-...")
  ssh_fingerprint TEXT,               -- Optional: SSH key fingerprint for future verification
  qdrant_collection TEXT NOT NULL,    -- "thought_space_thomas"
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  active BOOLEAN DEFAULT 1
);
```

**Authentication flow:**
1. Client sends `Authorization: Bearer <api_key>` header
2. Middleware looks up user by api_key
3. Sets `req.user = { user_id, display_name, qdrant_collection }`
4. All downstream handlers use `req.user.qdrant_collection`

**API key generation:**
```bash
# During provisioning
uuidgen  # → "a3f8b2c1-4d5e-6f7a-8b9c-0d1e2f3a4b5c"
```

**Claude Web AI MCP connector integration:**
Each user gets their own MCP config pointing to the same API but with their API key:
```json
{
  "brain": {
    "url": "https://brain.example.com/api/v1/memory",
    "headers": { "Authorization": "Bearer <user-api-key>" }
  }
}
```

**SSH fingerprint mapping (future):**
Store SSH fingerprint alongside API key. When Robin self-installs, the script:
1. Reads Robin's SSH public key fingerprint
2. Generates API key
3. Creates user record with both fingerprint and key
4. Returns API key for MCP config

---

### Research Area 4: Provisioning Script

#### `provision-user.sh` — Run on Hetzner server

```bash
#!/bin/bash
# Usage: ./provision-user.sh <user_id> <display_name>
# Example: ./provision-user.sh maria "Maria Pichler"

USER_ID="$1"
DISPLAY_NAME="$2"
API_KEY=$(uuidgen)
COLLECTION="thought_space_${USER_ID}"

# 1. Create Qdrant collection (same schema as thought_space)
curl -X PUT "http://localhost:6333/collections/${COLLECTION}" \
  -H 'Content-Type: application/json' \
  -d '{
    "vectors": { "size": 384, "distance": "Cosine" },
    "optimizers_config": { "default_segment_number": 2 },
    "replication_factor": 1
  }'

# 2. Create payload indexes (same as thought_space)
for field in contributor_id:keyword thought_type:keyword tags:keyword \
  knowledge_space_id:keyword thought_category:keyword topic:keyword \
  quality_flags:keyword access_count:integer pheromone_weight:float \
  created_at:datetime last_accessed:datetime; do
  IFS=: read name type <<< "$field"
  curl -X PUT "http://localhost:6333/collections/${COLLECTION}/index" \
    -H 'Content-Type: application/json' \
    -d "{\"field_name\": \"${name}\", \"field_schema\": \"${type}\"}"
done

# 3. Register user in SQLite
sqlite3 /path/to/data/xpollination.db <<SQL
INSERT INTO users (user_id, display_name, api_key, qdrant_collection)
VALUES ('${USER_ID}', '${DISPLAY_NAME}', '${API_KEY}', '${COLLECTION}');
SQL

# 4. Create shared collection if not exists
curl -s "http://localhost:6333/collections/thought_space_shared" | grep -q "thought_space_shared" || {
  # Create shared collection with same schema...
}

# 5. Output
echo "User provisioned:"
echo "  ID: ${USER_ID}"
echo "  Collection: ${COLLECTION}"
echo "  API Key: ${API_KEY}"
echo ""
echo "MCP config for Claude Web AI:"
echo '  { "headers": { "Authorization": "Bearer '$API_KEY'" } }'
```

**Test with Maria:** Run script, verify collection created, test API with Maria's key.
**Self-service for Robin:** Robin runs script on his machine, gets API key, configures MCP.

---

### Research Area 5: Shared Spaces

#### Architecture

**Sharing flow:** User marks thought for sharing → thought is COPIED to `thought_space_shared` with attribution:
```
Private thought (thought_space_thomas):
  { content: "...", contributor_id: "thomas", ... }

Shared copy (thought_space_shared):
  { content: "...", contributor_id: "thomas", shared_from: "thought_space_thomas",
    shared_at: "2026-03-02T...", shared_by: "thomas" }
```

**Key design decisions:**
1. **Copy, not move** — thought stays in private brain, copy goes to shared
2. **Independent lifecycle** — shared copy has its own pheromone_weight, access_count, etc.
3. **Attribution preserved** — `contributor_id` tracks original author
4. **No back-propagation** — edits to shared copy don't affect private original

**Sharing mechanism:** Via reflect skill or explicit API call:
```
POST /api/v1/memory/share
Body: { thought_id: "...", from_space: "private", to_space: "shared" }
```

**Access control:**
- All users can READ shared space
- Only original contributor can EDIT their shared thoughts
- Gardening of shared space: designated maintainer (Thomas initially)

---

### Research Area 6: Dependency Graph

```
1. AUTH: Add users table + API key middleware
   ↓
2. ROUTING: Dynamic collection resolution (user → collection)
   ↓
3. PROVISIONING: Create provision-user.sh script
   ↓
4. MIGRATION: Rename thought_space → thought_space_thomas
   ↓
5. MCP: Per-user MCP config (API key in headers)
   ↓
6. TEST: Provision Maria, verify isolation
   ↓
7. SHARING: Add /share endpoint + shared collection
   ↓
8. GARDENING: Multi-space gardener (private + shared)
```

#### Task Breakdown

| # | Task | Depends On | Effort | Description |
|---|------|-----------|--------|-------------|
| 1 | `multi-user-auth` | — | Medium | Users table, API key middleware, auth validation |
| 2 | `multi-user-routing` | 1 | Medium | Dynamic collection in thoughtspace.ts, space parameter |
| 3 | `multi-user-provision-script` | 1, 2 | Small | provision-user.sh: create collection + indexes + user record |
| 4 | `multi-user-migration` | 2 | Small | Rename thought_space → thought_space_thomas, update default |
| 5 | `multi-user-mcp-config` | 1 | Small | Per-user MCP config template, API key in headers |
| 6 | `multi-user-maria-test` | 3, 4, 5 | Small | End-to-end test: provision Maria, verify private/shared isolation |
| 7 | `multi-user-sharing` | 2, 6 | Medium | /share endpoint, thought copying, shared collection management |
| 8 | `multi-user-gardening` | 7 | Medium | Multi-collection gardening: private scope, shared scope, access control |

**Critical path:** 1 → 2 → 3 → 4 → 5 → 6 (Maria test validates everything)
**Parallel:** Tasks 3, 4, 5 can run in parallel after task 2

---

### Architecture Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Qdrant isolation | Separate collections per user | Hard isolation, clean ops, works for <10 users |
| API architecture | Single API with routing | Simpler than multi-instance, shared scoring/gardening |
| Authentication | API key (UUID) per user | Simple, works with MCP headers, SSH fingerprint later |
| Naming convention | `thought_space_{user_id}` | Predictable, scriptable, discoverable |
| Shared space | Copy-to-shared model | Privacy preserved, independent lifecycle |
| Default space | Private | Privacy first — sharing is opt-in |
| Migration | Rename existing collection | Zero data loss, Thomas's existing brain preserved |

### Risks

- **Migration downtime:** Renaming `thought_space` requires all agents to be stopped. Brief (seconds), but needs coordination.
- **API key security:** Keys stored in plaintext SQLite. For 3 trusted users this is acceptable. For public deployment, would need hashing + rate limiting.
- **Shared space gardening:** Who gardens the shared brain? Thomas initially, but needs clear ownership model.
- **Embedding model consistency:** All users must use same embedding model (all-MiniLM-L6-v2). If Robin uses a different model, vectors are incompatible.

## Do
(This is a research deliverable — no DEV implementation. PDSA designs sub-tasks from this research.)

## Study
- Architecture covers all 6 research areas
- 8 sub-tasks identified with dependencies
- Critical path: auth → routing → provision → migrate → test
- Shared space deferred to after basic isolation works

## Act
- Thomas reviews architecture decisions
- Create sub-tasks from the dependency graph
- Start with task 1 (auth) after approval
