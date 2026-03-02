import { QdrantClient } from "@qdrant/js-client-rest";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { embed, EMBEDDING_DIM } from "./embedding.js";
import { insertQueryLog } from "./database.js";
import { SCORING_CONFIG } from "../scoring-config.js";

const COLLECTION = "thought_space";
const client = new QdrantClient({ url: "http://localhost:6333" });

// --- Collection Setup ---

export async function ensureThoughtSpace(): Promise<void> {
  const collections = await client.getCollections();
  const names = collections.collections.map((c) => c.name);

  if (!names.includes(COLLECTION)) {
    await client.createCollection(COLLECTION, {
      vectors: { size: EMBEDDING_DIM, distance: "Cosine" },
      optimizers_config: { default_segment_number: 2 },
      replication_factor: 1,
    });
    console.log("Created collection: thought_space");

    // Create payload indexes per Section 5.1
    const keywordIndexes = [
      "contributor_id",
      "thought_type",
      "tags",
      "knowledge_space_id",
      "thought_category",
      "topic",
      "quality_flags",
    ];
    const integerIndexes = ["access_count"];
    const floatIndexes = ["pheromone_weight"];
    const datetimeIndexes = ["created_at", "last_accessed"];

    for (const field of keywordIndexes) {
      await client.createPayloadIndex(COLLECTION, {
        field_name: field,
        field_schema: "keyword",
        wait: true,
      });
    }
    for (const field of integerIndexes) {
      await client.createPayloadIndex(COLLECTION, {
        field_name: field,
        field_schema: "integer",
        wait: true,
      });
    }
    for (const field of floatIndexes) {
      await client.createPayloadIndex(COLLECTION, {
        field_name: field,
        field_schema: "float",
        wait: true,
      });
    }
    for (const field of datetimeIndexes) {
      await client.createPayloadIndex(COLLECTION, {
        field_name: field,
        field_schema: "datetime",
        wait: true,
      });
    }

    console.log("Created payload indexes on thought_space");
  } else {
    // Ensure new indexes exist on existing collection (backward-compatible migration)
    const newKeywordIndexes = ["thought_category", "topic", "quality_flags"];
    for (const field of newKeywordIndexes) {
      try {
        await client.createPayloadIndex(COLLECTION, {
          field_name: field,
          field_schema: "keyword",
          wait: true,
        });
      } catch {
        // Index may already exist, ignore
      }
    }
  }
}

// --- Types ---

export type ThoughtCategory = "state_snapshot" | "decision_record" | "operational_learning" | "task_outcome" | "correction" | "uncategorized" | "transition_marker" | "design_decision" | "domain_summary" | "noise";

export interface SourceRef {
  type: "task" | "file" | "commit" | "url";
  value: string;
  project?: string;
}

export interface ThinkParams {
  content: string;
  contributor_id: string;
  contributor_name: string;
  thought_type: "original" | "refinement" | "consolidation";
  source_ids: string[];
  tags: string[];
  context_metadata?: string;
  // Brain contribution quality fields (all optional, backward compatible)
  thought_category?: ThoughtCategory;
  topic?: string;
  temporal_scope?: string;
  source_ref?: SourceRef;
  alternatives_considered?: string;
  quality_flags?: string[];
  // Correction-specific fields
  corrected_fact?: string;
  correct_fact?: string;
  supersedes?: string[];
}

export interface ThinkResult {
  thought_id: string;
  pheromone_weight: number;
  quality_flags?: string[];
}

export interface RetrieveParams {
  query_embedding: number[];
  agent_id: string;
  session_id: string;
  limit?: number;
  filter_tags?: string[];
  query_text?: string;
  filter_topic?: string;
  filter_category?: ThoughtCategory;
}

export interface RetrieveResult {
  thought_id: string;
  content: string;
  contributor_name: string;
  score: number;
  pheromone_weight: number;
  tags: string[];
  refined_by?: string;
  superseded?: boolean;
  superseded_by_consolidation?: boolean;
  // Brain contribution quality fields
  thought_category?: ThoughtCategory;
  topic?: string;
  temporal_scope?: string;
  quality_flags?: string[];
}

export interface LineageResult {
  thought_id: string;
  chain: LineageNode[];
  truncated: boolean;
}

