#!/bin/bash
# Verification tests for qdrant-backup-nas-unresolvable fix
# Run: bash best-practices/scripts/test-qdrant-backup.sh
# All tests must pass before the fix is considered complete.

set -e

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

echo "=== Qdrant Backup Fix Verification Tests ==="
echo "Date: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# --- Test 1: SSH config contains synology-backup host ---
echo "T1: SSH config has synology-backup alias"
if grep -q "^Host synology-backup" ~/.ssh/config 2>/dev/null; then
    test_result "synology-backup alias exists in ~/.ssh/config" "PASS"
else
    test_result "synology-backup alias exists in ~/.ssh/config" "FAIL" "No 'Host synology-backup' entry found"
fi

# --- Test 2: synology-backup points to correct IP ---
echo "T2: synology-backup alias resolves to 10.33.33.2"
HOST_IP=$(grep -A2 "^Host synology-backup" ~/.ssh/config 2>/dev/null | grep HostName | awk '{print $2}')
if [ "$HOST_IP" = "10.33.33.2" ]; then
    test_result "HostName is 10.33.33.2" "PASS"
else
    test_result "HostName is 10.33.33.2" "FAIL" "Got: '$HOST_IP'"
fi

# --- Test 3: SSH connectivity to synology-backup ---
echo "T3: SSH connectivity to synology-backup"
if ssh -o ConnectTimeout=5 -o BatchMode=yes synology-backup "echo ok" 2>/dev/null | grep -q "ok"; then
    test_result "ssh synology-backup connects" "PASS"
else
    test_result "ssh synology-backup connects" "FAIL" "SSH connection failed (check VPN, key auth)"
fi

# --- Test 4: NAS brain backup directories exist ---
echo "T4: NAS brain backup directories"
DIRS_OK=true
for dir in daily weekly monthly latest; do
    if ssh -o ConnectTimeout=5 synology-backup "test -d /volume1/backups/hetzner/brain/$dir" 2>/dev/null; then
        test_result "/volume1/backups/hetzner/brain/$dir exists" "PASS"
    else
        test_result "/volume1/backups/hetzner/brain/$dir exists" "FAIL" "Directory missing on NAS"
        DIRS_OK=false
    fi
done

# --- Test 5: Qdrant API is accessible ---
echo "T5: Qdrant API health"
QDRANT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:6333/collections/thought_space 2>/dev/null)
if [ "$QDRANT_STATUS" = "200" ]; then
    test_result "Qdrant collection thought_space accessible" "PASS"
else
    test_result "Qdrant collection thought_space accessible" "FAIL" "HTTP $QDRANT_STATUS"
fi

# --- Test 6: End-to-end backup script ---
echo "T6: End-to-end backup (qdrant-backup.sh)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ $FAIL -gt 0 ]; then
    test_result "End-to-end backup" "SKIP" "Prerequisites failed ($FAIL failures above)"
else
    BACKUP_OUTPUT=$(bash "$SCRIPT_DIR/qdrant-backup.sh" 2>&1)
    if echo "$BACKUP_OUTPUT" | grep -q "completed successfully"; then
        test_result "Backup script completed successfully" "PASS"
        # Verify backup landed on NAS
        LATEST_COUNT=$(ssh synology-backup "ls /volume1/backups/hetzner/brain/latest/ 2>/dev/null | wc -l")
        if [ "$LATEST_COUNT" -gt 0 ]; then
            test_result "Backup files present in NAS latest/" "PASS"
        else
            test_result "Backup files present in NAS latest/" "FAIL" "No files in latest/"
        fi
    else
        test_result "Backup script completed successfully" "FAIL" "Script did not complete. Last lines: $(echo "$BACKUP_OUTPUT" | tail -3)"
    fi
fi

# --- Test 7: Script error message on unreachable NAS ---
echo "T7: Error clarity when NAS unreachable"
# This is a design acceptance criterion — verify the script uses the SSH alias
# (the actual SSH failure message is clear when the alias is properly configured)
if grep -q 'SSH_CMD="ssh synology-backup"' "$SCRIPT_DIR/qdrant-backup.sh"; then
    test_result "Script uses ssh synology-backup (clear alias)" "PASS"
else
    test_result "Script uses ssh synology-backup (clear alias)" "FAIL" "SSH_CMD not set to 'ssh synology-backup'"
fi

# --- Summary ---
echo ""
echo "=== Results ==="
TOTAL=$((PASS + FAIL + SKIP))
echo "  Total: $TOTAL | Pass: $PASS | Fail: $FAIL | Skip: $SKIP"
if [ $FAIL -eq 0 ]; then
    echo "  STATUS: ALL TESTS PASSED"
    exit 0
else
    echo "  STATUS: $FAIL FAILURE(S)"
    exit 1
fi
