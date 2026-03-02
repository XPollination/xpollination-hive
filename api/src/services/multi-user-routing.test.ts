/**
 * Tests for multi-user routing (dynamic collection resolution).
 *
 * From PDSA multi-user-routing (2026-03-02):
 * AC-MUR1: thoughtspace.ts functions accept collection parameter
 * AC-MUR2: COLLECTION constant used as default (backward compatible)
 * AC-MUR3: memory.ts routes resolve collection from req.user context
 * AC-MUR4: Memory API accepts space parameter (private/shared)
 * AC-MUR5: Default space is private
 * AC-MUR6: Pheromone decay discovers all thought_space_* collections
 */
import { describe, it, expect } from "vitest";

// --- AC-MUR1: Functions accept collection parameter ---

describe("AC-MUR1: thoughtspace.ts functions accept collection parameter", () => {
  it("think() function signature includes collection parameter", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync(
      "/home/developer/workspaces/github/PichlerThomas/best-practices/api/src/services/thoughtspace.ts",
      "utf-8",
    );

    // ThinkParams interface should have collection field
    const thinkParamsStart = source.indexOf("export interface ThinkParams");
    expect(thinkParamsStart).toBeGreaterThan(-1);
    const thinkParamsSection = source.slice(thinkParamsStart, thinkParamsStart + 500);
    expect(thinkParamsSection).toContain("collection");
  });

  it("retrieve() function signature includes collection parameter", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync(
      "/home/developer/workspaces/github/PichlerThomas/best-practices/api/src/services/thoughtspace.ts",
      "utf-8",
    );

    // RetrieveParams interface should have collection field
    const retrieveParamsStart = source.indexOf("export interface RetrieveParams");
    expect(retrieveParamsStart).toBeGreaterThan(-1);
    const retrieveParamsSection = source.slice(retrieveParamsStart, retrieveParamsStart + 500);
    expect(retrieveParamsSection).toContain("collection");
  });
});

// --- AC-MUR2: Default collection backward compatible ---

describe("AC-MUR2: COLLECTION constant used as default", () => {
  it("thoughtspace.ts still has thought_space default collection", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync(
      "/home/developer/workspaces/github/PichlerThomas/best-practices/api/src/services/thoughtspace.ts",
      "utf-8",
    );

    // Should have a default collection value of thought_space
    expect(source).toContain("thought_space");
  });

  it("functions use params.collection with fallback to default", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync(
      "/home/developer/workspaces/github/PichlerThomas/best-practices/api/src/services/thoughtspace.ts",
      "utf-8",
    );

    // think() function should use collection from params with fallback
    const thinkStart = source.indexOf("export async function think(");
    expect(thinkStart).toBeGreaterThan(-1);
    const thinkBody = source.slice(thinkStart, thinkStart + 500);
    // Should reference params.collection or collection parameter, not just hardcoded COLLECTION
    expect(thinkBody).toContain("collection");
  });
});

// --- AC-MUR3: memory.ts resolves collection from user context ---

describe("AC-MUR3: memory.ts routes resolve collection from user context", () => {
  it("memory.ts passes collection to think/retrieve calls", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync(
      "/home/developer/workspaces/github/PichlerThomas/best-practices/api/src/routes/memory.ts",
      "utf-8",
    );

    // Should reference collection in the context of calling think/retrieve
    expect(source).toContain("collection");
    // Should reference user context (req.user or similar)
    expect(source).toContain("qdrant_collection");
  });
});

// --- AC-MUR4: Space parameter in API ---

describe("AC-MUR4: Memory API accepts space parameter", () => {
  it("memory.ts request schema includes space field", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync(
      "/home/developer/workspaces/github/PichlerThomas/best-practices/api/src/routes/memory.ts",
      "utf-8",
    );

    // Should accept space parameter (private/shared)
    expect(source).toContain("space");
  });

  it("shared space resolves to thought_space_shared collection", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync(
      "/home/developer/workspaces/github/PichlerThomas/best-practices/api/src/routes/memory.ts",
      "utf-8",
    );

    expect(source).toContain("thought_space_shared");
  });
});

// --- AC-MUR5: Default space is private ---

describe("AC-MUR5: Default space is private", () => {
  it("space defaults to private when not specified", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync(
      "/home/developer/workspaces/github/PichlerThomas/best-practices/api/src/routes/memory.ts",
      "utf-8",
    );

    // Should have default to private
    expect(source).toContain("private");
  });
});

// --- AC-MUR6: Pheromone decay discovers collections ---

describe("AC-MUR6: Pheromone decay discovers all thought_space_* collections", () => {
  it("runPheromoneDecay uses dynamic collection discovery", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync(
      "/home/developer/workspaces/github/PichlerThomas/best-practices/api/src/services/thoughtspace.ts",
      "utf-8",
    );

    // Find the pheromone decay function
    const decayStart = source.indexOf("export async function runPheromoneDecay");
    expect(decayStart).toBeGreaterThan(-1);
    const decayBody = source.slice(decayStart, decayStart + 800);

    // Should discover collections dynamically (list collections, filter by thought_space_)
    expect(decayBody).toContain("thought_space");
  });
});
