/**
 * Tests for multi-user MCP config (per-user API key in headers).
 *
 * From PDSA multi-user-mcp-config (2026-03-02):
 * AC-MUMC1: MCP connector reads BRAIN_API_KEY from env
 * AC-MUMC2: MCP connector reads BRAIN_AGENT_ID from env
 * AC-MUMC3: MCP connector reads BRAIN_AGENT_NAME from env
 * AC-MUMC4: MCP connector adds Authorization Bearer header to brain API calls
 * AC-MUMC5: Default values preserve backward compatibility (Thomas defaults)
 * AC-MUMC6: MCP config template exists for Claude Web AI users
 */
import { describe, it, expect } from "vitest";

const MCP_PATH =
  "/home/developer/workspaces/github/PichlerThomas/best-practices/api/src/mcp/brain-mcp.ts";

// --- AC-MUMC1: Reads BRAIN_API_KEY from env ---

describe("AC-MUMC1: MCP connector reads BRAIN_API_KEY", () => {
  it("brain-mcp.ts references BRAIN_API_KEY environment variable", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync(MCP_PATH, "utf-8");
    expect(source).toContain("BRAIN_API_KEY");
  });
});

// --- AC-MUMC2: Reads BRAIN_AGENT_ID from env ---

describe("AC-MUMC2: MCP connector reads BRAIN_AGENT_ID", () => {
  it("brain-mcp.ts references BRAIN_AGENT_ID environment variable", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync(MCP_PATH, "utf-8");
    expect(source).toContain("BRAIN_AGENT_ID");
  });
});

// --- AC-MUMC3: Reads BRAIN_AGENT_NAME from env ---

describe("AC-MUMC3: MCP connector reads BRAIN_AGENT_NAME", () => {
  it("brain-mcp.ts references BRAIN_AGENT_NAME environment variable", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync(MCP_PATH, "utf-8");
    expect(source).toContain("BRAIN_AGENT_NAME");
  });
});

// --- AC-MUMC4: Adds Authorization Bearer header ---

describe("AC-MUMC4: MCP connector adds Authorization Bearer header", () => {
  it("brain-mcp.ts includes Authorization header in API calls", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync(MCP_PATH, "utf-8");
    expect(source).toContain("Authorization");
    expect(source.toLowerCase()).toContain("bearer");
  });
});

// --- AC-MUMC5: Default values for backward compatibility ---

describe("AC-MUMC5: Default values preserve backward compatibility", () => {
  it("BRAIN_API_KEY is required (no hardcoded fallback)", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync(MCP_PATH, "utf-8");
    // After credential rotation: BRAIN_API_KEY must be required, no hardcoded fallback
    expect(source).toContain("BRAIN_API_KEY");
    expect(source).toMatch(/BRAIN_API_KEY.*required/i);
  });

  it("BRAIN_AGENT_ID has Thomas default", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync(MCP_PATH, "utf-8");
    // Should default to thomas
    expect(source).toMatch(/thomas/);
  });
});

// --- AC-MUMC6: MCP config template exists ---

describe("AC-MUMC6: MCP config template for Claude Web AI users", () => {
  it("config template or documentation exists", async () => {
    const fs = await import("node:fs");
    // Check for template file in scripts or docs
    const templatePaths = [
      "/home/developer/workspaces/github/PichlerThomas/best-practices/api/scripts/mcp-config-template.json",
      "/home/developer/workspaces/github/PichlerThomas/best-practices/api/docs/mcp-config-template.json",
      "/home/developer/workspaces/github/PichlerThomas/best-practices/api/mcp-config-template.json",
    ];
    const hasTemplate = templatePaths.some((p) => fs.existsSync(p));
    // Or inline in brain-mcp.ts as a comment/doc
    const source = fs.readFileSync(MCP_PATH, "utf-8");
    const hasInlineTemplate = source.toLowerCase().includes("config") && source.toLowerCase().includes("template");
    expect(hasTemplate || hasInlineTemplate).toBe(true);
  });
});