export interface LineageNode {
  thought_id: string;
  thought_type: "original" | "refinement" | "consolidation";
  content_preview: string;
  contributor: string;
  created_at: string;
  source_ids: string[];
  depth: number;
}

// --- think() — Section 4.1 ---

export async function think(params: ThinkParams): Promise<ThinkResult> {
  // Validate
  if (!params.content || params.content.trim().length === 0) {
    throw new ThoughtError("VALIDATION_ERROR", "content is required and must be a non-empty string");
  }
  if (params.content.length > 10000) {
    throw new ThoughtError("VALIDATION_ERROR", "content must be at most 10000 characters");
  }
  if (!params.contributor_id || params.contributor_id.trim().length === 0) {
    throw new ThoughtError("VALIDATION_ERROR", "contributor_id is required");
  }
  if (!params.contributor_name || params.contributor_name.trim().length === 0) {
    throw new ThoughtError("VALIDATION_ERROR", "contributor_name is required");
  }
  const validTypes = ["original", "refinement", "consolidation"];
  if (!validTypes.includes(params.thought_type)) {
    throw new ThoughtError("INVALID_THOUGHT_TYPE", `thought_type must be one of: ${validTypes.join(", ")}`);
  }
  if (
    (params.thought_type === "refinement" || params.thought_type === "consolidation") &&
    (!params.source_ids || params.source_ids.length === 0)
  ) {
    throw new ThoughtError("MISSING_SOURCE_IDS", "source_ids is required for refinement and consolidation thoughts");
  }
  if (params.context_metadata && params.context_metadata.length > 2000) {
    throw new ThoughtError("VALIDATION_ERROR", "context_metadata must be at most 2000 characters");
  }

  // Embed content
  let vector: number[];
  try {
    vector = await embed(params.content);
  } catch (err) {
    throw new ThoughtError("EMBEDDING_FAILED", `Embedding model error: ${err}`);
  }

  // Generate UUID and upsert
  const thoughtId = uuidv4();
  const now = new Date().toISOString();

  // Pheromone inheritance (Section 4.1)
  let initialWeight = 1.0;
  if (params.thought_type === "refinement" && params.source_ids.length > 0) {
    const source = await getThoughtById(params.source_ids[0]);
    if (source) {
      const sourceWeight = (source.pheromone_weight as number) ?? 1.0;
      initialWeight = Math.max(1.0, sourceWeight * 0.5);
    }
  } else if (params.thought_type === "consolidation" && params.source_ids.length > 0) {
    const sources = await getThoughtsByIds(params.source_ids);
    if (sources.length > 0) {
      const avgWeight = sources.reduce((sum, s) => sum + ((s.pheromone_weight as number) ?? 1.0), 0) / sources.length;
      initialWeight = Math.max(1.0, avgWeight * 0.5);
    }
  }

  const payload: Record<string, unknown> = {
    contributor_id: params.contributor_id,
    contributor_name: params.contributor_name,
    content: params.content,
    thought_type: params.thought_type,
    source_ids: params.source_ids,
    superseded_by_consolidation: false,
    superseded_by_correction: false,
    context_metadata: params.context_metadata ?? null,
    created_at: now,
    tags: params.tags,
    access_count: 0,
    last_accessed: null,
    accessed_by: [],
    access_log: [],
    co_retrieved_with: [],
    pheromone_weight: initialWeight,
    knowledge_space_id: "ks-default",
    // Brain contribution quality fields
    thought_category: params.thought_category ?? "uncategorized",
    topic: params.topic ?? null,
    temporal_scope: params.temporal_scope ?? null,
    source_ref: params.source_ref ?? null,
    alternatives_considered: params.alternatives_considered ?? null,
    quality_flags: params.quality_flags ?? [],
    // Correction-specific fields
    corrected_fact: params.corrected_fact ?? null,
    correct_fact: params.correct_fact ?? null,
  };

  try {
    await client.upsert(COLLECTION, {
      wait: true,
      points: [{ id: thoughtId, vector, payload }],
    });
  } catch (err) {
    throw new ThoughtError("QDRANT_ERROR", `Qdrant upsert failed: ${err}`);
  }

  // Correction category: mark superseded thoughts with hard penalty flag
  if (params.thought_category === "correction" && params.supersedes && params.supersedes.length > 0) {
    for (const supersededId of params.supersedes) {
      try {
        await client.setPayload(COLLECTION, {
          points: [supersededId],
          payload: { superseded_by_correction: true },
          wait: true,
        });
      } catch (err) {
        console.error(`Failed to mark thought ${supersededId} as superseded by correction:`, err);
      }
    }
  }

  // Consolidation: mark source_ids as superseded_by_consolidation
  if (params.thought_type === "consolidation" && params.source_ids && params.source_ids.length > 0) {
    for (const sourceId of params.source_ids) {
      try {
        await client.setPayload(COLLECTION, {
          points: [sourceId],
          payload: { superseded_by_consolidation: true },
          wait: true,
        });
      } catch (err) {
        console.error(`Failed to mark thought ${sourceId} as superseded by consolidation:`, err);
      }
    }
  }

  return { thought_id: thoughtId, pheromone_weight: initialWeight, quality_flags: params.quality_flags };
}

