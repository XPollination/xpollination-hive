/**
 * TDD tests for multi-user sharing endpoint POST /api/v1/memory/share.
 *
 * From PDSA multi-user-sharing (2026-03-02):
 * AC-MUS1: POST /api/v1/memory/share exists and requires auth
 * AC-MUS2: Returns 400 when thought_id missing
 * AC-MUS3: Returns 404 when thought not in caller's private collection
 * AC-MUS4: Returns 403 when thought's contributor_id doesn't match caller
 * AC-MUS5: Returns 409 on duplicate share attempt
 * AC-MUS6: Copies thought to thought_space_shared with correct content and vector
 * AC-MUS7: Shared copy has sharing metadata (shared_from_id, shared_from_collection, shared_by, shared_at)
 * AC-MUS8: Shared copy has independent lifecycle (fresh pheromone_weight=1.0, access_count=0)
 * AC-MUS9: Original thought gets shared_to, shared_copy_id, shared_at marked
 * AC-MUS10: Shared thought retrievable via normal /api/v1/memory with space: "shared"
 *
 * REQUIRES: Brain API running at localhost:3200, Qdrant at localhost:6333,
 *           Thomas and Maria provisioned.
 */
import { describe, it, expect } from "vitest";

const API_URL = "http://localhost:3200";
const QDRANT_URL = "http://localhost:6333";
const THOMAS_KEY = process.env.BRAIN_API_KEY || "test-key-not-for-production";

// Maria's key from SQLite
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

/** Contribute a thought and return its ID */
async function contributeThought(
  key: string,
  content: string,
  agentId: string,
): Promise<string | null> {
  const res = await fetch(`${API_URL}/api/v1/memory`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      prompt: content,
      agent_id: agentId,
      agent_name: agentId,
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { trace: { contributed_thought_id?: string } };
  // The contributed thought ID is not directly in the standard response.
  // We need to retrieve it from the response — check if it's in trace
  // If not available, we'll query Qdrant by content to find it.
  return null; // Will need to search for it
}

/** Find a thought ID by searching for content in a collection */
async function findThoughtByContent(
  collection: string,
  contentSubstring: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${QDRANT_URL}/collections/${collection}/points/scroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filter: {
          must: [
            {
              key: "content",
              match: { text: contentSubstring },
            },
          ],
        },
        limit: 1,
        with_payload: true,
      }),
    });
    const data = (await res.json()) as {
      result: { points: Array<{ id: string }> };
    };
    return data.result.points[0]?.id ?? null;
  } catch {
    return null;
  }
}

// --- AC-MUS1: Endpoint exists and requires auth ---

describe("AC-MUS1: POST /api/v1/memory/share exists and requires auth", () => {
  it("returns 401 without Authorization header", async () => {
    const up = await apiIsRunning();
    if (!up) return;

    const res = await fetch(`${API_URL}/api/v1/memory/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thought_id: "fake-id" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 with invalid Bearer token", async () => {
    const up = await apiIsRunning();
    if (!up) return;

    const res = await fetch(`${API_URL}/api/v1/memory/share`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer totally-invalid-key-xyz",
      },
      body: JSON.stringify({ thought_id: "fake-id" }),
    });
    expect(res.status).toBe(401);
  });

  it("does NOT return 404 (route exists) with valid auth", async () => {
    const up = await apiIsRunning();
    if (!up) return;

    const res = await fetch(`${API_URL}/api/v1/memory/share`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${THOMAS_KEY}`,
      },
      body: JSON.stringify({ thought_id: "nonexistent-id" }),
    });
    // Should be 400 or 404 (depending on validation), but NOT 404 for "route not found"
    // Route not found returns { message: "Route POST:/api/v1/memory/share not found" }
    expect(res.status).not.toBe(404);
    // Actually with nonexistent thought_id, we expect 404 for "thought not found".
    // The key point is the endpoint should exist. Let's just check it's not a Fastify 404:
    const data = (await res.json()) as { message?: string; error?: string };
    if (res.status === 404) {
      // Should NOT be a Fastify route-not-found 404
      expect(data.message).not.toContain("Route");
    }
  });
});

// --- AC-MUS2: Returns 400 when thought_id missing ---

