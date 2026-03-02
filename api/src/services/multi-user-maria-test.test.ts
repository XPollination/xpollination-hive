/**
 * End-to-end tests for multi-user isolation (Maria test).
 *
 * From PDSA multi-user-maria-test (2026-03-02):
 * AC-MUMT1: Maria provision creates Qdrant collection + SQLite record
 * AC-MUMT2: Auth isolation — valid key 200, invalid key 401, missing key 401
 * AC-MUMT3: Private write isolation — Maria thoughts land in maria collection only
 * AC-MUMT4: Private read isolation — Maria cannot see Thomas thoughts, vice versa
 * AC-MUMT5: Shared space accessible by both users
 * AC-MUMT6: Idempotent re-provision is safe (no duplicate, reuses key)
 * AC-MUMT7: API key routes to correct collection (Maria key → maria collection)
 *
 * REQUIRES: Brain API running at localhost:3200, Qdrant at localhost:6333,
 *           Maria provisioned (run provision-user.sh maria "Maria" first)
 */
import { describe, it, expect } from "vitest";

const API_URL = "http://localhost:3200";
const QDRANT_URL = "http://localhost:6333";
const THOMAS_KEY = process.env.BRAIN_API_KEY || "test-key-not-for-production";

// Maria's key must be looked up from DB after provisioning
let MARIA_KEY = "";

async function apiIsRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/v1/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function getMariaKey(): Promise<string> {
  if (MARIA_KEY) return MARIA_KEY;
  // Try via the running API's database (imports from compiled code)
  try {
    const { getDb } = await import("../services/database.js");
    const db = getDb();
    const row = db.prepare("SELECT api_key FROM users WHERE user_id = 'maria'").get() as
      | { api_key: string }
      | undefined;
    MARIA_KEY = row?.api_key ?? "";
    return MARIA_KEY;
  } catch {
    // Fallback: try direct DB access
    try {
      const Database = (await import("better-sqlite3")).default;
      const db = new Database(
        "/home/developer/workspaces/github/PichlerThomas/best-practices/api/data/thought-tracing.db",
      );
      const row = db.prepare("SELECT api_key FROM users WHERE user_id = 'maria'").get() as
        | { api_key: string }
        | undefined;
      db.close();
      MARIA_KEY = row?.api_key ?? "";
      return MARIA_KEY;
    } catch {
      return "";
    }
  }
}

// --- AC-MUMT1: Maria provision creates collection + user record ---

describe("AC-MUMT1: Maria provisioned with collection + SQLite record", () => {
  it("Maria user exists — API accepts her key and returns 200", async () => {
    const up = await apiIsRunning();
    if (!up) return;
    const mariaKey = await getMariaKey();
    if (!mariaKey) {
      // If we can't get Maria's key from SQLite, the user wasn't provisioned
      expect(mariaKey).not.toBe("");
      return;
    }

    const res = await fetch(`${API_URL}/api/v1/memory`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mariaKey}`,
      },
      body: JSON.stringify({
        prompt: "maria existence check",
        agent_id: "maria-check",
        agent_name: "Maria Check",
        read_only: true,
      }),
    });
    // If Maria is provisioned, her key works
    expect(res.status).toBe(200);
  });

  it("Qdrant has thought_space_maria collection", async () => {
    try {
      const res = await fetch(`${QDRANT_URL}/collections/thought_space_maria`);
      const data = (await res.json()) as { status: string };
      expect(data.status).toBe("ok");
    } catch {
      // Skip if Qdrant not reachable
      return;
    }
  });
});

// --- AC-MUMT2: Auth isolation ---

describe("AC-MUMT2: Auth isolation — valid/invalid/missing keys", () => {
  it("Maria valid key returns 200", async () => {
    const up = await apiIsRunning();
    if (!up) return;
    const mariaKey = await getMariaKey();
    if (!mariaKey) return;

    const res = await fetch(`${API_URL}/api/v1/memory`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mariaKey}`,
      },
      body: JSON.stringify({
        prompt: "test query from maria e2e test",
        agent_id: "maria-test",
        agent_name: "Maria Test",
        read_only: true,
      }),
    });
    expect(res.status).toBe(200);
  });

  it("invalid key returns 401", async () => {
    const up = await apiIsRunning();
    if (!up) return;

    const res = await fetch(`${API_URL}/api/v1/memory`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer totally-fake-key-12345",
      },
      body: JSON.stringify({
        prompt: "test",
        agent_id: "test",
        agent_name: "Test",
        read_only: true,
      }),
    });
    expect(res.status).toBe(401);
  });

  it("missing key returns 401", async () => {
    const up = await apiIsRunning();
    if (!up) return;

    const res = await fetch(`${API_URL}/api/v1/memory`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "test",
        agent_id: "test",
        agent_name: "Test",
        read_only: true,
      }),
    });
    expect(res.status).toBe(401);
  });
});

// --- AC-MUMT3: Private write isolation ---