// --- retrieve() — Section 4.2 (Phase 2: full access tracking + pheromone) ---

export async function retrieve(params: RetrieveParams): Promise<RetrieveResult[]> {
  const limit = params.limit ?? 10;
  const sessionId = params.session_id || crypto.randomUUID();
  const now = new Date().toISOString();

  // Build filter combining tags, topic, and category
  const filterConditions: Record<string, unknown>[] = [];
  if (params.filter_tags && params.filter_tags.length > 0) {
    filterConditions.push({ key: "tags", match: { any: params.filter_tags } });
  }
  if (params.filter_topic) {
    filterConditions.push({ key: "topic", match: { value: params.filter_topic } });
  }
  if (params.filter_category) {
    filterConditions.push({ key: "thought_category", match: { value: params.filter_category } });
  }
  const filter = filterConditions.length > 0 ? { must: filterConditions } : undefined;

  let results;
  try {
    results = await client.search(COLLECTION, {
      vector: params.query_embedding,
      limit,
      with_payload: true,
      ...(filter ? { filter } : {}),
    });
  } catch (err) {
    throw new ThoughtError("QDRANT_ERROR", `Qdrant search failed: ${err}`);
  }

  const resultIds = results.map((r) => String(r.id));

  // Update each result: access tracking + pheromone reinforcement
  for (const r of results) {
    const p = r.payload as Record<string, unknown>;
    const pointId = String(r.id);

    // Access count
    const accessCount = ((p.access_count as number) ?? 0) + 1;

    // Pheromone reinforcement: +0.05, cap 10.0
    const oldWeight = (p.pheromone_weight as number) ?? 1.0;
    const newWeight = Math.min(10.0, oldWeight + 0.05);

    // accessed_by: deduplicated agent_ids
    const accessedBy = (p.accessed_by as string[]) ?? [];
    if (!accessedBy.includes(params.agent_id)) {
      accessedBy.push(params.agent_id);
    }

    // access_log: append entry, cap at 100
    const accessLog = (p.access_log as Array<{ user_id: string; timestamp: string; session_id: string }>) ?? [];
    accessLog.push({ user_id: params.agent_id, timestamp: now, session_id: sessionId });
    while (accessLog.length > 100) {
      accessLog.shift();
    }

    // co_retrieved_with: update pairs
    const coRetrieved = (p.co_retrieved_with as Array<{ thought_id: string; count: number }>) ?? [];
    for (const otherId of resultIds) {
      if (otherId === pointId) continue;
      const existing = coRetrieved.find((e) => e.thought_id === otherId);
      if (existing) {
        existing.count += 1;
      } else {
        if (coRetrieved.length >= 50) {
          // Remove lowest count entry
          let minIdx = 0;
          for (let i = 1; i < coRetrieved.length; i++) {
            if (coRetrieved[i].count < coRetrieved[minIdx].count) minIdx = i;
          }
          coRetrieved.splice(minIdx, 1);
        }
        coRetrieved.push({ thought_id: otherId, count: 1 });
      }
    }

    // Upsert updated payload fields
    try {
      await client.setPayload(COLLECTION, {
        points: [pointId],
        payload: {
          access_count: accessCount,
          pheromone_weight: newWeight,
          last_accessed: now,
          accessed_by: accessedBy,
          access_log: accessLog,
          co_retrieved_with: coRetrieved,
        },
        wait: true,
      });
    } catch (err) {
      console.error(`Failed to update access tracking for ${pointId}:`, err);
    }
  }

  const mapped: RetrieveResult[] = results.map((r) => {
    const p = r.payload as Record<string, unknown>;
    const oldWeight = (p.pheromone_weight as number) ?? 1.0;
    return {
      thought_id: String(r.id),
      content: (p.content as string) ?? "",
      contributor_name: (p.contributor_name as string) ?? "",
      score: r.score,
      pheromone_weight: Math.min(10.0, oldWeight + 0.05),
      tags: (p.tags as string[]) ?? [],
      thought_category: (p.thought_category as ThoughtCategory) ?? "uncategorized",
      topic: (p.topic as string) ?? undefined,
      temporal_scope: (p.temporal_scope as string) ?? undefined,
      quality_flags: (p.quality_flags as string[]) ?? [],
    };
  });

  // Lineage awareness: mark superseded thoughts and adjust scores
  const mappedIds = mapped.map((m) => m.thought_id);
  const refinements = await getRefiningThoughts(mappedIds);
  const supersededIds = new Set<string>();

  for (const m of mapped) {
    const ref = refinements.get(m.thought_id);
    if (ref) {
      m.refined_by = ref.refined_by;
      m.superseded = true;
      supersededIds.add(m.thought_id);
    } else {
      m.superseded = false;
    }
  }

  // Score adjustments
  for (const m of mapped) {
    if (m.superseded) {
      m.score *= SCORING_CONFIG.supersededByRefinement;
    }

    const thoughtPayload = results.find((r) => String(r.id) === m.thought_id)?.payload as Record<string, unknown> | undefined;
    if (thoughtPayload) {
      // Hard penalty for correction-superseded thoughts
      if (thoughtPayload.superseded_by_correction === true) {
        m.score *= SCORING_CONFIG.supersededByCorrection;
        m.superseded = true;
      }

      // Penalty for consolidation-superseded thoughts
      if (thoughtPayload.superseded_by_consolidation === true) {
        m.score *= SCORING_CONFIG.supersededByConsolidation;
        m.superseded = true;
        m.superseded_by_consolidation = true;
      }

      // Boost for correction thoughts
      if ((thoughtPayload.thought_category as string) === "correction") {
        m.score = Math.min(1.0, m.score * SCORING_CONFIG.correctionCategory);
      }

      // Penalty for keyword_echo flagged thoughts (contribution-time detection)
      const flags = (thoughtPayload.quality_flags as string[]) ?? [];
      if (flags.includes("keyword_echo")) {
        m.score *= SCORING_CONFIG.keywordEchoFlag;
      }

      // Stronger penalty for gardener-confirmed keyword echoes
      const topic = (thoughtPayload.topic as string) ?? "";
      if (topic === "keyword-echo") {
        m.score *= SCORING_CONFIG.keywordEchoTopic;
      }

      // Check if this thought is a refinement of a superseded thought in the result set
      const sourceIds = (thoughtPayload.source_ids as string[]) ?? [];
      const thoughtType = (thoughtPayload.thought_type as string) ?? "original";
      if ((thoughtType === "refinement" || thoughtType === "consolidation") && sourceIds.some((sid) => supersededIds.has(sid))) {
        m.score = Math.min(1.0, m.score * SCORING_CONFIG.refinementOfSuperseded);
      }
    }
  }

  // Re-sort by adjusted score
  mapped.sort((a, b) => b.score - a.score);

  // Log to query_log
  const logId = uuidv4();
  try {
    insertQueryLog({
      id: logId,
      agent_id: params.agent_id,
      query_text: params.query_text ?? "",
      context_text: null,
      query_vector: Buffer.from(new Float32Array(params.query_embedding).buffer),
      returned_ids: JSON.stringify(mapped.map((r) => r.thought_id)),
      session_id: sessionId,
      timestamp: now,
      result_count: mapped.length,
      knowledge_space_id: "ks-default",
    });
  } catch (err) {
    console.error("Failed to insert query_log:", err);
  }

  return mapped;
}

