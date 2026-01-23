/**
 * SDG (Signal Detection Guide) Runner
 *
 * Fetches SDG definitions from the server and executes them locally.
 * SDGs help reviewers catch integrity issues before signing.
 *
 * Rules:
 * - Hard stops (stop_trigger: true) must be purely structural
 * - Semantic SDGs (reading free-form text) must be warnings only (stop_trigger: false)
 */

const SP_URL = process.env.NEXT_PUBLIC_SP_URL || 'http://localhost:3001';

// SDG Definition as returned by the server
export interface SDGDefinition {
  id: string;
  signal_intent: string;
  description: string;
  observable_structures: string[];
  detection_rules: string[];
  stop_trigger: boolean;
  user_prompt: string;
}

// Context provided by the UI for SDG evaluation
export interface SDGContext {
  // Structural data
  affected_domains: string[];
  declared_decision_owner_scopes: string[];
  frame_hashes: string[];
  tradeoff_mode: 'canary' | 'full';
  execution_path: string;

  // Semantic data (for warning-only SDGs)
  objective_text: string;
  diff_summary: string;
}

// Result of running an SDG
export interface SDGResult {
  id: string;
  signal_intent: string;
  triggered: boolean;
  stop_trigger: boolean;
  user_prompt?: string;
}

// Cache for fetched SDG definitions
const sdgCache: Map<string, SDGDefinition> = new Map();

/**
 * Fetch an SDG definition from the server
 */
export async function fetchSDG(id: string): Promise<SDGDefinition> {
  // Check cache first
  const cached = sdgCache.get(id);
  if (cached) return cached;

  const res = await fetch(`${SP_URL}/api/sdgs/${id}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch SDG: ${id}`);
  }

  const sdg: SDGDefinition = await res.json();
  sdgCache.set(id, sdg);
  return sdg;
}

/**
 * Evaluate a single detection rule against the context
 */
function evaluateRule(rule: string, ctx: SDGContext): boolean {
  // Rule: affected_domains ⊄ declared_decision_owner_scopes
  // True if any affected domain is NOT in declared scopes
  if (rule === 'affected_domains ⊄ declared_decision_owner_scopes') {
    return ctx.affected_domains.some(
      domain => !ctx.declared_decision_owner_scopes.includes(domain)
    );
  }

  // Rule: count(unique(frame_hashes)) > 1
  // True if there are multiple different frame hashes
  if (rule === 'count(unique(frame_hashes)) > 1') {
    const uniqueHashes = new Set(ctx.frame_hashes);
    return uniqueHashes.size > 1;
  }

  // Rule: tradeoff_mode=canary AND execution_path!=deploy-prod-canary
  if (rule === 'tradeoff_mode=canary AND execution_path!=deploy-prod-canary') {
    return ctx.tradeoff_mode === 'canary' && ctx.execution_path !== 'deploy-prod-canary';
  }

  // Rule: tradeoff_mode=full AND execution_path!=deploy-prod-full
  if (rule === 'tradeoff_mode=full AND execution_path!=deploy-prod-full') {
    return ctx.tradeoff_mode === 'full' && ctx.execution_path !== 'deploy-prod-full';
  }

  // Rule: semantic_distance(objective_text, diff_summary) > threshold
  // This is a semantic check - simplified heuristic for demo
  if (rule === 'semantic_distance(objective_text, diff_summary) > threshold') {
    return evaluateSemanticDistance(ctx.objective_text, ctx.diff_summary);
  }

  // Unknown rule - don't trigger
  console.warn(`Unknown SDG rule: ${rule}`);
  return false;
}

/**
 * Simple heuristic for semantic distance (demo purposes)
 * In production, this could use local AI or embeddings
 */
function evaluateSemanticDistance(objective: string, diff: string): boolean {
  if (!objective || !diff) return false;

  const objectiveLower = objective.toLowerCase();
  const diffLower = diff.toLowerCase();

  // Extract key terms from objective
  const objectiveTerms = objectiveLower
    .split(/\W+/)
    .filter(w => w.length > 3);

  // Check if any objective terms appear in the diff
  const matchingTerms = objectiveTerms.filter(term =>
    diffLower.includes(term)
  );

  // If less than 20% of objective terms appear in diff, flag mismatch
  const matchRatio = objectiveTerms.length > 0
    ? matchingTerms.length / objectiveTerms.length
    : 1;

  return matchRatio < 0.2;
}

/**
 * Run a single SDG against the context
 */
export async function runSDG(id: string, ctx: SDGContext): Promise<SDGResult> {
  const sdg = await fetchSDG(id);

  // Evaluate all rules - trigger if ANY rule matches
  const triggered = sdg.detection_rules.some(rule => evaluateRule(rule, ctx));

  return {
    id: sdg.id,
    signal_intent: sdg.signal_intent,
    triggered,
    stop_trigger: sdg.stop_trigger,
    user_prompt: triggered ? sdg.user_prompt : undefined,
  };
}

/**
 * Run all SDGs from a set against the context
 */
export async function runSDGs(sdgIds: string[], ctx: SDGContext): Promise<SDGResult[]> {
  const results = await Promise.all(
    sdgIds.map(id => runSDG(id, ctx))
  );
  return results;
}

/**
 * Check if any hard-stop SDGs are triggered
 */
export function hasHardStop(results: SDGResult[]): boolean {
  return results.some(r => r.triggered && r.stop_trigger);
}

/**
 * Get all triggered warnings (non-blocking)
 */
export function getWarnings(results: SDGResult[]): SDGResult[] {
  return results.filter(r => r.triggered && !r.stop_trigger);
}

/**
 * Get all triggered hard stops
 */
export function getHardStops(results: SDGResult[]): SDGResult[] {
  return results.filter(r => r.triggered && r.stop_trigger);
}
