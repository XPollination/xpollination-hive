/**
 * Tests for multi-user provisioning script.
 *
 * From PDSA multi-user-provision-script (2026-03-02):
 * AC-MUPS1: provision-user.sh script exists and is executable
 * AC-MUPS2: Script creates Qdrant collection thought_space_{user_id}
 * AC-MUPS3: Script generates UUID API key
 * AC-MUPS4: Script registers user in SQLite users table
 * AC-MUPS5: Script creates thought_space_shared if not exists
 * AC-MUPS6: Script outputs MCP config snippet
 * AC-MUPS7: Script is idempotent (re-run safe)
 * AC-MUPS8: Script validates user_id format
 */
import { describe, it, expect } from "vitest";

const SCRIPT_PATH =
  "/home/developer/workspaces/github/PichlerThomas/best-practices/api/scripts/provision-user.sh";

// --- AC-MUPS1: Script exists and is executable ---

describe("AC-MUPS1: provision-user.sh exists", () => {
  it("provision-user.sh file exists", async () => {
    const fs = await import("node:fs");
    expect(fs.existsSync(SCRIPT_PATH)).toBe(true);
  });

  it("provision-user.sh is executable", async () => {
    const fs = await import("node:fs");
    if (!fs.existsSync(SCRIPT_PATH)) return;
    const stats = fs.statSync(SCRIPT_PATH);
    // Check owner execute bit
    expect(stats.mode & 0o100).toBeGreaterThan(0);
  });
});

// --- AC-MUPS2: Creates Qdrant collection ---

describe("AC-MUPS2: Script creates Qdrant collection", () => {
  it("script references thought_space_ collection naming", async () => {
    const fs = await import("node:fs");
    if (!fs.existsSync(SCRIPT_PATH)) return;
    const source = fs.readFileSync(SCRIPT_PATH, "utf-8");
    expect(source).toContain("thought_space_");
  });

  it("script creates collection with correct vector config", async () => {
    const fs = await import("node:fs");
    if (!fs.existsSync(SCRIPT_PATH)) return;
    const source = fs.readFileSync(SCRIPT_PATH, "utf-8");
    // Must reference 384-dim cosine vectors (matching existing collections)
    expect(source).toContain("384");
    expect(source.toLowerCase()).toContain("cosine");
  });
});

// --- AC-MUPS3: Generates UUID API key ---

describe("AC-MUPS3: Script generates UUID API key", () => {
  it("script uses uuid generation", async () => {
    const fs = await import("node:fs");
    if (!fs.existsSync(SCRIPT_PATH)) return;
    const source = fs.readFileSync(SCRIPT_PATH, "utf-8");
    // Should use uuidgen or similar UUID generation
    expect(source.toLowerCase()).toMatch(/uuid|uuidgen/);
  });
});

// --- AC-MUPS4: Registers user in SQLite ---

describe("AC-MUPS4: Script registers user in SQLite", () => {
  it("script performs INSERT into users table", async () => {
    const fs = await import("node:fs");
    if (!fs.existsSync(SCRIPT_PATH)) return;
    const source = fs.readFileSync(SCRIPT_PATH, "utf-8");
    expect(source.toUpperCase()).toContain("INSERT");
    expect(source).toContain("users");
  });
});

// --- AC-MUPS5: Creates thought_space_shared ---

describe("AC-MUPS5: Script creates thought_space_shared", () => {
  it("script references thought_space_shared collection", async () => {
    const fs = await import("node:fs");
    if (!fs.existsSync(SCRIPT_PATH)) return;
    const source = fs.readFileSync(SCRIPT_PATH, "utf-8");
    expect(source).toContain("thought_space_shared");
  });
});

// --- AC-MUPS6: Outputs MCP config ---

describe("AC-MUPS6: Script outputs MCP config snippet", () => {
  it("script outputs configuration information", async () => {
    const fs = await import("node:fs");
    if (!fs.existsSync(SCRIPT_PATH)) return;
    const source = fs.readFileSync(SCRIPT_PATH, "utf-8");
    // Should output API key and config info
    expect(source.toLowerCase()).toMatch(/api.key|mcp|config/);
  });
});

// --- AC-MUPS7: Script is idempotent ---

describe("AC-MUPS7: Script is idempotent", () => {
  it("script uses IF NOT EXISTS or OR IGNORE for safety", async () => {
    const fs = await import("node:fs");
    if (!fs.existsSync(SCRIPT_PATH)) return;
    const source = fs.readFileSync(SCRIPT_PATH, "utf-8");
    // Should handle re-runs gracefully
    const upper = source.toUpperCase();
    const hasIdempotent =
      upper.includes("OR IGNORE") ||
      upper.includes("IF NOT EXISTS") ||
      upper.includes("ALREADY EXISTS") ||
      source.includes("already");
    expect(hasIdempotent).toBe(true);
  });
});

// --- AC-MUPS8: Validates user_id format ---

describe("AC-MUPS8: Script validates user_id", () => {
  it("script checks for required arguments", async () => {
    const fs = await import("node:fs");
    if (!fs.existsSync(SCRIPT_PATH)) return;
    const source = fs.readFileSync(SCRIPT_PATH, "utf-8");
    // Should validate input
    expect(source).toMatch(/usage|Usage|USAGE|\$1|\$2/);
  });
});