// --- Pheromone Decay Job — Section 6, 8 ---

export async function runPheromoneDecay(): Promise<number> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  let updated = 0;
  let offset: string | number | undefined = undefined;

  // Scroll through all points where last_accessed < 1 hour ago
  while (true) {
    const scrollResult = await client.scroll(COLLECTION, {
      filter: {
        must: [
          {
            key: "last_accessed",
            range: { lt: oneHourAgo },
          },
        ],
      },
      limit: 100,
      with_payload: true,
      with_vector: false,
      offset,
    });

    for (const point of scrollResult.points) {
      const p = point.payload as Record<string, unknown>;
      const currentWeight = (p.pheromone_weight as number) ?? 1.0;
      const decayedWeight = Math.max(0.1, currentWeight * 0.995);

      if (decayedWeight !== currentWeight) {
        await client.setPayload(COLLECTION, {
          points: [String(point.id)],
          payload: { pheromone_weight: decayedWeight },
          wait: true,
        });
        updated++;
      }
    }

    if (!scrollResult.next_page_offset) break;
    offset = scrollResult.next_page_offset;
  }

  return updated;
}

let decayInterval: ReturnType<typeof setInterval> | null = null;

export function startPheromoneDecayJob(): void {
  if (decayInterval) return;
  decayInterval = setInterval(async () => {
    try {
      const count = await runPheromoneDecay();
      if (count > 0) {
        console.log(`Pheromone decay: updated ${count} thoughts`);
      }
    } catch (err) {
      console.error("Pheromone decay job failed:", err);
    }
  }, 60 * 60 * 1000); // Every 60 minutes
  console.log("Pheromone decay job started (interval: 60 min)");
}

