export const SCORING_CONFIG = {
  // Penalties
  supersededByRefinement: 0.7,     // Thought has newer refinement
  supersededByCorrection: 0.5,     // Correction marked this wrong
  supersededByConsolidation: 0.7,  // Consolidated into a summary thought
  keywordEchoFlag: 0.8,           // Contribution-time echo detection
  keywordEchoTopic: 0.3,          // Gardener-confirmed echo (stronger)

  // Boosts (pre-cap — all boosts capped at 1.0)
  correctionCategory: 1.3,        // Correction thoughts
  refinementOfSuperseded: 1.2,    // Refinement replacing bad thought
};
