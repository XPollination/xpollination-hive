---
name: xpo.claude.mindspace.reflect
description: Reflect on brain knowledge — extract principles, procedures, terminology, and knowledge gaps
user-invocable: true
allowed-tools: Bash, Read
---

# XPollination Reflection Skill

Scan brain knowledge and extract deeper patterns: principles, procedures, terminology calibration, and knowledge gaps.

**Usage:** invoke as `xpo.claude.mindspace.reflect` with scope and depth arguments.

```
xpo.claude.mindspace.reflect [scope] [depth]
```

---

## Scopes

| Scope | Input | Use Case |
|-------|-------|----------|
| `task:<slug>` | Task DNA + related brain thoughts | Post-task micro-reflection (Layer 3 slot) |
| `recent` | Last 7 days of brain thoughts | Periodic pattern extraction |
| `domain:<topic>` | All thoughts tagged with topic | Deep domain synthesis |
| `focus:<query>` | User-specified focus | On-demand investigation by Thomas |

## Depths

| Depth | Operations |
|-------|-----------|
| `shallow` | Scan, categorize, and report gaps — read-only, no writes to brain |
| `deep` | + Extract principles + Generate procedures + Identify terminology + Write to brain |

---

## Step 1: Parse Arguments

Extract scope and depth from `$ARGUMENTS`:
```
SCOPE = first argument (task:<slug>, recent, domain:<topic>, focus:<query>)
DEPTH = second argument (shallow or deep, default: shallow)
```

## Step 2: Gather Input

Based on scope, query brain for relevant thoughts:

```bash
SESSION_ID=$(cat /proc/sys/kernel/random/uuid)

# For task:<slug> scope — get task DNA + related brain thoughts
curl -s -X POST http://localhost:3200/api/v1/memory \
  -H "Content-Type: application/json" \
  -d "{\"prompt\": \"All learnings, observations, and decisions from task <slug>\", \"agent_id\": \"agent-$AGENT_ROLE\", \"agent_name\": \"$(echo $AGENT_ROLE | tr a-z A-Z)\", \"session_id\": \"$SESSION_ID\", \"read_only\": true, \"full_content\": true}"

# For recent scope — get last 7 days
curl -s -X POST http://localhost:3200/api/v1/memory \
  -H "Content-Type: application/json" \
  -d "{\"prompt\": \"Recent observations, operational learnings, and task outcomes from the last 7 days\", \"agent_id\": \"agent-$AGENT_ROLE\", \"agent_name\": \"$(echo $AGENT_ROLE | tr a-z A-Z)\", \"session_id\": \"$SESSION_ID\", \"read_only\": true, \"full_content\": true}"

# For domain:<topic> scope
curl -s -X POST http://localhost:3200/api/v1/memory \
  -H "Content-Type: application/json" \
  -d "{\"prompt\": \"All knowledge about <topic> — observations, decisions, patterns, problems\", \"agent_id\": \"agent-$AGENT_ROLE\", \"agent_name\": \"$(echo $AGENT_ROLE | tr a-z A-Z)\", \"session_id\": \"$SESSION_ID\", \"read_only\": true, \"full_content\": true}"

# For focus:<query> scope
curl -s -X POST http://localhost:3200/api/v1/memory \
  -H "Content-Type: application/json" \
  -d "{\"prompt\": \"<query>\", \"agent_id\": \"agent-$AGENT_ROLE\", \"agent_name\": \"$(echo $AGENT_ROLE | tr a-z A-Z)\", \"session_id\": \"$SESSION_ID\", \"read_only\": true, \"full_content\": true}"
```

## Step 3: Analyze and Reflect

Review the gathered thoughts. For each cluster of related observations, apply the MARS three-phase pipeline:

1. **Evaluate**: What happened? What was the outcome?
2. **Cluster**: Group by pattern — same error type, same domain, same workflow stage
3. **Enhance**: For each cluster, extract:

### Output Templates

Use these exact prefixes for brain contributions:

**PRINCIPLE:** Declarative rules from recurring patterns
```
PRINCIPLE: When [condition], [rule] because [evidence from multiple observations]
```
Example: "PRINCIPLE: When SSH aliases are designed in PDSA, always verify they exist in all user SSH configs because developer and thomas configs diverge (evidence: qdrant-backup-nas-unresolvable, 3 prior SSH failures)"

**PROCEDURE:** Step-by-step guides from successful patterns
```
PROCEDURE: To [goal], (1) [step], (2) [step], (3) [step]...
```
Example: "PROCEDURE: To validate NAS connectivity, (1) check SSH config alias exists, (2) test hostname resolution, (3) test SSH connection, (4) verify target path exists"

**TERM:** Terminology calibration between Thomas and agents
```
TERM: [word] — Thomas means: [X]. Agent default: [Y]. Calibration: [Z]
```
Example: "TERM: deep research — Thomas means: multiple perspectives + new sources + when/where analysis. Agent default: web search + summarize. Calibration: always produce multiple perspectives"

