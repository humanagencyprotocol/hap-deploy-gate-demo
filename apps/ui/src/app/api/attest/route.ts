import { NextRequest, NextResponse } from 'next/server';
import { canonicalFrame, frameHash, disclosureHash } from '@hap-demo/core';
import type { Disclosure, FrameParams } from '@hap-demo/core';

const SP_URL = process.env.NEXT_PUBLIC_SP_URL || 'http://localhost:3001';

// Map UI-friendly names to SP execution path names
const EXECUTION_PATH_MAP: Record<string, string> = {
  'canary': 'deploy-prod-canary',
  'full': 'deploy-prod-full',
};

interface UIAttestRequest {
  profile_id: string;
  execution_path: string;
  role: 'engineering' | 'release_management'; // The role/scope of this attestation
  frame: {
    repo: string;
    sha: string;
    env: string;
    disclosures: string[];
  };
  decision_owners: Array<{ id: string; scope: string }>;
  gates: {
    problem_understood: boolean;
    objective_clear: boolean;
    tradeoffs_acceptable: boolean;
  };
  ttl_seconds: number;
}

export async function POST(request: NextRequest) {
  try {
    const body: UIAttestRequest = await request.json();

    // Map execution path to SP format
    const spExecutionPath = EXECUTION_PATH_MAP[body.execution_path] || body.execution_path;

    // Build disclosure object
    const disclosure: Disclosure = {
      repo: body.frame.repo.toLowerCase(),
      sha: body.frame.sha.toLowerCase(),
      changed_paths: body.frame.disclosures,
      risk_flags: [], // Could be populated from PR labels or file analysis
    };

    // Compute disclosure hash
    const discHash = disclosureHash(disclosure);

    // Validate and cast env
    const env = body.frame.env as 'prod' | 'staging';
    if (env !== 'prod' && env !== 'staging') {
      return NextResponse.json(
        { error: 'Invalid env', details: 'env must be "prod" or "staging"' },
        { status: 400 }
      );
    }

    // Build frame params
    const frameParams: FrameParams = {
      repo: body.frame.repo.toLowerCase(),
      sha: body.frame.sha.toLowerCase(),
      env,
      profile: body.profile_id,
      path: spExecutionPath,
      disclosure_hash: discHash,
    };

    // Compute frame hash
    const canonical = canonicalFrame(frameParams);
    const fHash = frameHash(canonical);

    // Convert UI gates to SP resolved_gates format
    // SP expects: ['frame', 'problem', 'objective', 'tradeoff', 'commitment', 'decision_owners']
    const resolvedGates: string[] = ['frame']; // frame is always resolved if we got here
    if (body.gates.problem_understood) resolvedGates.push('problem');
    if (body.gates.objective_clear) resolvedGates.push('objective');
    if (body.gates.tradeoffs_acceptable) resolvedGates.push('tradeoff');
    // Add commitment and decision_owners as they're implicit in the UI flow
    resolvedGates.push('commitment', 'decision_owners');

    // Get the role from the request (default to engineering for backwards compatibility)
    const role = body.role || 'engineering';

    // Build SP request - each attestation covers a single role/domain
    const spRequest = {
      profile_id: body.profile_id,
      execution_path: spExecutionPath,
      frame_hash: fHash,
      resolved_gates: resolvedGates,
      decision_owners: body.decision_owners.map(d => d.id),
      decision_owner_scopes: [
        { did: body.decision_owners[0]?.id || 'human-reviewer', domain: role, env: body.frame.env },
      ],
    };

    console.log('Sending to SP:', JSON.stringify(spRequest, null, 2));

    const response = await fetch(`${SP_URL}/api/sp/attest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(spRequest),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('SP error:', data);
      return NextResponse.json(data, { status: response.status });
    }

    // Return with frame_hash, disclosure_hash, and role for the UI
    return NextResponse.json({
      ...data,
      frame_hash: fHash,
      disclosure_hash: discHash,
      role, // Include the role so the UI can display it in the attestation block
      expires_at: new Date(data.expires_at * 1000).toISOString(),
    });
  } catch (error) {
    console.error('Attestation error:', error);
    return NextResponse.json(
      { error: 'Failed to request attestation', details: String(error) },
      { status: 500 }
    );
  }
}
