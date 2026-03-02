#!/bin/bash
# Verification tests for reflection-skill-research implementation
# Run: bash best-practices/scripts/test-reflection-skill.sh
# All tests must pass before the implementation is considered complete.

PASS=0
FAIL=0
SKIP=0

test_result() {
    local name="$1"
    local result="$2"
    local detail="$3"
    if [ "$result" = "PASS" ]; then
        echo "  [PASS] $name"
        PASS=$((PASS + 1))
    elif [ "$result" = "SKIP" ]; then
        echo "  [SKIP] $name — $detail"
        SKIP=$((SKIP + 1))
    else
        echo "  [FAIL] $name — $detail"
        FAIL=$((FAIL + 1))
    fi
}

SKILL_DIR="$HOME/.claude/skills/xpo.claude.mindspace.reflect"
SKILL_SRC="/home/developer/workspaces/github/PichlerThomas/best-practices/.claude/skills/xpo.claude.mindspace.reflect"
BRAIN_URL="http://localhost:3200/api/v1/memory"

echo "=== Reflection Skill Verification Tests ==="
echo "Date: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# --- T1: Skill file exists ---
echo "T1: Skill file exists"
if [ -f "$SKILL_SRC/SKILL.md" ]; then
    test_result "SKILL.md exists in repo" "PASS"
else
    test_result "SKILL.md exists in repo" "FAIL" "Not found at $SKILL_SRC/SKILL.md"
fi

# --- T2: Skill has correct metadata ---
echo "T2: Skill metadata"
if [ -f "$SKILL_SRC/SKILL.md" ]; then
    if grep -q "^name: xpo.claude.mindspace.reflect" "$SKILL_SRC/SKILL.md"; then
        test_result "Skill name correct" "PASS"
    else
        test_result "Skill name correct" "FAIL" "Missing or wrong name in frontmatter"
    fi
    if grep -q "user-invocable: true" "$SKILL_SRC/SKILL.md"; then
        test_result "Skill is user-invocable" "PASS"
    else
        test_result "Skill is user-invocable" "FAIL" "Missing user-invocable: true"
    fi
else
    test_result "Skill name correct" "SKIP" "Skill file missing"
    test_result "Skill is user-invocable" "SKIP" "Skill file missing"
fi

# --- T3: Skill supports all scopes ---
echo "T3: Scope support"
for scope in "task:" "recent" "domain:" "focus:"; do
    if [ -f "$SKILL_SRC/SKILL.md" ] && grep -q "$scope" "$SKILL_SRC/SKILL.md"; then
        test_result "Scope '$scope' documented" "PASS"
    else
        test_result "Scope '$scope' documented" "FAIL" "Scope not found in skill"
    fi
done

# --- T4: Skill supports depths ---
echo "T4: Depth support"
for depth in "shallow" "deep"; do
    if [ -f "$SKILL_SRC/SKILL.md" ] && grep -q "$depth" "$SKILL_SRC/SKILL.md"; then
        test_result "Depth '$depth' documented" "PASS"
    else
        test_result "Depth '$depth' documented" "FAIL" "Depth not found in skill"
    fi
done

