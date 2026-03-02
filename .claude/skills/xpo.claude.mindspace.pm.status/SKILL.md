---
name: xpo.claude.mindspace.pm.status
description: Programme Management status overview across all projects
user-invocable: true
allowed-tools: Bash, Read
---

# PM Status — Cross-Project Overview

Single command to scan all project databases, present a categorized summary, then drill down into each actionable task one-by-one for human decisions.

```
/xpo.claude.mindspace.pm.status
```

---

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `layer1_enabled` | `true` | Enable Brain Health gardening phase. Set to `false` to skip brain health diagnostic entirely. |

When `layer1_enabled` is `false`, skip Step 1.5 (Brain Health) and proceed directly from Step 1 to Step 2.

---

## Step 1: Scan Projects + Brain Health

Run the pm-status script to scan all project databases AND get brain health in one command:

```bash
node /home/developer/workspaces/github/PichlerThomas/xpollination-mcp-server/viz/pm-status.cjs
```

This returns JSON with:
- `projects`: all tasks from best-practices, xpollination-mcp-server, and HomePage
- `brain_health`: status, recent thought count, highway count, top domains

Parse and present. Brain health section is always included — no separate step needed.

Collect all non-terminal tasks (exclude `complete`, `cancelled`) from the projects output.

Present brain health as a **BRAIN HEALTH** section:

```
=== BRAIN HEALTH ===
Status: healthy | empty | unavailable
Recent thoughts: N
Highways: N
Top domains: domain1, domain2, ...
===
```

If brain health shows issues, Thomas may choose to run a deeper gardening pass (`/xpo.claude.mindspace.garden full deep`).

## Step 2: Phase 1 — Summary Table

Present a compact overview grouped by action type:

```
=== PM STATUS (YYYY-MM-DD HH:MM) ===

DECISIONS NEEDED (approval — approve or rework):
  [1] task-slug (project) — approval+role

REVIEWS PENDING (review+liaison — complete or rework):
  [2] task-slug (project) — review+liaison

IN PIPELINE (no action needed now):
  [3] task-slug (project) — status+role
  [4] task-slug (project) — status+role

--- Summary: N tasks | X approvals | Y reviews | Z in-pipeline ---
```

**Categorization rules:**
- Status `approval` → **DECISIONS NEEDED** (human approves or sends to rework)
- Status `review` AND role `liaison` → **REVIEWS PENDING** (human completes or reworks)
- All other non-terminal → **IN PIPELINE** (informational, no action needed)

## Step 3: Phase 2 — Sequential Task Drill-Down

For each task in DECISIONS NEEDED + REVIEWS PENDING (ordered by category, then updated_at):

1. **Get full DNA:**
   ```bash
   DATABASE_PATH=$DB node $CLI get <slug>
   ```

2. **Present to Thomas:**
   - Title and project
   - Action type: "Approve or Rework?" / "Complete or Rework?"
   - Key DNA fields: `findings`, `implementation`, `qa_review`, `pdsa_review`, `qa_design_review`
   - Review chain trail (who reviewed, who passed)

3. **WAIT for Thomas's decision as plain text input.**
   Do NOT use AskUserQuestion — it produces false positives (returns empty answers without human interaction, documented 2026-03-02).
   Present the task details, then STOP and wait for Thomas to type his decision.
   Thomas will reply with "approve", "rework", "complete", or give specific feedback.
   Do NOT assume any answer. Do NOT proceed until Thomas's actual text response appears.

4. **Execute the transition** based on Thomas's typed decision:
   - Approve: `DATABASE_PATH=$DB node $CLI transition <slug> approved liaison`
   - Complete: `DATABASE_PATH=$DB node $CLI transition <slug> complete liaison`
   - Rework: `DATABASE_PATH=$DB node $CLI transition <slug> rework liaison`

5. **Only then** present the next task.

**CRITICAL: Never present all task details at once.** The summary is the map. Phase 2 is the decision flow — one task at a time.

## Step 4: Wrap Up

After all actionable tasks are presented and decided:
- Show remaining IN PIPELINE tasks (brief, no drill-down)
- End with: "All actionable items addressed. N tasks remain in pipeline."

---

## Reference

- **CLI:** `xpollination-mcp-server/src/db/interface-cli.js`
- **Project DBs:**
  - `best-practices/data/xpollination.db`
  - `xpollination-mcp-server/data/xpollination.db`
  - `HomePage/data/xpollination.db`
- **Brain API:** `POST http://localhost:3200/api/v1/memory`
- **Workflow:** `xpollination-mcp-server/docs/WORKFLOW.md`
