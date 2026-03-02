/**
 * TDD tests for multi-user gardening skill updates.
 *
 * From PDSA multi-user-gardening (2026-03-02):
 * AC-MUG1: Gardener skill accepts --space=private|shared parameter
 * AC-MUG2: Default (no --space) gardens caller's private collection
 * AC-MUG3: --space=shared gardens thought_space_shared
 * AC-MUG4: All gardener API calls (discover, consolidate, refine, categorize) pass space parameter when shared
 * AC-MUG5: Consolidation within shared space creates new thought in shared collection
 * AC-MUG6: Private gardening does not affect shared collection
 * AC-MUG7: Shared gardening does not affect private collections
 *
 * REQUIRES: Brain API running at localhost:3200, Qdrant at localhost:6333
 * NOTE: This task modifies only the gardener SKILL.md file. API already supports space parameter.
 */
import { describe, it, expect } from "vitest";

const API_URL = "http://localhost:3200";
const QDRANT_URL = "http://localhost:6333";
const THOMAS_KEY = process.env.BRAIN_API_KEY || "test-key-not-for-production";

const SKILL_PATH =
  "/home/developer/.claude/skills/xpo.claude.mindspace.garden/SKILL.md";
const SKILL_SOURCE_PATH =
  "/home/developer/workspaces/github/PichlerThomas/best-practices/.claude/skills/xpo.claude.mindspace.garden/SKILL.md";

async function apiIsRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/v1/health`);
    return res.ok;
  } catch {
    return false;
  }
}

function readSkillFile(): string {
  const fs = require("node:fs");
  // Try git-tracked source first, then installed location
  for (const path of [SKILL_SOURCE_PATH, SKILL_PATH]) {
    try {
      return fs.readFileSync(path, "utf-8");
    } catch {
      continue;
    }
  }
  return "";
}

// --- AC-MUG1: Gardener skill accepts --space parameter ---

describe("AC-MUG1: Gardener skill accepts --space=private|shared parameter", () => {
  it("SKILL.md documents --space parameter in invocation syntax", () => {
    const source = readSkillFile();
    expect(source).not.toBe("");

    // The invocation syntax must mention --space
    expect(source).toContain("--space");
  });

  it("SKILL.md documents private and shared as space values", () => {
    const source = readSkillFile();
    expect(source).toContain("private");
    expect(source).toContain("shared");
    // Should document both options as space parameter values
    expect(source).toMatch(/--space[=\s]*(private|shared)/);
  });

  it("SKILL.md parameter parsing includes space argument handling", () => {
    const source = readSkillFile();
    // The step 1 argument parsing must handle --space
    expect(source.toLowerCase()).toContain("space");
    // Should have a SPACE variable or space extraction logic
    expect(source).toMatch(/SPACE|space/);
  });
});

// --- AC-MUG2: Default (no --space) gardens private collection ---

describe("AC-MUG2: Default (no --space) gardens caller's private collection", () => {
  it("SKILL.md states default space is private", () => {
    const source = readSkillFile();
    // Should explicitly state default is private
    expect(source.toLowerCase()).toMatch(/default.*private|private.*default/);
  });

  it("API without space parameter writes to private collection", async () => {
    const up = await apiIsRunning();
    if (!up) return;

    const marker = `gardener-private-default-test-${Date.now()}`;
    const res = await fetch(`${API_URL}/api/v1/memory`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${THOMAS_KEY}`,
      },
      body: JSON.stringify({
        prompt: `E2E gardener default space test with marker ${marker} — should go to private collection only`,
        agent_id: "agent-gardener",
        agent_name: "GARDENER",
      }),
    });
    expect(res.status).toBe(200);

    // Wait for indexing
    await new Promise((r) => setTimeout(r, 500));

    // Verify it's in Thomas's private collection (thought_space_thomas)
    const scrollRes = await fetch(
      `${QDRANT_URL}/collections/thought_space_thomas/points/scroll`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filter: { must: [{ key: "content", match: { text: marker } }] },
          limit: 1,
          with_payload: true,
        }),
      },
    );
    const scrollData = (await scrollRes.json()) as {
      result: { points: Array<{ id: string }> };
    };
    expect(scrollData.result.points.length).toBeGreaterThan(0);
  });
});

// --- AC-MUG3: --space=shared gardens thought_space_shared ---