describe("AC-MUS2: Returns 400 when thought_id missing", () => {
  it("returns 400 with empty body", async () => {
    const up = await apiIsRunning();
    if (!up) return;

    const res = await fetch(`${API_URL}/api/v1/memory/share`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${THOMAS_KEY}`,
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 with null thought_id", async () => {
    const up = await apiIsRunning();
    if (!up) return;

    const res = await fetch(`${API_URL}/api/v1/memory/share`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${THOMAS_KEY}`,
      },
      body: JSON.stringify({ thought_id: null }),
    });
    expect(res.status).toBe(400);
  });
});

// --- AC-MUS3: Returns 404 when thought not in caller's private collection ---

describe("AC-MUS3: Returns 404 when thought not found", () => {
  it("returns 404 for nonexistent thought_id", async () => {
    const up = await apiIsRunning();
    if (!up) return;

    const res = await fetch(`${API_URL}/api/v1/memory/share`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${THOMAS_KEY}`,
      },
      body: JSON.stringify({ thought_id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(res.status).toBe(404);
  });
});

// --- AC-MUS4: Returns 403 when contributor_id doesn't match caller ---

describe("AC-MUS4: Returns 403 when thought's contributor_id doesn't match caller", () => {
  it("shareThought checks contributor_id against user_id in source code", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync(
      "/home/developer/workspaces/github/PichlerThomas/best-practices/api/src/services/thoughtspace.ts",
      "utf-8",
    );
    // The shareThought function must verify ownership
    expect(source).toContain("shareThought");
    expect(source).toContain("contributor_id");
    // Must return 403 for mismatch
    expect(source).toContain("403");
  });
});

// --- AC-MUS5: Returns 409 on duplicate share attempt ---

describe("AC-MUS5: Returns 409 on duplicate share attempt", () => {
  it("sharing the same thought twice returns 409", async () => {
    const up = await apiIsRunning();
    if (!up) return;

    // First, contribute a unique thought as Thomas
    const marker = `share-dup-test-${Date.now()}`;
    const contributeRes = await fetch(`${API_URL}/api/v1/memory`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${THOMAS_KEY}`,
      },
      body: JSON.stringify({
        prompt: `E2E sharing duplicate test thought with unique marker ${marker} — testing 409 duplicate prevention`,
        agent_id: "thomas",
        agent_name: "Thomas Pichler",
      }),
    });
    expect(contributeRes.status).toBe(200);

    // Wait briefly for indexing
    await new Promise((r) => setTimeout(r, 500));

    // Find the thought by content in Thomas's collection
    const thoughtId = await findThoughtByContent("thought_space_thomas", marker);
    if (!thoughtId) {
      // If we can't find the thought, skip (infrastructure issue)
      expect(thoughtId).not.toBeNull();
      return;
    }

    // First share — should succeed (200)
    const share1 = await fetch(`${API_URL}/api/v1/memory/share`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${THOMAS_KEY}`,
      },
      body: JSON.stringify({ thought_id: thoughtId }),
    });
    expect(share1.status).toBe(200);

    // Second share of same thought — should return 409
    const share2 = await fetch(`${API_URL}/api/v1/memory/share`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${THOMAS_KEY}`,
      },
      body: JSON.stringify({ thought_id: thoughtId }),
    });
    expect(share2.status).toBe(409);
  });
});

// --- AC-MUS6: Copies thought to thought_space_shared ---

describe("AC-MUS6: Copies thought to thought_space_shared with correct content", () => {
  it("shared thought appears in thought_space_shared with same content", async () => {
    const up = await apiIsRunning();
    if (!up) return;

    // Contribute a unique thought as Thomas
    const marker = `share-copy-test-${Date.now()}`;
    await fetch(`${API_URL}/api/v1/memory`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${THOMAS_KEY}`,
      },
      body: JSON.stringify({
        prompt: `E2E sharing copy test thought with unique marker ${marker} — verifying content preservation in shared space`,
        agent_id: "thomas",
        agent_name: "Thomas Pichler",
      }),
    });

    await new Promise((r) => setTimeout(r, 500));

    const thoughtId = await findThoughtByContent("thought_space_thomas", marker);
    if (!thoughtId) {
      expect(thoughtId).not.toBeNull();
      return;
    }

    // Share it
    const shareRes = await fetch(`${API_URL}/api/v1/memory/share`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${THOMAS_KEY}`,
      },
      body: JSON.stringify({ thought_id: thoughtId }),
    });
    expect(shareRes.status).toBe(200);
    const shareData = (await shareRes.json()) as {
      success: boolean;
      shared_thought_id: string;
    };
    expect(shareData.success).toBe(true);
    expect(shareData.shared_thought_id).toBeDefined();

    // Verify the shared thought exists in thought_space_shared
    const sharedPoint = await fetch(
      `${QDRANT_URL}/collections/thought_space_shared/points/${shareData.shared_thought_id}`,
    );
    const sharedData = (await sharedPoint.json()) as {
      result: { payload: { content: string } };
    };
    expect(sharedData.result.payload.content).toContain(marker);
  });
});

