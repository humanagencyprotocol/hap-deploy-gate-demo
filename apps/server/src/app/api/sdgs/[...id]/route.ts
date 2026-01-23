import { NextRequest, NextResponse } from 'next/server';

/**
 * SDG (Signal Detection Guide) definitions
 * These are served statically and executed locally in the UI
 */
const SDG_DEFINITIONS: Record<string, SDGDefinition> = {
  'deploy/missing_decision_owner@1.0': {
    id: 'deploy/missing_decision_owner@1.0',
    signal_intent: 'missing_decision_owner',
    description: 'Detects when changes affect domains without a declared decision owner',
    observable_structures: ['affected_domains', 'declared_decision_owner_scopes'],
    detection_rules: ['affected_domains ⊄ declared_decision_owner_scopes'],
    stop_trigger: true,
    user_prompt: 'Changes affect domains without a declared decision owner. Add the required scope before proceeding.',
  },
  'deploy/commitment_mismatch@1.0': {
    id: 'deploy/commitment_mismatch@1.0',
    signal_intent: 'commitment_mismatch',
    description: 'Detects when reviewers are not committing to the same frame',
    observable_structures: ['frame_hashes'],
    detection_rules: ['count(unique(frame_hashes)) > 1'],
    stop_trigger: true,
    user_prompt: 'Reviewers have different frame hashes. All reviewers must commit to the same action.',
  },
  'deploy/tradeoff_execution_mismatch@1.0': {
    id: 'deploy/tradeoff_execution_mismatch@1.0',
    signal_intent: 'tradeoff_execution_mismatch',
    description: 'Detects when UI selection does not match the execution path in the frame',
    observable_structures: ['tradeoff_mode', 'execution_path'],
    detection_rules: [
      'tradeoff_mode=canary AND execution_path!=deploy-prod-canary',
      'tradeoff_mode=full AND execution_path!=deploy-prod-full',
    ],
    stop_trigger: true,
    user_prompt: 'Your selected tradeoff mode does not match the execution path. This indicates a UI/Frame mismatch.',
  },
  'deploy/objective_diff_mismatch@1.0': {
    id: 'deploy/objective_diff_mismatch@1.0',
    signal_intent: 'objective_diff_mismatch',
    description: 'Warns when stated objective appears misaligned with the changes',
    observable_structures: ['objective_text', 'diff_summary'],
    detection_rules: ['semantic_distance(objective_text, diff_summary) > threshold'],
    stop_trigger: false, // Warning only - semantic SDGs cannot block
    user_prompt: 'Your stated objective appears misaligned with the changes in this commit. Review carefully before proceeding.',
  },
};

interface SDGDefinition {
  id: string;
  signal_intent: string;
  description: string;
  observable_structures: string[];
  detection_rules: string[];
  stop_trigger: boolean;
  user_prompt: string;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string[] } }
) {
  // Reconstruct ID from path segments (e.g., ['deploy', 'missing_decision_owner@1.0'])
  const id = params.id.join('/');

  const sdg = SDG_DEFINITIONS[id];

  if (!sdg) {
    return NextResponse.json(
      { error: 'SDG_NOT_FOUND', id },
      { status: 404 }
    );
  }

  return NextResponse.json(sdg);
}

// List all available SDGs
export async function OPTIONS() {
  return NextResponse.json({
    sdgs: Object.keys(SDG_DEFINITIONS),
  });
}