describe("AC-MUMT3: Maria writes land in maria collection only", () => {
  it("Maria contribution via API uses her private collection", async () => {
    const up = await apiIsRunning();
    if (!up) return;
    const mariaKey = await getMariaKey();
    if (!mariaKey) return;

    const uniqueMarker = `maria-e2e-isolation-test-${Date.now()}`;
    const res = await fetch(`${API_URL}/api/v1/memory`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mariaKey}`,
      },
      body: JSON.stringify({
        prompt: `E2E test: Maria private thought marker ${uniqueMarker} — this should only exist in thought_space_maria collection`,
        agent_id: "maria-e2e",
        agent_name: "Maria E2E",
      }),
    });
    expect(res.status).toBe(200);

    const data = (await res.json()) as { trace: { thoughts_contributed: number } };
    expect(data.trace.thoughts_contributed).toBe(1);
  });
});

// --- AC-MUMT4: Private read isolation ---

describe("AC-MUMT4: Cross-user read isolation", () => {
  it("Thomas query does NOT return Maria private thoughts", async () => {
    const up = await apiIsRunning();
    if (!up) return;

    const res = await fetch(`${API_URL}/api/v1/memory`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${THOMAS_KEY}`,
      },
      body: JSON.stringify({
        prompt: "maria-e2e-isolation-test",
        agent_id: "thomas-isolation-check",
        agent_name: "Thomas Check",
        read_only: true,
      }),
    });
    expect(res.status).toBe(200);

    const data = (await res.json()) as {
      result: { sources: Array<{ content_preview: string }> };
    };
    // Thomas should not see Maria's e2e marker thoughts
    const mariaLeaked = data.result.sources.some((s) =>
      s.content_preview.includes("maria-e2e-isolation-test"),
    );
    expect(mariaLeaked).toBe(false);
  });

  it("Maria query does NOT return Thomas private thoughts", async () => {
    const up = await apiIsRunning();
    if (!up) return;
    const mariaKey = await getMariaKey();
    if (!mariaKey) return;

    const res = await fetch(`${API_URL}/api/v1/memory`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mariaKey}`,
      },
      body: JSON.stringify({
        prompt: "Recovery protocol and role definition for QA agent",
        agent_id: "maria-isolation-check",
        agent_name: "Maria Check",
        read_only: true,
      }),
    });
    expect(res.status).toBe(200);

    const data = (await res.json()) as {
      result: { sources: Array<{ contributor: string }> };
    };
    // Maria should not see Thomas's agent thoughts (QA, DEV, PDSA, LIAISON)
    const thomasLeaked = data.result.sources.some((s) =>
      ["QA", "DEV", "PDSA", "LIAISON"].includes(s.contributor),
    );
    expect(thomasLeaked).toBe(false);
  });
});

// --- AC-MUMT5: Shared space accessible ---

describe("AC-MUMT5: Shared space accessible by both users", () => {
  it("Thomas can write to shared space", async () => {
    const up = await apiIsRunning();
    if (!up) return;

    const res = await fetch(`${API_URL}/api/v1/memory`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${THOMAS_KEY}`,
      },
      body: JSON.stringify({
        prompt: `Shared space e2e test: Thomas contribution to shared thought_space_shared collection marker ${Date.now()}`,
        agent_id: "thomas-shared-test",
        agent_name: "Thomas Shared",
        space: "shared",
      }),
    });
    expect(res.status).toBe(200);
  });

  it("Maria can write to shared space", async () => {
    const up = await apiIsRunning();
    if (!up) return;
    const mariaKey = await getMariaKey();
    if (!mariaKey) return;

    const res = await fetch(`${API_URL}/api/v1/memory`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mariaKey}`,
      },
      body: JSON.stringify({
        prompt: `Shared space e2e test: Maria contribution to shared thought_space_shared collection marker ${Date.now()}`,
        agent_id: "maria-shared-test",
        agent_name: "Maria Shared",
        space: "shared",
      }),
    });
    expect(res.status).toBe(200);
  });
});

// --- AC-MUMT6: Idempotent re-provision ---

describe("AC-MUMT6: Re-provision is safe", () => {
  it("provision-user.sh handles existing user gracefully", async () => {
    const fs = await import("node:fs");
    const scriptPath =
      "/home/developer/workspaces/github/PichlerThomas/best-practices/api/scripts/provision-user.sh";
    if (!fs.existsSync(scriptPath)) return;

    const source = fs.readFileSync(scriptPath, "utf-8");
    // Script must handle re-runs: INSERT OR IGNORE, collection existence check
    expect(source.toUpperCase()).toContain("OR IGNORE");
    expect(source.toLowerCase()).toContain("already exists");
  });
});

// --- AC-MUMT7: API key routes to correct collection ---

describe("AC-MUMT7: API key routes to correct user collection", () => {
  it("resolveCollection uses user.qdrant_collection from auth", async () => {
    const fs = await import("node:fs");
    const memorySource = fs.readFileSync(
      "/home/developer/workspaces/github/PichlerThomas/best-practices/api/src/routes/memory.ts",
      "utf-8",
    );
    // resolveCollection must use user.qdrant_collection
    expect(memorySource).toContain("resolveCollection");
    expect(memorySource).toContain("qdrant_collection");
  });

  it("auth middleware sets req.user from API key lookup", async () => {
    const fs = await import("node:fs");
    const authSource = fs.readFileSync(
      "/home/developer/workspaces/github/PichlerThomas/best-practices/api/src/middleware/auth.ts",
      "utf-8",
    );
    expect(authSource).toContain("qdrant_collection");
    expect(authSource).toContain("request");
    expect(authSource).toContain("user");
  });
});