describe("AC-MUG3: --space=shared gardens thought_space_shared", () => {
  it("SKILL.md documents that shared targets thought_space_shared", () => {
    const source = readSkillFile();
    expect(source).toContain("thought_space_shared");
  });

  it("API with space=shared writes to thought_space_shared", async () => {
    const up = await apiIsRunning();
    if (!up) return;

    const marker = `gardener-shared-space-test-${Date.now()}`;
    const res = await fetch(`${API_URL}/api/v1/memory`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${THOMAS_KEY}`,
      },
      body: JSON.stringify({
        prompt: `E2E gardener shared space test with marker ${marker} — should go to thought_space_shared`,
        agent_id: "agent-gardener",
        agent_name: "GARDENER",
        space: "shared",
      }),
    });
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 500));

    // Verify it's in thought_space_shared
    const scrollRes = await fetch(
      `${QDRANT_URL}/collections/thought_space_shared/points/scroll`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filter: { must: [{ key: "content", match: { text: marker } }] },
          limit: 1,
          with_payload: true,
        }),
      },
    );
    const scrollData = (await scrollRes.json()) as {
      result: { points: Array<{ id: string }> };
    };
    expect(scrollData.result.points.length).toBeGreaterThan(0);
  });
});

// --- AC-MUG4: All gardener API calls pass space parameter when shared ---

describe("AC-MUG4: All gardener API calls include space parameter when shared", () => {
  it("SKILL.md API call examples include space parameter for shared gardening", () => {
    const source = readSkillFile();
    // When gardening shared space, all curl examples must include "space": "shared"
    // The skill file should show space in the JSON body of API calls
    expect(source).toContain('"space"');
    // Should mention space in the context of shared gardening
    expect(source).toMatch(/"space"\s*:\s*"shared"/);
  });

  it("SKILL.md shows space parameter in discover/consolidate/refine operations", () => {
    const source = readSkillFile();
    // Multiple API call sections should mention space
    // Count occurrences of "space": "shared" in the file
    const matches = source.match(/"space"\s*:\s*"shared"/g) || [];
    // At least 2 occurrences (discover + consolidate or refine)
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

// --- AC-MUG5: Consolidation within shared space stays in shared collection ---

describe("AC-MUG5: Consolidation within shared creates thought in shared collection", () => {
  it("API consolidation with space=shared creates result in thought_space_shared", async () => {
    const up = await apiIsRunning();
    if (!up) return;

    // Create two thoughts in shared space
    const marker1 = `gardener-consol-shared-A-${Date.now()}`;
    const marker2 = `gardener-consol-shared-B-${Date.now()}`;

    const res1 = await fetch(`${API_URL}/api/v1/memory`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${THOMAS_KEY}`,
      },
      body: JSON.stringify({
        prompt: `E2E consolidation test shared thought A with marker ${marker1} — testing gardener consolidation in shared space stays shared`,
        agent_id: "agent-gardener",
        agent_name: "GARDENER",
        space: "shared",
      }),
    });
    expect(res1.status).toBe(200);

    const res2 = await fetch(`${API_URL}/api/v1/memory`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${THOMAS_KEY}`,
      },
      body: JSON.stringify({
        prompt: `E2E consolidation test shared thought B with marker ${marker2} — testing gardener consolidation in shared space stays shared`,
        agent_id: "agent-gardener",
        agent_name: "GARDENER",
        space: "shared",
      }),
    });
    expect(res2.status).toBe(200);

    await new Promise((r) => setTimeout(r, 500));

    // Find both thought IDs in thought_space_shared
    const findId = async (marker: string): Promise<string | null> => {
      const scrollRes = await fetch(
        `${QDRANT_URL}/collections/thought_space_shared/points/scroll`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filter: { must: [{ key: "content", match: { text: marker } }] },
            limit: 1,
          }),
        },
      );
      const data = (await scrollRes.json()) as {
        result: { points: Array<{ id: string }> };
      };
      return data.result.points[0]?.id ?? null;
    };

    const id1 = await findId(marker1);
    const id2 = await findId(marker2);
    if (!id1 || !id2) {
      expect(id1).not.toBeNull();
      expect(id2).not.toBeNull();
      return;
    }

    // Consolidate them in shared space
    const consolRes = await fetch(`${API_URL}/api/v1/memory`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${THOMAS_KEY}`,
      },
      body: JSON.stringify({
        prompt: `CONSOLIDATED: E2E gardener consolidation test — merged two shared thoughts into one coherent learning`,
        agent_id: "agent-gardener",
        agent_name: "GARDENER",
        consolidates: [id1, id2],
        space: "shared",
      }),
    });
    expect(consolRes.status).toBe(200);

    const consolData = (await consolRes.json()) as {
      trace: { thoughts_contributed: number };
    };
    expect(consolData.trace.thoughts_contributed).toBe(1);
  });
});

// --- AC-MUG6: Private gardening does not affect shared collection ---

describe("AC-MUG6: Private gardening does not affect shared collection", () => {
  it("contribution without space param does not appear in thought_space_shared", async () => {
    const up = await apiIsRunning();
    if (!up) return;

    const marker = `gardener-private-isolation-test-${Date.now()}`;
    const res = await fetch(`${API_URL}/api/v1/memory`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${THOMAS_KEY}`,
      },
      body: JSON.stringify({
        prompt: `E2E gardener private isolation test with marker ${marker} — this should NOT appear in thought_space_shared`,
        agent_id: "agent-gardener",
        agent_name: "GARDENER",
      }),
    });
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 500));

    // Should NOT be in thought_space_shared
    const scrollRes = await fetch(
      `${QDRANT_URL}/collections/thought_space_shared/points/scroll`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filter: { must: [{ key: "content", match: { text: marker } }] },
          limit: 1,
        }),
      },
    );
    const scrollData = (await scrollRes.json()) as {
      result: { points: Array<{ id: string }> };
    };
    expect(scrollData.result.points.length).toBe(0);
  });
});

// --- AC-MUG7: Shared gardening does not affect private collections ---

describe("AC-MUG7: Shared gardening does not affect private collections", () => {
  it("contribution with space=shared does not appear in thought_space_thomas", async () => {
    const up = await apiIsRunning();
    if (!up) return;

    const marker = `gardener-shared-isolation-test-${Date.now()}`;
    const res = await fetch(`${API_URL}/api/v1/memory`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${THOMAS_KEY}`,
      },
      body: JSON.stringify({
        prompt: `E2E gardener shared isolation test with marker ${marker} — this should NOT appear in thought_space_thomas`,
        agent_id: "agent-gardener",
        agent_name: "GARDENER",
        space: "shared",
      }),
    });
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 500));

    // Should NOT be in thought_space_thomas
    const scrollRes = await fetch(
      `${QDRANT_URL}/collections/thought_space_thomas/points/scroll`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filter: { must: [{ key: "content", match: { text: marker } }] },
          limit: 1,
        }),
      },
    );
    const scrollData = (await scrollRes.json()) as {
      result: { points: Array<{ id: string }> };
    };
    expect(scrollData.result.points.length).toBe(0);
  });
});
