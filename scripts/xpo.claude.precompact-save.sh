#!/bin/bash
#===============================================================================
# xpo.claude.precompact-save.sh — Pre-compaction structured brain save
#
# Called automatically by Claude Code PreCompact hook.
# Reads JSON from stdin: { session_id, transcript_path, trigger }
# Saves structured handoff to brain before context is compacted.
#
# Requires: AGENT_ROLE env var set at launch (liaison, pdsa, dev, qa)
# Requires: Brain API at localhost:3200
# Requires: python3 with sqlite3 and json modules
#
# Namespace: xpo.claude.* (Claude-specific environment tooling)
# Iteration: v1 (2026-02-25) — initial implementation
#
# Usage (manual test):
#   echo '{"transcript_path":"/tmp/test.jsonl","trigger":"manual"}' | \
#     AGENT_ROLE=dev bash xpo.claude.precompact-save.sh
#
# Usage (automatic via hook):
#   Configured in ~/.claude/settings.json PreCompact hook
#===============================================================================

set -euo pipefail

ROLE="${AGENT_ROLE:-unknown}"
BRAIN_URL="http://localhost:3200/api/v1/memory"
AGENT_ID="agent-${ROLE}"
AGENT_NAME=$(echo "$ROLE" | tr 'a-z' 'A-Z')
BASE="/home/developer/workspaces/github/PichlerThomas"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# --- Parse stdin JSON for transcript_path and trigger ---
STDIN_JSON=""
if read -t 1 -r STDIN_JSON 2>/dev/null; then
  TRANSCRIPT_PATH=$(echo "$STDIN_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('transcript_path',''))" 2>/dev/null || echo "")
  TRIGGER=$(echo "$STDIN_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('trigger','unknown'))" 2>/dev/null || echo "unknown")
  STDIN_SESSION=$(echo "$STDIN_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('session_id',''))" 2>/dev/null || echo "")
else
  TRANSCRIPT_PATH=""
  TRIGGER="unknown"
  STDIN_SESSION=""
fi

SESSION_ID="${STDIN_SESSION:-$(cat /proc/sys/kernel/random/uuid 2>/dev/null || echo "precompact-$$")}"

# --- Source 1: PM System — active tasks by role ---
TASK_STATE=""
for project_db in \
  "$BASE/xpollination-mcp-server/data/xpollination.db" \
  "$BASE/HomePage/data/xpollination.db" \
  "$BASE/best-practices/data/xpollination.db"; do

  if [ -f "$project_db" ]; then
    result=$(python3 -c "
import sqlite3, sys, os
try:
    db = sqlite3.connect(sys.argv[1])
    rows = db.execute(
        \"SELECT slug, status, json_extract(dna_json, '$.title') FROM mindspace_nodes WHERE json_extract(dna_json, '$.role')=? AND status NOT IN ('complete','cancelled','pending') LIMIT 5\",
        (sys.argv[2],)
    ).fetchall()
    project = os.path.basename(os.path.dirname(os.path.dirname(sys.argv[1])))
    for slug, status, title in rows:
        print(f'{project}: {slug} [{status}] {title or \"\"}')
except: pass
" "$project_db" "$ROLE" 2>/dev/null || echo "")
    if [ -n "$result" ]; then
      TASK_STATE="${TASK_STATE}${result}
"
    fi
  fi
done

# --- Source 2: Transcript — last 5 assistant text blocks ---
RECENT_CONTEXT=""
if [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ]; then
  RECENT_CONTEXT=$(tail -200 "$TRANSCRIPT_PATH" 2>/dev/null | \
    grep '"type":"assistant"' 2>/dev/null | \
    python3 -c "
import sys, json
texts = []
for line in sys.stdin:
    try:
        d = json.loads(line)
        for block in d.get('message',{}).get('content',[]):
            if isinstance(block, dict) and block.get('type') == 'text':
                texts.append(block['text'][:200])
    except: pass
for t in texts[-5:]:
    print(t)
" 2>/dev/null || echo "")
fi

# --- Source 3: Environment ---
MONITOR_PID=$(pgrep -f "agent-monitor.cjs $ROLE" 2>/dev/null || echo "not running")

# --- Assembly: Structured handoff ---
HANDOFF="Pre-compact structured save (${TRIGGER}) for ${AGENT_NAME} agent:
## Active Tasks
${TASK_STATE:-No active tasks found}
## Recent Reasoning
${RECENT_CONTEXT:-No transcript available}
## Infrastructure
Session: ${SESSION_ID}
Monitor PID: ${MONITOR_PID}
Timestamp: ${TIMESTAMP}"

# Truncate to 8000 chars (safety margin under 10K brain limit)
HANDOFF="${HANDOFF:0:8000}"

# --- Contribute to brain (silent, best-effort) ---
curl -s --max-time 3 -X POST "$BRAIN_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${BRAIN_API_KEY:-}" \
  -d "$(python3 -c "
import json, sys
print(json.dumps({
    'prompt': sys.argv[1],
    'agent_id': sys.argv[2],
    'agent_name': sys.argv[3],
    'session_id': sys.argv[4],
    'context': 'pre-compact-save'
}))
" "$HANDOFF" "$AGENT_ID" "$AGENT_NAME" "$SESSION_ID")" >/dev/null 2>&1 || true

exit 0
