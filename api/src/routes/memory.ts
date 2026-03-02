import type { FastifyInstance } from "fastify";
import crypto from "crypto";
import { embed } from "../services/embedding.js";
import { think, retrieve, applyImplicitFeedback, highways, getExistingTags, getThoughtById, getLineage, updateThoughtMetadata, listUncategorizedThoughts, listDomainSummaries, ThoughtError, type ThoughtCategory, type SourceRef } from "../services/thoughtspace.js";
import { getAgentQueryCount, getSessionReturnedIds, getRecentQueriesByAgent } from "../services/database.js";

// --- Contribution Threshold (Section 3.5) ---

function meetsContributionThreshold(prompt: string): boolean {
  // 1. Length > 50
  if (prompt.length <= 50) return false;

  // 2. Not purely interrogative: single sentence ending in ? with no . or ! before it
  if (/^[^.!]*\?$/.test(prompt)) return false;

  // 3. Not a follow-up reference
  const lower = prompt.toLowerCase();
  const followUpPrefixes = ["based on", "you said", "you told me", "regarding your", "about your response"];
  for (const prefix of followUpPrefixes) {
    if (lower.startsWith(prefix)) return false;
  }

  return true;
}

// --- Contribution Quality Detection (Brain Quality: Maps Not Breadcrumbs) ---

interface QualityAssessment {
  passesThreshold: boolean;
  flags: string[];
  category: ThoughtCategory;
}

function assessContributionQuality(
  prompt: string,
  metadata: { thought_category?: ThoughtCategory },
  recentQueries: string[]
): QualityAssessment {
  const passesThreshold = meetsContributionThreshold(prompt);
  const flags: string[] = [];

  // Keyword echo detection: >60% word overlap with recent queries
  if (recentQueries.length > 0) {
    const strip = (w: string) => w.replace(/[^a-z0-9-]/g, "");
    const promptWords = new Set(prompt.toLowerCase().split(/\s+/).map(strip).filter((w) => w.length > 2));
    for (const query of recentQueries) {
      const queryWords = new Set(query.toLowerCase().split(/\s+/).map(strip).filter((w) => w.length > 2));
      const overlap = [...queryWords].filter((w) => promptWords.has(w)).length;
      if (queryWords.size > 0 && overlap / queryWords.size > 0.6) {
        flags.push("keyword_echo");
        break;
      }
    }
  }

  // Orphaned reference: contains "see" + reference without substance
  if (/\bsee (the |my |our )?\w+/i.test(prompt) && prompt.length < 150) {
    flags.push("orphaned_reference");
  }

  return {
    passesThreshold,
    flags,
    category: metadata.thought_category || "uncategorized",
  };
}

// --- Tag Extraction (Section 3.8) ---
// Match prompt against existing tag values (done at /memory level with retrieve results)

function extractTagsFromResults(prompt: string, existingTags: string[]): string[] {
  const lower = prompt.toLowerCase();
  return existingTags.filter((tag) => lower.includes(tag.toLowerCase()));
}

// --- Route ---

interface MemoryRequest {
  prompt: string;
  agent_id: string;
  agent_name: string;
  context?: string;
  session_id?: string;
  refines?: string;
  consolidates?: string[];
  // Brain contribution quality fields (all optional)
  thought_category?: ThoughtCategory;
  topic?: string;
  temporal_scope?: string;
  source_ref?: SourceRef;
  alternatives_considered?: string;
  // Correction-specific fields
  corrected_fact?: string;
  correct_fact?: string;
  supersedes?: string[];
  // Retrieval options
  full_content?: boolean;
  read_only?: boolean;
}