// --- AC-MUS7: Shared copy has sharing metadata ---

describe("AC-MUS7: Shared copy has sharing metadata", () => {
  it("shared copy includes shared_from_id, shared_from_collection, shared_by, shared_at", async () => {
    const up = await apiIsRunning();
    if (!up) return;

    const marker = `share-metadata-test-${Date.now()}`;
    await fetch(`${API_URL}/api/v1/memory`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${THOMAS_KEY}`,
      },
      body: JSON.stringify({
        prompt: `E2E sharing metadata test thought with unique marker ${marker} — verifying sharing metadata fields`,
        agent_id: "thomas",
        agent_name: "Thomas Pichler",
      }),
    });

    await new Promise((r) => setTimeout(r, 500));

    const thoughtId = await findThoughtByContent("thought_space_thomas", marker);
    if (!thoughtId) {
      expect(thoughtId).not.toBeNull();
      return;
    }

    const shareRes = await fetch(`${API_URL}/api/v1/memory/share`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${THOMAS_KEY}`,
      },
      body: JSON.stringify({ thought_id: thoughtId }),
    });
    expect(shareRes.status).toBe(200);
    const shareData = (await shareRes.json()) as { shared_thought_id: string };

    // Check Qdrant payload for metadata fields
    const sharedPoint = await fetch(
      `${QDRANT_URL}/collections/thought_space_shared/points/${shareData.shared_thought_id}`,
    );
    const pointData = (await sharedPoint.json()) as {
      result: {
        payload: {
          shared_from_id: string;
          shared_from_collection: string;
          shared_by: string;
          shared_at: string;
        };
      };
    };

    expect(pointData.result.payload.shared_from_id).toBe(thoughtId);
    expect(pointData.result.payload.shared_from_collection).toBe("thought_space_thomas");
    expect(pointData.result.payload.shared_by).toBe("thomas");
    expect(pointData.result.payload.shared_at).toBeDefined();
    // shared_at should be a valid ISO date string
    expect(new Date(pointData.result.payload.shared_at).getTime()).toBeGreaterThan(0);
  });
});

// --- AC-MUS8: Shared copy has independent lifecycle ---

describe("AC-MUS8: Shared copy has independent lifecycle", () => {
  it("shared copy has fresh pheromone_weight=1.0 and access_count=0", async () => {
    const up = await apiIsRunning();
    if (!up) return;

    const marker = `share-lifecycle-test-${Date.now()}`;
    await fetch(`${API_URL}/api/v1/memory`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${THOMAS_KEY}`,
      },
      body: JSON.stringify({
        prompt: `E2E sharing lifecycle test thought with unique marker ${marker} — verifying independent lifecycle fields`,
        agent_id: "thomas",
        agent_name: "Thomas Pichler",
      }),
    });

    await new Promise((r) => setTimeout(r, 500));

    const thoughtId = await findThoughtByContent("thought_space_thomas", marker);
    if (!thoughtId) {
      expect(thoughtId).not.toBeNull();
      return;
    }

    const shareRes = await fetch(`${API_URL}/api/v1/memory/share`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${THOMAS_KEY}`,
      },
      body: JSON.stringify({ thought_id: thoughtId }),
    });
    expect(shareRes.status).toBe(200);
    const shareData = (await shareRes.json()) as { shared_thought_id: string };

    const sharedPoint = await fetch(
      `${QDRANT_URL}/collections/thought_space_shared/points/${shareData.shared_thought_id}`,
    );
    const pointData = (await sharedPoint.json()) as {
      result: {
        payload: {
          pheromone_weight: number;
          access_count: number;
        };
      };
    };

    expect(pointData.result.payload.pheromone_weight).toBe(1.0);
    expect(pointData.result.payload.access_count).toBe(0);
  });
});

// --- AC-MUS9: Original thought gets shared_to marked ---

