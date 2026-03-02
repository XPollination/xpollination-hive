#!/bin/bash
# Provision a new brain user: creates Qdrant collection, generates API key, registers in SQLite.
#
# Usage: bash api/scripts/provision-user.sh <user_id> <display_name>
#   user_id: lowercase alphanumeric + hyphens (e.g. maria, robin-dev)
#   display_name: human-readable name (e.g. "Maria Pichler")
#
# Environment:
#   QDRANT_URL    — default http://localhost:6333
#   BRAIN_DB_PATH — default data/thought-tracing.db (relative to repo root)

set -euo pipefail

QDRANT_URL="${QDRANT_URL:-http://localhost:6333}"
BRAIN_DB="${BRAIN_DB_PATH:-/home/developer/workspaces/github/PichlerThomas/best-practices/data/thought-tracing.db}"

# --- Validate arguments ---
if [ $# -lt 2 ]; then
  echo "Usage: $0 <user_id> <display_name>"
  echo "  user_id: lowercase alphanumeric + hyphens (e.g. maria)"
  echo "  display_name: quoted name (e.g. \"Maria Pichler\")"
  exit 1
fi

USER_ID="$1"
DISPLAY_NAME="$2"

# Validate user_id format (lowercase letters, numbers, hyphens only)
if ! echo "$USER_ID" | grep -qE '^[a-z0-9-]+$'; then
  echo "ERROR: user_id must be lowercase alphanumeric + hyphens only. Got: $USER_ID"
  exit 1
fi

COLLECTION="thought_space_${USER_ID}"
API_KEY=$(uuidgen)

echo "=== Provisioning User: ${USER_ID} ==="
echo "  Display name: ${DISPLAY_NAME}"
echo "  Collection:   ${COLLECTION}"

# --- Step 1: Create Qdrant collection (384-dim Cosine, idempotent) ---
echo ""
echo "Step 1: Creating Qdrant collection ${COLLECTION}..."
EXISTING=$(curl -s "${QDRANT_URL}/collections/${COLLECTION}" | grep -c '"status":"ok"' || true)
if [ "$EXISTING" = "0" ]; then
  curl -s -X PUT "${QDRANT_URL}/collections/${COLLECTION}" \
    -H "Content-Type: application/json" \
    -d '{
      "vectors": { "size": 384, "distance": "Cosine" },
      "optimizers_config": { "default_segment_number": 2 },
      "replication_factor": 1
    }' | cat
  echo ""

  # Create payload indexes matching thought_space schema
  for FIELD in contributor_id thought_type tags knowledge_space_id thought_category topic quality_flags; do
    curl -s -X PUT "${QDRANT_URL}/collections/${COLLECTION}/index" \
      -H "Content-Type: application/json" \
      -d "{\"field_name\": \"${FIELD}\", \"field_schema\": \"keyword\"}" > /dev/null
  done
  curl -s -X PUT "${QDRANT_URL}/collections/${COLLECTION}/index" \
    -H "Content-Type: application/json" \
    -d '{"field_name": "access_count", "field_schema": "integer"}' > /dev/null
  curl -s -X PUT "${QDRANT_URL}/collections/${COLLECTION}/index" \
    -H "Content-Type: application/json" \
    -d '{"field_name": "pheromone_weight", "field_schema": "float"}' > /dev/null
  for FIELD in created_at last_accessed; do
    curl -s -X PUT "${QDRANT_URL}/collections/${COLLECTION}/index" \
      -H "Content-Type: application/json" \
      -d "{\"field_name\": \"${FIELD}\", \"field_schema\": \"datetime\"}" > /dev/null
  done
  echo "  Created ${COLLECTION} with indexes"
else
  echo "  Collection ${COLLECTION} already exists — skipping creation"
  # Use existing API key if user already registered
  EXISTING_KEY=$(sqlite3 "$BRAIN_DB" "SELECT api_key FROM users WHERE user_id = '${USER_ID}';" 2>/dev/null || echo "")
  if [ -n "$EXISTING_KEY" ]; then
    API_KEY="$EXISTING_KEY"
    echo "  Using existing API key for ${USER_ID}"
  fi
fi

# --- Step 2: Create thought_space_shared (IF NOT EXISTS) ---
echo ""
echo "Step 2: Ensuring thought_space_shared exists..."
SHARED_EXISTS=$(curl -s "${QDRANT_URL}/collections/thought_space_shared" | grep -c '"status":"ok"' || true)
if [ "$SHARED_EXISTS" = "0" ]; then
  curl -s -X PUT "${QDRANT_URL}/collections/thought_space_shared" \
    -H "Content-Type: application/json" \
    -d '{
      "vectors": { "size": 384, "distance": "Cosine" },
      "optimizers_config": { "default_segment_number": 2 },
      "replication_factor": 1
    }' > /dev/null
  echo "  Created thought_space_shared"
else
  echo "  thought_space_shared already exists"
fi

# --- Step 3: Register user in SQLite (INSERT OR IGNORE for idempotency) ---
echo ""
echo "Step 3: Registering user in SQLite..."
sqlite3 "$BRAIN_DB" "INSERT OR IGNORE INTO users (user_id, display_name, api_key, qdrant_collection) VALUES ('${USER_ID}', '${DISPLAY_NAME}', '${API_KEY}', '${COLLECTION}');"
echo "  Registered ${USER_ID} in users table"

# --- Output: MCP config and credentials ---
echo ""
echo "=== Provisioning Complete ==="
echo ""
echo "User:       ${USER_ID}"
echo "Collection: ${COLLECTION}"
echo "API Key:    ${API_KEY}"
echo ""
echo "--- MCP Config (for Claude Web AI) ---"
echo "{"
echo "  \"mcpServers\": {"
echo "    \"xpollination-brain\": {"
echo "      \"url\": \"http://YOUR_HOST:3201/mcp\","
echo "      \"env\": {"
echo "        \"BRAIN_API_KEY\": \"${API_KEY}\","
echo "        \"BRAIN_AGENT_ID\": \"${USER_ID}\","
echo "        \"BRAIN_AGENT_NAME\": \"${DISPLAY_NAME}\""
echo "      }"
echo "    }"
echo "  }"
echo "}"
echo ""
echo "--- Agent Environment Variables ---"
echo "export BRAIN_API_KEY=\"${API_KEY}\""
echo "export BRAIN_AGENT_ID=\"${USER_ID}\""
echo "export BRAIN_AGENT_NAME=\"${DISPLAY_NAME}\""
