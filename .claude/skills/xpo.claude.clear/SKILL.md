---
name: xpo.claude.clear
description: Save state to brain, then /clear for a clean restart
user-invocable: true
allowed-tools: Bash, Read
---

# XPollination Clean Restart

Save concrete session state to brain, then execute /clear for a lag-free restart.

```
/xpo.claude.clear
```

**Why this exists:** Auto-compact causes lag and recovers ~50-70% of context. Brain+/clear is instant and recovers what was explicitly saved. This skill ensures the save is concrete (not vague titles), so the next session can recover fully.

**Experiment evidence (2026-03-01):** Without this skill, brain recovery after /clear only recovered ~30% of needed context. Recovery thoughts were vague titles like "Recovery for liaison agent. Current task state." — useless. Thomas's pre-compact snapshot (thought cb43aecd) with completed/pending/insights structure is the gold standard this skill enforces.

---

## Step 1: Identify Yourself

You need your role to contribute properly. Check your identity from context:
- If you know your role (liaison/pdsa/dev/qa), use it
- If unknown, check: `echo $AGENT_ROLE` or infer from conversation context

Set variables for the contribution:
```
ROLE = your role (liaison, pdsa, dev, qa)
AGENT_ID = agent-{ROLE}
AGENT_NAME = {ROLE} uppercased
```

## Step 2: Build State Snapshot

Before clearing, you MUST assemble a **concrete** state snapshot. Do NOT write vague descriptions. Follow this exact structure:

```
SESSION STATE {date}:
- COMPLETED: {what was finished this session, with specifics}
- PENDING: {what is in progress or waiting, with task slugs if applicable}
- KEY DECISIONS: {decisions made, with rationale}
- KEY INSIGHTS: {learnings, bugs found, patterns discovered}
- NEXT: {what the next session should pick up}
```

**Rules for quality:**
- Every bullet must contain CONCRETE information (names, slugs, file paths, commit hashes)
- "Current task state" is NOT concrete. "v0.0.3 channel restructuring COMPLETE, commit 646d13f" IS concrete.
- If you have nothing meaningful for a section, write "none" — do not pad with vague text
- Max 500 chars total — this is a snapshot, not a novel

## Step 3: Contribute to Brain

Use curl directly (MCP may not be available during skill execution):

```bash
curl -s -X POST http://localhost:3200/api/v1/memory \
  -H "Content-Type: application/json" \
  -d "{\"prompt\": \"$SNAPSHOT\", \"agent_id\": \"$AGENT_ID\", \"agent_name\": \"$AGENT_NAME\", \"context\": \"pre-clear state save\", \"thought_category\": \"state_snapshot\", \"topic\": \"context-management\"}"
```

**Verify storage:** Check the response for `"thoughts_contributed": 1`. If 0, the save failed — do NOT proceed with /clear.

## Step 4: Instruct User to Clear

Only after verified storage, tell the user:

**State saved to brain. Please type `/clear` now to reset context, then run `/xpo.claude.monitor {role}` to recover.**

**CRITICAL: Do NOT output `/clear` on its own line.** Claude Code interprets bare slash commands in agent output as executable commands. Always embed slash commands in a sentence or use inline code formatting. Never output a bare `/clear` or any slash command as standalone text.

---

## Example

Good snapshot:
```
SESSION STATE 2026-03-01:
- COMPLETED: keyword_echo bug fix (commit 646d13f, best-practices), brain API restarted with fix deployed
- PENDING: xpo.claude.clear skill (task #2, in progress)
- KEY DECISIONS: keyword_echo downgraded from gate to flag, MCP is single entry point (no API bypass)
- KEY INSIGHTS: MCP contribute_to_brain was silently rejecting due to keyword_echo + hardcoded agent_id "thomas" + hook auto-queries
- NEXT: finish skill, symlink, test end-to-end
```

Bad snapshot (DO NOT do this):
```
Recovery for liaison agent. Current task state and what to check.
```
