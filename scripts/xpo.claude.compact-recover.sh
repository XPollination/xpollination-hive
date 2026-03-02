#!/bin/bash
#===============================================================================
# xpo.claude.compact-recover.sh — Post-compaction recovery via brain
#
# Called automatically by Claude Code SessionStart hook (matcher: "compact").
# Stdout is injected into the agent's context after compaction completes.
#
# Requires: AGENT_ROLE env var set at launch (liaison, pdsa, dev, qa)
# Requires: Brain API at localhost:3200
#
# Namespace: xpo.claude.* (Claude-specific environment tooling)
# Iteration: v1 (2026-02-25) — initial implementation
#
# Usage (manual test):
#   AGENT_ROLE=liaison bash xpo.claude.compact-recover.sh
#
# Usage (automatic via hook):
#   Configured in ~/.claude/settings.json SessionStart hook
#===============================================================================

ROLE="${AGENT_ROLE:-unknown}"
BRAIN_URL="http://localhost:3200/api/v1/memory"
SESSION_ID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || echo "compact-$$")
AGENT_ID="agent-${ROLE}"
AGENT_NAME=$(echo "$ROLE" | tr 'a-z' 'A-Z')

# Check brain health (fast fail)
HEALTH=$(curl -s --connect-timeout 2 --max-time 5 "${BRAIN_URL%/memory}/health" 2>/dev/null)
if ! echo "$HEALTH" | grep -q '"ok"'; then
  echo "## Post-Compaction Recovery (brain unavailable)"
  echo ""
  echo "Brain API is not reachable. Run /xpo.claude.monitor ${ROLE} to fully recover."
  echo "Your role: ${AGENT_NAME}. Resume your current task."
  exit 0
fi

# Query brain for role recovery
RECOVERY=$(curl -s --max-time 10 -X POST "$BRAIN_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${BRAIN_API_KEY:-}" \
  -d "{\"prompt\": \"Recovery after context compaction for ${ROLE} agent. Role definition, current responsibilities, active task state, and key operational rules.\", \"agent_id\": \"${AGENT_ID}\", \"agent_name\": \"${AGENT_NAME}\", \"session_id\": \"${SESSION_ID}\", \"read_only\": true}" 2>/dev/null)

# Query brain for current task state
TASKS=$(curl -s --max-time 10 -X POST "$BRAIN_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${BRAIN_API_KEY:-}" \
  -d "{\"prompt\": \"Current task state, in-flight work, and recent decisions across all projects for ${ROLE} agent\", \"agent_id\": \"${AGENT_ID}\", \"agent_name\": \"${AGENT_NAME}\", \"session_id\": \"${SESSION_ID}\", \"read_only\": true}" 2>/dev/null)

# Extract source content previews (top 3 from each query)
RECOVERY_SOURCES=$(echo "$RECOVERY" | grep -o '"content_preview":"[^"]*"' | head -3 | sed 's/"content_preview":"//;s/"$//' || echo "none")
TASK_SOURCES=$(echo "$TASKS" | grep -o '"content_preview":"[^"]*"' | head -3 | sed 's/"content_preview":"//;s/"$//' || echo "none")

# Output recovery context — this gets injected into the agent's conversation
cat <<RECOVERY_EOF
## Post-Compaction Recovery (auto-injected by xpo.claude.compact-recover.sh)

**You are the ${AGENT_NAME} agent.** Context was compacted. Here is your recovered state:

### Role Recovery (from brain)
${RECOVERY_SOURCES}

### Task State (from brain)
${TASK_SOURCES}

### Instructions
- Your identity: ${AGENT_NAME} agent in 4-agent tmux session (claude-agents)
- CLAUDE.md and --append-system-prompt survived compaction — your base instructions are intact
- Brain recovered your role and task context above
- If this recovery is insufficient, run: /xpo.claude.monitor ${ROLE}
- Continue your current work. Check PM system for active tasks if needed.
RECOVERY_EOF
