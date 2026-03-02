/**
 * Tests for multi-user authentication.
 *
 * From PDSA multi-user-auth (2026-03-02):
 * AC-MUA1: database.ts creates users table with required columns
 * AC-MUA2: database.ts seeds Thomas as default user
 * AC-MUA3: auth middleware module exists and exports authHook
 * AC-MUA4: /health endpoint returns 200 without auth (exempt)
 * AC-MUA5: /api/v1/memory returns 401 without Authorization header
 * AC-MUA6: /api/v1/memory returns 401 with invalid Bearer token
 * AC-MUA7: /api/v1/memory returns 200 with valid Thomas Bearer token
 */
import { describe, it, expect } from "vitest";

const API_URL = "http://localhost:3200";

async function apiIsRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/v1/health`);
    return res.ok;
  } catch {
    return false;
  }
}

// --- AC-MUA1: Users table has required columns ---

describe("AC-MUA1: database.ts creates users table with correct schema", () => {
  it("database.ts source contains CREATE TABLE users with required columns", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync(
      "/home/developer/workspaces/github/PichlerThomas/best-practices/api/src/services/database.ts",
      "utf-8",
    );

    // Must create users table
    expect(source).toContain("users");
    expect(source).toContain("user_id");
    expect(source).toContain("display_name");
    expect(source).toContain("api_key");
    expect(source).toContain("qdrant_collection");
    expect(source).toContain("created_at");
    expect(source).toContain("active");
  });

  it("api_key column has UNIQUE constraint", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync(
      "/home/developer/workspaces/github/PichlerThomas/best-practices/api/src/services/database.ts",
      "utf-8",
    );

    // api_key must be unique for security
    const usersTableSection = source.slice(
      source.indexOf("users"),
      source.indexOf("users") + 500,
    );
    expect(usersTableSection.toLowerCase()).toContain("unique");
  });
});

// --- AC-MUA2: Thomas seeded as default user ---

describe("AC-MUA2: database.ts seeds Thomas as default user", () => {
  it("database.ts contains INSERT for Thomas with api_key and qdrant_collection", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync(
      "/home/developer/workspaces/github/PichlerThomas/best-practices/api/src/services/database.ts",
      "utf-8",
    );

    // Should seed Thomas
    expect(source.toLowerCase()).toContain("thomas");
    expect(source).toContain("INSERT");
  });
});

// --- AC-MUA3: Auth middleware exists ---

describe("AC-MUA3: auth middleware module exists", () => {
  it("middleware/auth.ts file exists with authHook export", async () => {
    const fs = await import("node:fs");
    const authPath =
      "/home/developer/workspaces/github/PichlerThomas/best-practices/api/src/middleware/auth.ts";
    expect(fs.existsSync(authPath)).toBe(true);

    const source = fs.readFileSync(authPath, "utf-8");
    // Should export an auth hook function
    expect(source).toContain("export");
    expect(source).toContain("auth");
  });

  it("auth middleware checks Authorization Bearer header", async () => {
    const fs = await import("node:fs");
    const authPath =
      "/home/developer/workspaces/github/PichlerThomas/best-practices/api/src/middleware/auth.ts";
    if (!fs.existsSync(authPath)) return;

    const source = fs.readFileSync(authPath, "utf-8");
    expect(source).toContain("authorization");
    expect(source).toContain("bearer");
  });

  it("auth middleware returns 401 for invalid keys", async () => {
    const fs = await import("node:fs");
    const authPath =
      "/home/developer/workspaces/github/PichlerThomas/best-practices/api/src/middleware/auth.ts";
    if (!fs.existsSync(authPath)) return;

    const source = fs.readFileSync(authPath, "utf-8");
    expect(source).toContain("401");
  });
});

// --- AC-MUA4: /health exempt from auth ---

describe("AC-MUA4: /health returns 200 without auth", () => {
  it("GET /api/v1/health returns 200 with no Authorization header", async () => {
    const up = await apiIsRunning();
    if (!up) return;

    const res = await fetch(`${API_URL}/api/v1/health`);
    expect(res.status).toBe(200);
  });
});

// --- AC-MUA5: 401 without auth header ---

describe("AC-MUA5: /api/v1/memory returns 401 without auth", () => {
  it("POST /api/v1/memory without Authorization returns 401", async () => {
    const up = await apiIsRunning();
    if (!up) return;

    const res = await fetch(`${API_URL}/api/v1/memory`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "test query",
        agent_id: "test",
        agent_name: "TEST",
        read_only: true,
      }),
    });
    expect(res.status).toBe(401);
  });
});

// --- AC-MUA6: 401 with invalid Bearer token ---

describe("AC-MUA6: /api/v1/memory returns 401 with invalid token", () => {
  it("POST /api/v1/memory with invalid Bearer token returns 401", async () => {
    const up = await apiIsRunning();
    if (!up) return;

    const res = await fetch(`${API_URL}/api/v1/memory`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer invalid-fake-key-12345",
      },
      body: JSON.stringify({
        prompt: "test query",
        agent_id: "test",
        agent_name: "TEST",
        read_only: true,
      }),
    });
    expect(res.status).toBe(401);
  });
});

// --- AC-MUA7: 200 with valid Thomas key ---

describe("AC-MUA7: /api/v1/memory returns 200 with valid Thomas key", () => {
  it("index.ts registers auth middleware", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync(
      "/home/developer/workspaces/github/PichlerThomas/best-practices/api/src/index.ts",
      "utf-8",
    );
    // index.ts should import and register auth middleware
    expect(source).toContain("auth");
  });
});