export function stopPheromoneDecayJob(): void {
  if (decayInterval) {
    clearInterval(decayInterval);
    decayInterval = null;
  }
}

// --- Implicit Feedback — Section 3.10 ---

export async function applyImplicitFeedback(thoughtIds: string[]): Promise<void> {
  for (const id of thoughtIds) {
    try {
      const points = await client.retrieve(COLLECTION, {
        ids: [id],
        with_payload: true,
        with_vector: false,
      });
      if (points.length === 0) continue;
      const p = points[0].payload as Record<string, unknown>;
      const currentWeight = (p.pheromone_weight as number) ?? 1.0;
      const newWeight = Math.min(10.0, currentWeight + 0.02);
      await client.setPayload(COLLECTION, {
        points: [id],
        payload: { pheromone_weight: newWeight },
        wait: true,
      });
    } catch (err) {
      console.error(`Failed to apply implicit feedback to ${id}:`, err);
    }
  }
}

// --- highways() — Section 4.3 ---

export interface HighwayParams {
  min_access?: number;
  min_users?: number;
  limit?: number;
  query_embedding?: number[];
}

export interface HighwayResult {
  thought_id: string;
  content_preview: string;
  access_count: number;
  unique_users: number;
  traffic_score: number;
  pheromone_weight: number;
  tags: string[];
}