# --- T5: New thought categories accepted by brain API ---
echo "T5: Brain API thought categories"
BRAIN_OK=$(curl -s http://localhost:3200/api/v1/health 2>/dev/null | grep -c '"ok"')
if [ "$BRAIN_OK" -eq 0 ]; then
    test_result "Brain API health" "FAIL" "Brain API not responding"
    for cat in principle procedure terminology knowledge_gap; do
        test_result "Category '$cat' accepted" "SKIP" "Brain API down"
    done
else
    test_result "Brain API health" "PASS"
    for cat in principle procedure terminology knowledge_gap; do
        RESP=$(curl -s -X POST "$BRAIN_URL" -H "Content-Type: application/json" \
            -H "Authorization: Bearer ${BRAIN_API_KEY:-}" \
            -d "{\"prompt\": \"TEST CATEGORY: Verifying $cat thought category is accepted by brain API\", \"agent_id\": \"agent-qa\", \"agent_name\": \"QA\", \"thought_category\": \"$cat\", \"read_only\": true}")
        # read_only:true means no storage, but the API should still accept the category without error
        if echo "$RESP" | grep -q '"status":"error"'; then
            test_result "Category '$cat' accepted" "FAIL" "API rejected category"
        else
            test_result "Category '$cat' accepted" "PASS"
        fi
    done
fi

# --- T6: Output templates match PDSA design ---
echo "T6: Output templates"
if [ -f "$SKILL_SRC/SKILL.md" ]; then
    for template in "PRINCIPLE:" "PROCEDURE:" "TERM:" "GAP:"; do
        if grep -q "$template" "$SKILL_SRC/SKILL.md"; then
            test_result "Template '$template' present" "PASS"
        else
            test_result "Template '$template' present" "FAIL" "Template not found in skill"
        fi
    done
else
    for template in "PRINCIPLE:" "PROCEDURE:" "TERM:" "GAP:"; do
        test_result "Template '$template' present" "SKIP" "Skill file missing"
    done
fi

# --- T7: Shallow depth is read-only ---
echo "T7: Shallow depth read-only"
if [ -f "$SKILL_SRC/SKILL.md" ] && grep -qi "shallow.*read.only\|shallow.*no.writ\|shallow.*scan.*report" "$SKILL_SRC/SKILL.md"; then
    test_result "Shallow depth documented as read-only" "PASS"
else
    if [ -f "$SKILL_SRC/SKILL.md" ]; then
        test_result "Shallow depth documented as read-only" "FAIL" "No read-only mention for shallow depth"
    else
        test_result "Shallow depth documented as read-only" "SKIP" "Skill file missing"
    fi
fi

# --- T8: Integration points ---
echo "T8: Integration points"
if [ -f "$SKILL_SRC/SKILL.md" ]; then
    if grep -qi "layer.3\|gardening\|post.task\|task.completion" "$SKILL_SRC/SKILL.md"; then
        test_result "Layer 3 gardening integration documented" "PASS"
    else
        test_result "Layer 3 gardening integration documented" "FAIL" "No gardening integration found"
    fi
    if grep -qi "pm.status\|brain.health\|health.check" "$SKILL_SRC/SKILL.md"; then
        test_result "PM status integration documented" "PASS"
    else
        test_result "PM status integration documented" "FAIL" "No PM status integration found"
    fi
else
    test_result "Layer 3 gardening integration documented" "SKIP" "Skill file missing"
    test_result "PM status integration documented" "SKIP" "Skill file missing"
fi

# --- T9: Symlink installed ---
echo "T9: Installed symlink"
if [ -L "$SKILL_DIR" ] || [ -d "$SKILL_DIR" ]; then
    test_result "Skill installed at ~/.claude/skills/" "PASS"
else
    test_result "Skill installed at ~/.claude/skills/" "FAIL" "Not found at $SKILL_DIR"
fi

# --- T10: No bare slash commands (lesson from agent-output-triggers-slash-commands) ---
echo "T10: No bare slash commands"
if [ -f "$SKILL_SRC/SKILL.md" ]; then
    BARE=$(grep -c "^/[a-z]" "$SKILL_SRC/SKILL.md" 2>/dev/null)
    if [ "$BARE" -eq 0 ]; then
        test_result "No bare slash commands in action sections" "PASS"
    else
        test_result "No bare slash commands in action sections" "FAIL" "Found $BARE bare slash command line(s)"
    fi
else
    test_result "No bare slash commands in action sections" "SKIP" "Skill file missing"
fi

# --- Summary ---
echo ""
echo "=== Results ==="
TOTAL=$((PASS + FAIL + SKIP))
echo "  Total: $TOTAL | Pass: $PASS | Fail: $FAIL | Skip: $SKIP"
if [ $FAIL -eq 0 ] && [ $SKIP -eq 0 ]; then
    echo "  STATUS: ALL TESTS PASSED"
    exit 0
elif [ $FAIL -eq 0 ]; then
    echo "  STATUS: PASS (with $SKIP skipped)"
    exit 0
else
    echo "  STATUS: $FAIL FAILURE(S)"
    exit 1
fi