**GAP:** Knowledge gaps — high observations, low synthesis
```
GAP: [domain] has [N observations] but [0 principles]. Need: [synthesis topic]
```
Example: "GAP: SSH infrastructure has 12 observations but 0 principles. Need: SSH config management principles"

## Step 4: Write Results (deep depth only)

**If depth is `shallow`:** Report findings as text output only. Do not write to brain. This is a scan and report operation.

**If depth is `deep`:** Contribute each extracted insight to brain:

```bash
# Contribute a principle
curl -s -X POST http://localhost:3200/api/v1/memory \
  -H "Content-Type: application/json" \
  -d "{\"prompt\": \"PRINCIPLE: ...\", \"agent_id\": \"agent-$AGENT_ROLE\", \"agent_name\": \"$(echo $AGENT_ROLE | tr a-z A-Z)\", \"session_id\": \"$SESSION_ID\", \"thought_category\": \"principle\", \"topic\": \"<domain>\"}"

# Contribute a procedure
curl -s -X POST http://localhost:3200/api/v1/memory \
  -H "Content-Type: application/json" \
  -d "{\"prompt\": \"PROCEDURE: ...\", \"agent_id\": \"agent-$AGENT_ROLE\", \"agent_name\": \"$(echo $AGENT_ROLE | tr a-z A-Z)\", \"session_id\": \"$SESSION_ID\", \"thought_category\": \"procedure\", \"topic\": \"<domain>\"}"

# Contribute terminology
curl -s -X POST http://localhost:3200/api/v1/memory \
  -H "Content-Type: application/json" \
  -d "{\"prompt\": \"TERM: ...\", \"agent_id\": \"agent-$AGENT_ROLE\", \"agent_name\": \"$(echo $AGENT_ROLE | tr a-z A-Z)\", \"session_id\": \"$SESSION_ID\", \"thought_category\": \"terminology\", \"topic\": \"communication\"}"

# Contribute knowledge gap
curl -s -X POST http://localhost:3200/api/v1/memory \
  -H "Content-Type: application/json" \
  -d "{\"prompt\": \"GAP: ...\", \"agent_id\": \"agent-$AGENT_ROLE\", \"agent_name\": \"$(echo $AGENT_ROLE | tr a-z A-Z)\", \"session_id\": \"$SESSION_ID\", \"thought_category\": \"knowledge_gap\", \"topic\": \"<domain>\"}"
```

## Step 5: Report

Output a summary regardless of depth:

```
== Reflection Report ==
Scope: [scope used]
Depth: [shallow|deep]
Thoughts analyzed: [N]

Principles found: [N]
  - [list each]

Procedures found: [N]
  - [list each]

Terminology gaps: [N]
  - [list each]

Knowledge gaps: [N]
  - [list each]

[If deep] Written to brain: [N] new thoughts
[If shallow] (Read-only scan — run with depth=deep to write findings to brain)
```

---

## Integration Points

### Layer 3 Gardening (post-task completion)

After a task is marked complete and micro-gardening runs, invoke reflection on the completed task:
```
xpo.claude.mindspace.reflect task:<slug> deep
```
This extracts principles and procedures from the task while context is fresh. Runs alongside gardener, not replacing it: gardener cleans up (dedup, consolidate), reflection extracts meaning.

### PM Status (brain health check)

During `xpo.claude.mindspace.pm.status` brain health reporting, optionally invoke:
```
xpo.claude.mindspace.reflect recent shallow
```
This reports knowledge gaps and areas needing synthesis without writing anything — pure diagnostic.

---

## Thought Categories

| Category | Purpose | Abstraction Level |
|----------|---------|-------------------|
| `principle` | Declarative rules from recurring patterns | High — governs future behavior |
| `procedure` | Step-by-step guides from successful patterns | Medium — reusable workflows |
| `terminology` | Thomas-agent encode/decode calibration | Meta — communication alignment |
| `knowledge_gap` | Domains with observations but no synthesis | Meta — directs future reflection |

These sit above `operational_learning` (action-level) and below `governing_assumption` (future, double-loop).

---

## Relationship to Gardener

| Concern | Gardener | Reflection |
|---------|----------|------------|
| **Purpose** | Cleanup, dedup, organize | Synthesize, extract meaning, find gaps |
| **Input** | Raw thoughts, duplicates, noise | Clean thoughts, patterns, clusters |
| **Output** | Consolidated thoughts, archived noise | Principles, procedures, terminology |
| **When** | Before reflection (clean first) | After gardening (reflect on clean data) |
| **Thought types** | `consolidation`, archive markers | `principle`, `procedure`, `terminology`, `knowledge_gap` |

---

## Quality Rules

- Every PRINCIPLE must cite evidence from 2+ observations
- Every PROCEDURE must be tested or derived from successful task outcomes
- Every TERM must reflect observed misalignment, not hypothetical
- Every GAP must quantify: N observations vs M principles
- Shallow depth must NEVER write to brain (read-only scan and report only)
- Do not output bare slash commands as standalone text