export async function highways(params: HighwayParams = {}): Promise<HighwayResult[]> {
  const minAccess = params.min_access ?? 3;
  const minUsers = params.min_users ?? 2;
  const limit = params.limit ?? 20;

  // Internal type with full content for dedup comparison
  type CandidateWithContent = HighwayResult & { _fullContent: string };

  // When query_embedding is provided, use vector search with access_count filter (hybrid)
  if (params.query_embedding) {
    let searchResults;
    try {
      searchResults = await client.search(COLLECTION, {
        vector: params.query_embedding,
        limit: limit * 3,
        with_payload: true,
        filter: {
          must: [
            { key: "access_count", range: { gte: minAccess } },
          ],
        },
      });
    } catch (err) {
      throw new ThoughtError("QDRANT_ERROR", `Qdrant search failed: ${err}`);
    }

    const candidates: CandidateWithContent[] = [];
    for (const point of searchResults) {
      const p = point.payload as Record<string, unknown>;
      const accessedBy = (p.accessed_by as string[]) ?? [];
      if (accessedBy.length < minUsers) continue;

      const fullContent = (p.content as string) ?? "";
      const accessCount = (p.access_count as number) ?? 0;
      candidates.push({
        thought_id: String(point.id),
        content_preview: fullContent.substring(0, 80),
        access_count: accessCount,
        unique_users: accessedBy.length,
        traffic_score: accessCount * accessedBy.length,
        pheromone_weight: (p.pheromone_weight as number) ?? 1.0,
        tags: (p.tags as string[]) ?? [],
        _fullContent: fullContent,
      });
    }

    return deduplicateHighways(candidates, limit);
  }

  // Without query_embedding: existing scroll behavior (global frequency)
  const candidates: CandidateWithContent[] = [];
  let offset: string | number | undefined = undefined;

  while (true) {
    let scrollResult;
    try {
      scrollResult = await client.scroll(COLLECTION, {
        filter: {
          must: [
            { key: "access_count", range: { gte: minAccess } },
          ],
        },
        limit: 100,
        with_payload: true,
        with_vector: false,
        offset,
      });
    } catch (err) {
      throw new ThoughtError("QDRANT_ERROR", `Qdrant scroll failed: ${err}`);
    }

    for (const point of scrollResult.points) {
      const p = point.payload as Record<string, unknown>;
      const accessedBy = (p.accessed_by as string[]) ?? [];
      if (accessedBy.length < minUsers) continue;

      const fullContent = (p.content as string) ?? "";
      const accessCount = (p.access_count as number) ?? 0;
      candidates.push({
        thought_id: String(point.id),
        content_preview: fullContent.substring(0, 80),
        access_count: accessCount,
        unique_users: accessedBy.length,
        traffic_score: accessCount * accessedBy.length,
        pheromone_weight: (p.pheromone_weight as number) ?? 1.0,
        tags: (p.tags as string[]) ?? [],
        _fullContent: fullContent,
      });
    }

    if (!scrollResult.next_page_offset) break;
    offset = scrollResult.next_page_offset;
  }

  candidates.sort((a, b) => b.traffic_score - a.traffic_score);
  return deduplicateHighways(candidates, limit);
}

/**
 * Deduplicate highway candidates by text similarity.
 * When two candidates have >0.95 similarity, keeps the one with highest traffic_score.
 * Uses normalized text comparison on full content for accuracy.
 */
function deduplicateHighways(
  candidates: (HighwayResult & { _fullContent: string })[],
  limit: number,
): HighwayResult[] {
  // Sort by traffic_score descending so we keep the best of each cluster
  const sorted = [...candidates].sort((a, b) => b.traffic_score - a.traffic_score);
  const accepted: (HighwayResult & { _fullContent: string })[] = [];

  for (const candidate of sorted) {
    const isDuplicate = accepted.some(
      (a) => textSimilarity(a._fullContent, candidate._fullContent) > 0.95,
    );
    if (!isDuplicate) {
      accepted.push(candidate);
    }
    if (accepted.length >= limit) break;
  }

  // Strip internal _fullContent field before returning
  return accepted.map(({ _fullContent, ...rest }) => rest);
}

/**
 * Compute text similarity between two strings (0..1).
 * Uses normalized bigram overlap (Dice coefficient) for efficiency.
 */
function textSimilarity(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return 1.0;
  if (na.length === 0 || nb.length === 0) return 0.0;

  // Bigram sets for Dice coefficient
  const bigrams = (s: string): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) {
      set.add(s.substring(i, i + 2));
    }
    return set;
  };

  const ba = bigrams(na);
  const bb = bigrams(nb);
  let intersection = 0;
  for (const bg of ba) {
    if (bb.has(bg)) intersection++;
  }

  return (2 * intersection) / (ba.size + bb.size);
}

// --- Tag extraction helper — Section 3.8 ---

export async function getExistingTags(): Promise<string[]> {
  const tagSet = new Set<string>();
  let offset: string | number | undefined = undefined;

  while (true) {
    const scrollResult = await client.scroll(COLLECTION, {
      limit: 100,
      with_payload: ["tags"],
      with_vector: false,
      offset,
    });

    for (const point of scrollResult.points) {
      const p = point.payload as Record<string, unknown>;
      const tags = (p.tags as string[]) ?? [];
      for (const tag of tags) {
        tagSet.add(tag);
      }
    }

    if (!scrollResult.next_page_offset) break;
    offset = scrollResult.next_page_offset;
  }

  return Array.from(tagSet);
}

// --- Thought Lookup Helpers ---

