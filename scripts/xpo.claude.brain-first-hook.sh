#!/bin/bash
#===============================================================================
# xpo.claude.brain-first-hook.sh — Brain-first protocol enforcement
#
# UserPromptSubmit hook: queries brain with user prompt before processing.
# Injects brain response as additionalContext so Claude has prior knowledge.
# Blocks prompt if brain is unavailable (hard gate).
#
# Requires: AGENT_ROLE env var (set by claude-session.sh)
# Requires: Brain API at localhost:3200
# Requires: node (via nvm PATH)
#
# Exit 0 + JSON = inject brain context
# Exit 2 = block (brain down = no action)
#===============================================================================

set -uo pipefail

ROLE="${AGENT_ROLE:-unknown}"

# --- 1. Read stdin ---
INPUT=$(cat)

# --- 2. Brain health check (fast fail, bash curl) ---
HEALTH=$(curl -s --connect-timeout 2 --max-time 2 "http://localhost:3200/api/v1/health" 2>/dev/null || echo "")

if ! echo "$HEALTH" | grep -q '"ok"'; then
  echo "Brain API unavailable. Cannot proceed without brain-first knowledge check." >&2
  exit 2
fi

# --- 3. Use node for JSON processing and brain query ---
node -e '
const http = require("http");

const input = JSON.parse(process.argv[1]);
const role = process.argv[2];
const prompt = input.prompt || "";
const sessionId = input.session_id || "";

// Skip empty/short prompts
if (!prompt || prompt.length < 5) process.exit(0);

const agentId = `agent-${role}`;
const agentName = role.toUpperCase();

const queryData = JSON.stringify({
  prompt: `Context for ${agentName} agent: ${prompt.slice(0, 500)}`,
  agent_id: agentId,
  agent_name: agentName,
  session_id: sessionId,
  read_only: true
});

const authHeaders = { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(queryData) };
if (process.env.BRAIN_API_KEY) authHeaders["Authorization"] = "Bearer " + process.env.BRAIN_API_KEY;
const req = http.request("http://localhost:3200/api/v1/memory", {
  method: "POST",
  headers: authHeaders,
  timeout: 5000
}, (res) => {
  let body = "";
  res.on("data", (chunk) => body += chunk);
  res.on("end", () => {
    try {
      const data = JSON.parse(body);
      const sources = (data.result?.sources || []).slice(0, 3);
      const highways = (data.result?.highways_nearby || []).slice(0, 3);

      if (sources.length === 0) process.exit(0);

      const brainContext = sources
        .map(s => `[${s.contributor || "unknown"}] ${s.content_preview || ""}`)
        .join("\n");
      const hwText = highways.length > 0 ? highways.join("\n") : "none";

      const context = `## Brain Knowledge (auto-injected by brain-first hook)\n### Relevant Thoughts\n${brainContext}\n### High-Traffic Paths\n${hwText}`;

      console.log(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: context
        }
      }));
    } catch { /* parse error — soft fail */ }
    process.exit(0);
  });
});

req.on("error", () => process.exit(0));
req.on("timeout", () => { req.destroy(); process.exit(0); });
req.write(queryData);
req.end();
' "$INPUT" "$ROLE"