async function handleMemoryRequest(params: MemoryRequest, reply: import("fastify").FastifyReply) {
  const {
    prompt, agent_id, agent_name, context, session_id, refines, consolidates,
    thought_category, topic, temporal_scope, source_ref, alternatives_considered,
    corrected_fact, correct_fact, supersedes, full_content, read_only,
  } = params;

    // Step 1: Validate request (Section 3.3)
    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
      return reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: "prompt is required and must be a non-empty string" },
      });
    }
    if (prompt.length > 10000) {
      return reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: "prompt must be at most 10000 characters" },
      });
    }
    if (!agent_id || typeof agent_id !== "string" || agent_id.trim().length === 0) {
      return reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: "agent_id is required and must be a non-empty string" },
      });
    }
    if (agent_id.length > 100) {
      return reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: "agent_id must be at most 100 characters" },
      });
    }
    if (!agent_name || typeof agent_name !== "string" || agent_name.trim().length === 0) {
      return reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: "agent_name is required and must be a non-empty string" },
      });
    }
    if (agent_name.length > 200) {
      return reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: "agent_name must be at most 200 characters" },
      });
    }
    if (context && context.length > 2000) {
      return reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: "context must be at most 2000 characters" },
      });
    }

    // Validate refines/consolidates mutual exclusion
    if (refines && consolidates && consolidates.length > 0) {
      return reply.status(400).send({
        error: { code: "MUTUAL_EXCLUSION", message: "Cannot provide both refines and consolidates in the same request" },
      });
    }
    if (consolidates && consolidates.length < 2) {
      return reply.status(400).send({
        error: { code: "MIN_CONSOLIDATION", message: "consolidates must contain at least 2 thought IDs" },
      });
    }

    // Validate referenced thoughts exist
    if (refines) {
      const sourceThought = await getThoughtById(refines);
      if (!sourceThought) {
        return reply.status(404).send({
          error: { code: "THOUGHT_NOT_FOUND", message: `Thought ${refines} not found` },
        });
      }
    }
    if (consolidates) {
      for (const id of consolidates) {
        const sourceThought = await getThoughtById(id);
        if (!sourceThought) {
          return reply.status(404).send({
            error: { code: "THOUGHT_NOT_FOUND", message: `Thought ${id} not found` },
          });
        }
      }
    }

    // Step 2: Generate session_id if not provided
    const sessionId = session_id || crypto.randomUUID();

    const operations: string[] = [];
    let thoughtsContributed = 0;
    let contributedThoughtId: string | undefined;

    // Step 3: Check contribution threshold (Section 3.5)
    // Skip contribution entirely when read_only is true (prevents query pollution)
    // Bypass threshold when refines or consolidates is provided (explicit iteration)
    const isExplicitIteration = !!(refines || consolidates);
    const thresholdMet = !read_only && (isExplicitIteration || meetsContributionThreshold(prompt.trim()));

    // Quality assessment
    const recentQueries = getRecentQueriesByAgent(agent_id, 5);
    const qualityAssessment = assessContributionQuality(prompt.trim(), { thought_category }, recentQueries);
    let contributionQualityFlags: string[] = [];

    // keyword_echo is now a quality flag only, not a storage gate.
    // Bug fix 2026-03-01: keyword_echo falsely blocked valid MCP contributions because
    // brain-first hook queries + hardcoded agent_id caused >60% word overlap on same-topic
    // query→contribute workflows. Gardener can use the flag for curation, but storage proceeds.

    if (thresholdMet) {
      try {
        // Tag extraction (Section 3.8): match prompt against existing tags
        const existingTags = await getExistingTags();
        const extractedTags = extractTagsFromResults(prompt.trim(), existingTags);

        // Determine thought_type and source_ids
        let thought_type: "original" | "refinement" | "consolidation" = "original";
        let source_ids: string[] = [];

        if (refines) {
          thought_type = "refinement";
          source_ids = [refines];
        } else if (consolidates) {
          thought_type = "consolidation";
          source_ids = consolidates;
        }

        contributionQualityFlags = qualityAssessment.flags;

        const thinkResult = await think({
          content: prompt.trim(),
          contributor_id: agent_id,
          contributor_name: agent_name,
          thought_type,
          source_ids,
          tags: extractedTags,
          context_metadata: context ?? undefined,
          // Brain contribution quality fields
          thought_category: thought_category ?? "uncategorized",
          topic: topic ?? undefined,
          temporal_scope: temporal_scope ?? undefined,
          source_ref: source_ref ?? undefined,
          alternatives_considered: alternatives_considered ?? undefined,
          quality_flags: qualityAssessment.flags,
          // Correction-specific fields
          corrected_fact: corrected_fact ?? undefined,
          correct_fact: correct_fact ?? undefined,
          supersedes: supersedes ?? undefined,
        });
        contributedThoughtId = thinkResult.thought_id;
        thoughtsContributed = 1;
        operations.push("contribute");
      } catch (err) {
        if (err instanceof ThoughtError) {
          return reply.status(err.code === "VALIDATION_ERROR" ? 400 : 500).send({
            error: { code: err.code, message: err.message },
          });
        }
        return reply.status(500).send({
          error: { code: "INTERNAL_ERROR", message: "Failed to store thought" },
        });
      }
    }

    // Step 4: Embed prompt (with context concatenation if context provided — Section 3.6)
    let queryEmbedding: number[];
    try {
      const textToEmbed = context ? `${context} ${prompt.trim()}` : prompt.trim();
      queryEmbedding = await embed(textToEmbed);
    } catch (err) {
      return reply.status(500).send({
        error: { code: "EMBEDDING_FAILED", message: `Embedding model error: ${err}` },
      });
    }

    // Step 5: Call retrieve()
    let retrieveResults;
    try {
      retrieveResults = await retrieve({
        query_embedding: queryEmbedding,
        agent_id,
        session_id: sessionId,
        limit: 10,
        filter_tags: [],
        query_text: prompt.trim(),
      });
      operations.push("retrieve");
    } catch (err) {
      if (err instanceof ThoughtError) {
        return reply.status(500).send({
          error: { code: err.code, message: err.message },
        });
      }
      return reply.status(500).send({
        error: { code: "INTERNAL_ERROR", message: "Retrieval failed" },
      });
    }

    // Reinforce operations
    if (retrieveResults.length > 0) {
      operations.push("reinforce");
    }

    // Step 6: Disambiguation (Section 3.8)
    let disambiguation: { total_found: number; clusters: Array<{ tag: string; count: number }> } | null = null;
    let responseText: string;

    // Collect all tags from results
    const allTags = new Map<string, number>();
    for (const r of retrieveResults) {
      for (const tag of r.tags) {
        allTags.set(tag, (allTags.get(tag) ?? 0) + 1);
      }
    }

    if (retrieveResults.length >= 10 && allTags.size >= 3) {
      // Disambiguation triggered
      const clusters = Array.from(allTags.entries())
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count);

      disambiguation = {
        total_found: retrieveResults.length,
        clusters,
      };

      const clusterDesc = clusters.map((c) => `${c.tag} (${c.count})`).join(", ");
      responseText = `I found ${retrieveResults.length} thoughts across ${clusters.length} areas: ${clusterDesc}. Which area interests you?`;
      operations.push("disambiguate");

      // Filter sources to largest cluster
      const largestTag = clusters[0].tag;
      retrieveResults = retrieveResults.filter((r) => r.tags.includes(largestTag)).slice(0, 5);
    } else {
      // Normal response: top-3 formatted
      const top3 = retrieveResults.slice(0, 3);
      if (top3.length > 0) {
        responseText = top3
          .map((r, i) => `[${i + 1}] ${r.contributor_name}: ${r.content.substring(0, 80)} (score: ${r.score.toFixed(2)})`)
          .join("\n");
      } else {
        responseText = "No related thoughts found yet. Share what you're learning and I'll remember it.";
      }
    }

    // Initialize guidance early for use in contradiction detection
    let guidance: string | null = null;

    // Step 6b: Contradiction detection — check if new contribution matches a corrected fact
    if (thresholdMet && contributedThoughtId && thought_category !== "correction") {
      try {
        const correctionResults = await retrieve({
          query_embedding: queryEmbedding,
          agent_id,
          session_id: sessionId,
          limit: 5,
        });
        for (const cr of correctionResults) {
          if (cr.thought_category === "correction" && cr.score > 0.85) {
            // Check if the new contribution resembles the corrected (wrong) fact
            const correctionPayload = await getThoughtById(cr.thought_id);
            if (correctionPayload) {
              const correctFact = (correctionPayload.correct_fact as string) ?? "";
              if (correctFact) {
                const warning = `WARNING: This contribution may contradict a correction. Correction ${cr.thought_id}: "${correctFact}". Please verify your source is current.`;
                guidance = guidance ? `${guidance}\n\n${warning}` : warning;
                contributionQualityFlags.push("contradicts_correction");
                // Update the stored thought with the flag
                // Note: already stored, would need setPayload — skip for now, flag is in response
              }
            }
          }
        }
      } catch (err) {
        console.error("Contradiction detection failed:", err);
      }
    }

    // Step 7: New agent onboarding (Section 3.9)
    const agentQueryCount = getAgentQueryCount(agent_id);
    // agentQueryCount is checked BEFORE this query is logged (the retrieve() above already logged one)
    // So first-time agent will have exactly 1 entry (from the retrieve above). Check <= 1.
    if (agentQueryCount <= 1) {
      guidance = "Welcome! I haven't seen you before. I'll track your interests as you interact. Ask me anything or share what you're learning.";
      operations.push("onboard");
    }

    // Step 7b: Refinement suggestion (Q5) — when contributing original, check for similar existing thought
    if (thresholdMet && !isExplicitIteration && retrieveResults.length > 0) {
      const topMatch = retrieveResults[0];
      if (topMatch.score > 0.85) {
        const suggestion = `Similar thought exists (id: ${topMatch.thought_id}, preview: '${topMatch.content.substring(0, 60)}...'). Consider using /brain refine ${topMatch.thought_id} "updated insight" instead.`;
        guidance = guidance ? `${guidance}\n\n${suggestion}` : suggestion;
      }
    }

    // Step 8: Implicit feedback (Section 3.10)
    if (session_id && thresholdMet) {
      // Agent contributed after a previous session query
      const previousIds = getSessionReturnedIds(session_id);
      if (previousIds.length > 0) {
        await applyImplicitFeedback(previousIds);
        operations.push("feedback_implicit");
      }
    }

    // Step 9: Highways (Section 4.3)
    let highwaysNearby: string[] = [];
    try {
      const hw = await highways({ min_access: 3, min_users: 2, limit: 5, query_embedding: queryEmbedding });
      highwaysNearby = hw.map((h) =>
        `${h.content_preview} (${h.access_count} accesses, ${h.unique_users} agents)`
      );
    } catch (err) {
      console.error("Highway query failed:", err);
    }

    // Step 10: Format response
    const sources = retrieveResults.slice(0, 5).map((r) => ({
      thought_id: r.thought_id,
      contributor: r.contributor_name,
      score: parseFloat(r.score.toFixed(2)),
      content_preview: r.content.substring(0, 80),
      ...(full_content ? { content: r.content } : {}),
      refined_by: r.refined_by ?? null,
      superseded: r.superseded ?? false,
      thought_category: r.thought_category ?? "uncategorized",
      topic: r.topic ?? null,
      temporal_scope: r.temporal_scope ?? null,
      quality_flags: r.quality_flags ?? [],
    }));

    // Prepend guidance/disambiguation to response
    if (guidance) {
      responseText = `${guidance}\n\n${responseText}`;
    }

    // Lineage summary for trace
    let lineageSummary: { has_lineage: boolean; chain_length: number; deepest_ancestor: string | null; latest_refinement: string | null } | undefined;
    if (contributedThoughtId && isExplicitIteration) {
      try {
        const lineage = await getLineage(contributedThoughtId);
        if (lineage.chain.length > 1) {
          const ancestors = lineage.chain.filter((n) => n.depth < 0);
          const descendants = lineage.chain.filter((n) => n.depth > 0);
          lineageSummary = {
            has_lineage: true,
            chain_length: lineage.chain.length,
            deepest_ancestor: ancestors.length > 0 ? ancestors[0].thought_id : null,
            latest_refinement: descendants.length > 0 ? descendants[descendants.length - 1].thought_id : null,
          };
        }
      } catch (err) {
        console.error("Lineage summary failed:", err);
      }
    }

    return reply.send({
      result: {
        response: responseText,
        sources,
        highways_nearby: highwaysNearby,
        disambiguation,
        guidance,
      },
      trace: {
        session_id: sessionId,
        operations,
        thoughts_retrieved: retrieveResults.length,
        thoughts_contributed: thoughtsContributed,
        contribution_threshold_met: thresholdMet,
        context_used: !!context,
        retrieval_method: "vector",
        ...(lineageSummary ? { lineage_summary: lineageSummary } : {}),
        ...(contributionQualityFlags.length > 0 ? { quality_flags: contributionQualityFlags } : {}),
      },
    });
}