export async function getThoughtById(thoughtId: string): Promise<Record<string, unknown> | null> {
  try {
    const points = await client.retrieve(COLLECTION, {
      ids: [thoughtId],
      with_payload: true,
      with_vector: false,
    });
    if (points.length === 0) return null;
    return points[0].payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function getThoughtsByIds(thoughtIds: string[]): Promise<Record<string, unknown>[]> {
  if (thoughtIds.length === 0) return [];
  try {
    const points = await client.retrieve(COLLECTION, {
      ids: thoughtIds,
      with_payload: true,
      with_vector: false,
    });
    return points.map((p) => p.payload as Record<string, unknown>);
  } catch {
    return [];
  }
}

// --- Metadata update (for retroactive categorization) ---

const VALID_CATEGORIES: ThoughtCategory[] = [
  "state_snapshot", "decision_record", "operational_learning", "task_outcome",
  "correction", "uncategorized", "transition_marker", "design_decision", "domain_summary", "noise",
];

export async function updateThoughtMetadata(
  thoughtId: string,
  fields: { thought_category?: string; topic?: string; superseded_by_correction?: boolean },
): Promise<boolean> {
  const existing = await getThoughtById(thoughtId);
  if (!existing) return false;

  if (fields.thought_category && !VALID_CATEGORIES.includes(fields.thought_category as ThoughtCategory)) {
    throw new ThoughtError("VALIDATION_ERROR", `Invalid thought_category: ${fields.thought_category}`);
  }

  const payload: Record<string, unknown> = {};
  if (fields.thought_category) payload.thought_category = fields.thought_category;
  if (fields.topic !== undefined) payload.topic = fields.topic;
  if (fields.superseded_by_correction !== undefined) payload.superseded_by_correction = fields.superseded_by_correction;

  await client.setPayload(COLLECTION, {
    points: [thoughtId],
    payload,
    wait: true,
  });

  return true;
}

export async function listUncategorizedThoughts(
  limit: number = 20,
  offset?: string | number,
): Promise<{ thoughts: Array<{ thought_id: string; content_preview: string; thought_category: string; topic: string | null }>; next_offset: string | number | null }> {
  const scrollResult = await client.scroll(COLLECTION, {
    filter: {
      must: [
        { key: "thought_category", match: { value: "uncategorized" } },
      ],
    },
    limit,
    with_payload: true,
    with_vector: false,
    ...(offset !== undefined ? { offset } : {}),
  });

  const thoughts = scrollResult.points.map((p) => {
    const pay = p.payload as Record<string, unknown>;
    return {
      thought_id: String(p.id),
      content_preview: ((pay.content as string) ?? "").substring(0, 200),
      thought_category: (pay.thought_category as string) ?? "uncategorized",
      topic: (pay.topic as string) ?? null,
    };
  });

  return {
    thoughts,
    next_offset: scrollResult.next_page_offset ?? null,
  };
}

// --- List domain summaries ---

export async function listDomainSummaries(
  limit: number = 50,
  offset?: string | number,
): Promise<{ thoughts: Array<{ thought_id: string; topic: string; content_preview: string; access_count: number; created_at: string }>; next_offset: string | number | null }> {
  const scrollResult = await client.scroll(COLLECTION, {
    filter: {
      must: [
        { key: "thought_category", match: { value: "domain_summary" } },
      ],
    },
    limit,
    with_payload: true,
    with_vector: false,
    ...(offset !== undefined ? { offset } : {}),
  });

  const thoughts = scrollResult.points.map((p) => {
    const pay = p.payload as Record<string, unknown>;
    return {
      thought_id: String(p.id),
      topic: (pay.topic as string) ?? "unknown",
      content_preview: ((pay.content as string) ?? "").substring(0, 120),
      access_count: (pay.access_count as number) ?? 0,
      created_at: (pay.created_at as string) ?? "",
    };
  });

  return {
    thoughts,
    next_offset: scrollResult.next_page_offset ?? null,
  };
}

// --- getRefiningThoughts() — batch lookup for superseded marking ---

export async function getRefiningThoughts(thoughtIds: string[]): Promise<Map<string, { refined_by: string; created_at: string }>> {
  const result = new Map<string, { refined_by: string; created_at: string }>();
  if (thoughtIds.length === 0) return result;

  try {
    let offset: string | number | undefined = undefined;
    while (true) {
      const scrollResult = await client.scroll(COLLECTION, {
        filter: {
          must: [
            {
              key: "thought_type",
              match: { any: ["refinement", "consolidation"] },
            },
          ],
        },
        limit: 100,
        with_payload: true,
        with_vector: false,
        offset,
      });

      for (const point of scrollResult.points) {
        const p = point.payload as Record<string, unknown>;
        const sourceIds = (p.source_ids as string[]) ?? [];
        const createdAt = (p.created_at as string) ?? "";
        const pointId = String(point.id);

        for (const sourceId of sourceIds) {
          if (thoughtIds.includes(sourceId)) {
            const existing = result.get(sourceId);
            if (!existing || createdAt > existing.created_at) {
              result.set(sourceId, { refined_by: pointId, created_at: createdAt });
            }
          }
        }
      }

      if (!scrollResult.next_page_offset) break;
      offset = scrollResult.next_page_offset as string | number | undefined;
    }
  } catch (err) {
    console.error("getRefiningThoughts failed:", err);
  }

  return result;
}

// --- getLineage() — Section 4.4 ---

export async function getLineage(thoughtId: string, maxDepth: number = 10): Promise<LineageResult> {
  const chain: LineageNode[] = [];
  const visited = new Set<string>();
  let truncated = false;

  // Get the target thought
  const target = await getThoughtById(thoughtId);
  if (!target) {
    return { thought_id: thoughtId, chain: [], truncated: false };
  }

  chain.push({
    thought_id: thoughtId,
    thought_type: (target.thought_type as "original" | "refinement" | "consolidation") ?? "original",
    content_preview: ((target.content as string) ?? "").substring(0, 80),
    contributor: (target.contributor_name as string) ?? "",
    created_at: (target.created_at as string) ?? "",
    source_ids: (target.source_ids as string[]) ?? [],
    depth: 0,
  });
  visited.add(thoughtId);

  // Traverse UP (ancestors via source_ids)
  async function traverseUp(id: string, currentDepth: number): Promise<void> {
    if (currentDepth >= maxDepth) { truncated = true; return; }
    const thought = await getThoughtById(id);
    if (!thought) return;
    const sourceIds = (thought.source_ids as string[]) ?? [];
    for (const sourceId of sourceIds) {
      if (visited.has(sourceId)) continue;
      visited.add(sourceId);
      const source = await getThoughtById(sourceId);
      if (!source) continue;
      chain.push({
        thought_id: sourceId,
        thought_type: (source.thought_type as "original" | "refinement" | "consolidation") ?? "original",
        content_preview: ((source.content as string) ?? "").substring(0, 80),
        contributor: (source.contributor_name as string) ?? "",
        created_at: (source.created_at as string) ?? "",
        source_ids: (source.source_ids as string[]) ?? [],
        depth: -(currentDepth + 1),
      });
      await traverseUp(sourceId, currentDepth + 1);
    }
  }

  // Traverse DOWN (descendants that reference this thought)
  async function traverseDown(id: string, currentDepth: number): Promise<void> {
    if (currentDepth >= maxDepth) { truncated = true; return; }
    try {
      const scrollResult = await client.scroll(COLLECTION, {
        filter: {
          must: [
            {
              key: "thought_type",
              match: { any: ["refinement", "consolidation"] },
            },
          ],
        },
        limit: 100,
        with_payload: true,
        with_vector: false,
      });

      for (const point of scrollResult.points) {
        const p = point.payload as Record<string, unknown>;
        const sourceIds = (p.source_ids as string[]) ?? [];
        const pointId = String(point.id);
        if (sourceIds.includes(id) && !visited.has(pointId)) {
          visited.add(pointId);
          chain.push({
            thought_id: pointId,
            thought_type: (p.thought_type as "original" | "refinement" | "consolidation") ?? "original",
            content_preview: ((p.content as string) ?? "").substring(0, 80),
            contributor: (p.contributor_name as string) ?? "",
            created_at: (p.created_at as string) ?? "",
            source_ids: sourceIds,
            depth: currentDepth + 1,
          });
          await traverseDown(pointId, currentDepth + 1);
        }
      }
    } catch (err) {
      console.error("getLineage traverseDown failed:", err);
    }
  }

  await traverseUp(thoughtId, 0);
  await traverseDown(thoughtId, 0);

  // Sort by depth
  chain.sort((a, b) => a.depth - b.depth);

  return { thought_id: thoughtId, chain, truncated };
}

// --- Error class ---

export class ThoughtError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ThoughtError";
  }
}
