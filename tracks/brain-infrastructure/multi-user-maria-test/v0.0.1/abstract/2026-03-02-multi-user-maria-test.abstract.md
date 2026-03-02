# Completion Abstract: multi-user-maria-test

**Date:** 2026-03-02
**Status:** Complete
**Project:** best-practices

## Outcome

End-to-end verification of multi-user brain isolation. Maria provisioned on Hetzner with private collection (`thought_space_maria`), API key, and SQLite user record. All 7 acceptance criteria verified: auth isolation, private write/read isolation, shared space access, idempotent provisioning, and correct API key routing. Zero data leakage between users.

## Key Decisions

- **Node CJS for DB ops:** sqlite3 CLI unavailable on Hetzner — used better-sqlite3 via node script instead.
- **Infrastructure-only task:** No code changes needed — all implementation from prior tasks (auth, routing, provision-script, migration, mcp-config).
- **BRAIN_DB_PATH default:** provision-user.sh default still points to `data/` instead of `api/data/` — tracked separately, not blocking.

## Changes

- Infrastructure: Maria provisioned (thought_space_maria collection, 384-dim cosine, all payload indexes)
- Infrastructure: Thomas qdrant_collection updated to thought_space_thomas in SQLite
- Infrastructure: Brain API restarted with multi-user auth active
- Test file: `api/src/services/multi-user-maria-test.test.ts` (commit: 26489cc)

## Test Results

- 13/13 tests pass
- QA PASS, PDSA PASS
- All 7 ACs verified: AC-MUMT1 through AC-MUMT7

## Related Documentation

- PDSA: [2026-03-02-multi-user-maria-test.pdsa.md](../pdsa/2026-03-02-multi-user-maria-test.pdsa.md)
- Part of: multi-user-brain initiative (task 6 of 8)