export async function memoryRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: MemoryRequest }>("/api/v1/memory", async (request, reply) => {
    return handleMemoryRequest(request.body, reply);
  });

  app.get<{ Querystring: MemoryRequest }>("/api/v1/memory", async (request, reply) => {
    return handleMemoryRequest(request.query as MemoryRequest, reply);
  });

  // Full-content drill-down endpoint
  app.get<{ Params: { id: string } }>("/api/v1/memory/thought/:id", async (request, reply) => {
    const { id } = request.params;
    if (!id || typeof id !== "string" || id.trim().length === 0) {
      return reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: "thought id is required" },
      });
    }

    const thought = await getThoughtById(id);
    if (!thought) {
      return reply.status(404).send({
        error: { code: "THOUGHT_NOT_FOUND", message: `Thought ${id} not found` },
      });
    }

    return reply.send({
      thought: {
        thought_id: id,
        content: (thought.content as string) ?? "",
        contributor_id: (thought.contributor_id as string) ?? "",
        contributor_name: (thought.contributor_name as string) ?? "",
        thought_type: (thought.thought_type as string) ?? "original",
        thought_category: (thought.thought_category as string) ?? "uncategorized",
        topic: thought.topic ?? null,
        temporal_scope: thought.temporal_scope ?? null,
        source_ref: thought.source_ref ?? null,
        alternatives_considered: thought.alternatives_considered ?? null,
        quality_flags: (thought.quality_flags as string[]) ?? [],
        corrected_fact: thought.corrected_fact ?? null,
        correct_fact: thought.correct_fact ?? null,
        superseded_by_correction: thought.superseded_by_correction ?? false,
        tags: (thought.tags as string[]) ?? [],
        context_metadata: thought.context_metadata ?? null,
        source_ids: (thought.source_ids as string[]) ?? [],
        created_at: (thought.created_at as string) ?? "",
        last_accessed: thought.last_accessed ?? null,
        access_count: (thought.access_count as number) ?? 0,
        pheromone_weight: (thought.pheromone_weight as number) ?? 1.0,
      },
    });
  });

  // Metadata update endpoint (for retroactive categorization)
  app.patch<{ Params: { id: string }; Body: { thought_category?: string; topic?: string } }>(
    "/api/v1/memory/thought/:id/metadata",
    async (request, reply) => {
      const { id } = request.params;
      const { thought_category, topic } = request.body ?? {};

      if (!thought_category && topic === undefined) {
        return reply.status(400).send({
          error: { code: "VALIDATION_ERROR", message: "At least one field (thought_category, topic) is required" },
        });
      }

      try {
        const updated = await updateThoughtMetadata(id, { thought_category, topic });
        if (!updated) {
          return reply.status(404).send({
            error: { code: "THOUGHT_NOT_FOUND", message: `Thought ${id} not found` },
          });
        }
        return reply.send({ success: true, thought_id: id });
      } catch (err) {
        if (err instanceof ThoughtError && err.code === "VALIDATION_ERROR") {
          return reply.status(400).send({
            error: { code: err.code, message: err.message },
          });
        }
        return reply.status(500).send({
          error: { code: "INTERNAL_ERROR", message: "Failed to update metadata" },
        });
      }
    },
  );

  // List uncategorized thoughts (for gardener batch categorization)
  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    "/api/v1/memory/thoughts/uncategorized",
    async (request, reply) => {
      const limit = Math.min(parseInt(request.query.limit ?? "20", 10) || 20, 100);
      const rawOffset = request.query.offset;
      const offset = rawOffset ? (isNaN(Number(rawOffset)) ? rawOffset : Number(rawOffset)) : undefined;

      try {
        const result = await listUncategorizedThoughts(limit, offset);
        return reply.send(result);
      } catch (err) {
        return reply.status(500).send({
          error: { code: "INTERNAL_ERROR", message: "Failed to list uncategorized thoughts" },
        });
      }
    },
  );

  // List domain summaries (for agent discovery)
  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    "/api/v1/memory/domains",
    async (request, reply) => {
      const limit = Math.min(parseInt(request.query.limit ?? "50", 10) || 50, 100);
      const rawOffset = request.query.offset;
      const offset = rawOffset ? (isNaN(Number(rawOffset)) ? rawOffset : Number(rawOffset)) : undefined;

      try {
        const result = await listDomainSummaries(limit, offset);
        return reply.send(result);
      } catch (err) {
        return reply.status(500).send({
          error: { code: "INTERNAL_ERROR", message: "Failed to list domain summaries" },
        });
      }
    },
  );
}