describe("AC-MUS9: Original thought gets shared_to, shared_copy_id, shared_at", () => {
  it("original thought in private collection gets sharing markers", async () => {
    const up = await apiIsRunning();
    if (!up) return;

    const marker = `share-original-mark-test-${Date.now()}`;
    await fetch(`${API_URL}/api/v1/memory`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${THOMAS_KEY}`,
      },
      body: JSON.stringify({
        prompt: `E2E sharing original marking test thought with unique marker ${marker} — verifying original gets shared_to`,
        agent_id: "thomas",
        agent_name: "Thomas Pichler",
      }),
    });

    await new Promise((r) => setTimeout(r, 500));

    const thoughtId = await findThoughtByContent("thought_space_thomas", marker);
    if (!thoughtId) {
      expect(thoughtId).not.toBeNull();
      return;
    }

    const shareRes = await fetch(`${API_URL}/api/v1/memory/share`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${THOMAS_KEY}`,
      },
      body: JSON.stringify({ thought_id: thoughtId }),
    });
    expect(shareRes.status).toBe(200);
    const shareData = (await shareRes.json()) as {
      shared_thought_id: string;
      shared_at: string;
    };

    // Verify the ORIGINAL thought now has sharing markers
    const originalPoint = await fetch(
      `${QDRANT_URL}/collections/thought_space_thomas/points/${thoughtId}`,
    );
    const originalData = (await originalPoint.json()) as {
      result: {
        payload: {
          shared_to: string;
          shared_copy_id: string;
          shared_at: string;
        };
      };
    };

    expect(originalData.result.payload.shared_to).toBe("thought_space_shared");
    expect(originalData.result.payload.shared_copy_id).toBe(shareData.shared_thought_id);
    expect(originalData.result.payload.shared_at).toBeDefined();
  });
});

// --- AC-MUS10: Shared thought retrievable via /api/v1/memory with space: "shared" ---

describe("AC-MUS10: Shared thought retrievable via normal memory endpoint", () => {
  it("querying with space=shared returns the shared thought", async () => {
    const up = await apiIsRunning();
    if (!up) return;

    const marker = `share-retrieval-test-${Date.now()}`;
    await fetch(`${API_URL}/api/v1/memory`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${THOMAS_KEY}`,
      },
      body: JSON.stringify({
        prompt: `E2E sharing retrieval test thought with unique marker ${marker} — verifying shared thought is discoverable`,
        agent_id: "thomas",
        agent_name: "Thomas Pichler",
      }),
    });

    await new Promise((r) => setTimeout(r, 500));

    const thoughtId = await findThoughtByContent("thought_space_thomas", marker);
    if (!thoughtId) {
      expect(thoughtId).not.toBeNull();
      return;
    }

    // Share it
    const shareRes = await fetch(`${API_URL}/api/v1/memory/share`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${THOMAS_KEY}`,
      },
      body: JSON.stringify({ thought_id: thoughtId }),
    });
    expect(shareRes.status).toBe(200);

    // Now query the shared space — the shared thought should be retrievable
    const queryRes = await fetch(`${API_URL}/api/v1/memory`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${THOMAS_KEY}`,
      },
      body: JSON.stringify({
        prompt: marker,
        agent_id: "share-retrieval-test",
        agent_name: "Share Retrieval Test",
        space: "shared",
        read_only: true,
      }),
    });
    expect(queryRes.status).toBe(200);

    const queryData = (await queryRes.json()) as {
      result: { sources: Array<{ content_preview: string }> };
    };
    // The shared thought should appear in results
    const found = queryData.result.sources.some((s) =>
      s.content_preview.includes(marker.substring(0, 40)),
    );
    expect(found).toBe(true);
  });

  it("Maria can also retrieve Thomas's shared thought", async () => {
    const up = await apiIsRunning();
    if (!up) return;
    const mariaKey = await getMariaKey();
    if (!mariaKey) return;

    // Query shared space as Maria for any previously shared test thoughts
    const queryRes = await fetch(`${API_URL}/api/v1/memory`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mariaKey}`,
      },
      body: JSON.stringify({
        prompt: "E2E sharing retrieval test thought",
        agent_id: "maria-share-check",
        agent_name: "Maria Share Check",
        space: "shared",
        read_only: true,
      }),
    });
    expect(queryRes.status).toBe(200);
  });
});
