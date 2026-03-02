# Completion Abstract: multi-user-provision-script

**Date:** 2026-03-02
**Status:** Complete
**Project:** best-practices

## Outcome

Created `provision-user.sh` script that sets up a new user's brain: Qdrant collection, API key, SQLite user record, shared collection, and outputs MCP config. Idempotent and self-service ready.

## Key Decisions

- **Idempotent:** INSERT OR IGNORE + reuse existing API key on re-run.
- **BRAIN_DB_PATH configurable:** SQLite path via env var for flexibility.
- **MCP config output:** Script outputs ready-to-use JSON config + env vars for the new user.

## Changes

- `api/scripts/provision-user.sh`: New script — validates user_id, creates collection + indexes, generates UUID key, registers user, ensures shared collection, outputs config
- Commit: 86084bb

## Test Results

- 10/10 tests pass
- QA PASS, PDSA PASS

## Related Documentation

- PDSA: [2026-03-02-multi-user-provision-script.pdsa.md](../pdsa/2026-03-02-multi-user-provision-script.pdsa.md)
- Part of: multi-user-brain initiative (task 3 of 8)
