import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { canonicalFrame, frameHash, disclosureHash, DEPLOY_GATE_PROFILE, getLatestProfile } from '@hap-demo/core';
import type { Disclosure, FrameParams, FrameParamsV03, DomainDisclosureV03, DecisionFile } from '@hap-demo/core';

const SP_URL = process.env.NEXT_PUBLIC_SP_URL || 'http://localhost:3001';

// Map UI-friendly names to SP execution path names
const EXECUTION_PATH_MAP: Record<string, string> = {
  'canary': 'deploy-prod-canary',
  'full': 'deploy-prod-full',
};

// v0.3: Compute domain-specific disclosure hash
function computeDomainDisclosureHash(domainDisclosure: DomainDisclosureV03): string {
  const canonical = JSON.stringify(domainDisclosure, Object.keys(domainDisclosure).sort());
  const hash = createHash('sha256').update(canonical).digest('hex');
  return `sha256:${hash}`;
}

// v0.3 request with decision file content
interface UIAttestRequestV03 {
  profile_id: string;
  execution_path: string;
  domain: string; // The domain this attestation is for
  frame: {
    repo: string;
    sha: string;
    env: string;
  };
  decision_file: DecisionFile; // The decision file from the commit
  ttl_seconds: number;
}

// Legacy v0.2 request
interface UIAttestRequestV02 {
  profile_id: string;
  execution_path: string;
  role: 'engineering' | 'release_management'; // The role/scope of this attestation
  frame: {
    repo: string;
    sha: string;
    env: string;
    disclosures: string[]; // Changed file paths
  };
  // Domain-specific content
  domain_disclosure: {
    problem: string;
    objective: string;
    tradeoffs: string;
  };
  decision_owners: Array<{ id: string; scope: string }>;
  gates: {
    problem_understood: boolean;
    objective_clear: boolean;
    tradeoffs_acceptable: boolean;
  };
  ttl_seconds: number;
}

type UIAttestRequest = UIAttestRequestV02 | UIAttestRequestV03;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Detect v0.3 vs v0.2 request format
    const isV03 = 'decision_file' in body && 'domain' in body;

    if (isV03) {
      return handleV03Request(body as UIAttestRequestV03);
    } else {
      return handleV02Request(body as UIAttestRequestV02);
    }
  } catch (error) {
    console.error('Attestation error:', error);
    return NextResponse.json(
      { error: 'Failed to request attestation', details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * Handle v0.3 attestation request
 * - Disclosure comes from decision file in commit
 * - Per-domain disclosure hash in attestation
 * - Frame does NOT include disclosure_hash
 */
async function handleV03Request(body: UIAttestRequestV03) {
  const profile = getLatestProfile();

  // Get execution path from decision file or map from UI value
  const spExecutionPath = body.decision_file.execution_path || EXECUTION_PATH_MAP[body.execution_path] || body.execution_path;
  const domain = body.domain;

  // Get domain disclosure from decision file
  const domainDisclosure = body.decision_file.disclosure[domain];
  if (!domainDisclosure) {
    return NextResponse.json(
      { error: 'Missing domain disclosure', details: `No disclosure found for domain: ${domain}` },
      { status: 400 }
    );
  }

  // Compute domain-specific disclosure hash
  const domainDisclosureHash = computeDomainDisclosureHash(domainDisclosure);

  // Validate env
  const env = body.frame.env as 'prod' | 'staging';
  if (env !== 'prod' && env !== 'staging') {
    return NextResponse.json(
      { error: 'Invalid env', details: 'env must be "prod" or "staging"' },
      { status: 400 }
    );
  }

  // v0.3 frame does NOT include disclosure_hash
  const frameParamsV03: FrameParamsV03 = {
    repo: body.frame.repo.toLowerCase(),
    sha: body.frame.sha.toLowerCase(),
    env,
    profile: body.decision_file.profile || body.profile_id,
    path: spExecutionPath,
  };

  // Compute frame hash using v0.3 profile schema
  const canonical = canonicalFrame(frameParamsV03, profile);
  const fHash = frameHash(canonical);

  // v0.3 SP request with per-domain disclosure hash
  const spRequest = {
    profile_id: body.decision_file.profile || body.profile_id,
    execution_path: spExecutionPath,
    frame_hash: fHash,
    domain,
    did: 'human-reviewer', // TODO: Use actual DID when implemented
    env,
    domain_disclosure_hash: domainDisclosureHash,
  };

  console.log('Sending v0.3 request to SP:', JSON.stringify(spRequest, null, 2));

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

  // Return v0.3 response format
  return NextResponse.json({
    ...data,
    frame_hash: fHash,
    domain_disclosure_hash: domainDisclosureHash,
    domain, // Include the domain so the UI can display it in the attestation block
    expires_at: new Date(data.expires_at * 1000).toISOString(),
  });
}

/**
 * Handle legacy v0.2 attestation request
 */
async function handleV02Request(body: UIAttestRequestV02) {
  // Map execution path to SP format
  const spExecutionPath = EXECUTION_PATH_MAP[body.execution_path] || body.execution_path;

  // Get the role from the request (default to engineering for backwards compatibility)
  const role = body.role || 'engineering';

  // Build disclosure object with domain-specific content
  const disclosure: Disclosure = {
    repo: body.frame.repo.toLowerCase(),
    sha: body.frame.sha.toLowerCase(),
    changed_paths: body.frame.disclosures,
    risk_flags: [], // Could be populated from PR labels or file analysis
    domains: {
      [role]: {
        problem: body.domain_disclosure?.problem || '',
        objective: body.domain_disclosure?.objective || '',
        tradeoffs: body.domain_disclosure?.tradeoffs || '',
      },
    },
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

  // Build frame params (v0.2 includes disclosure_hash)
  const frameParams: FrameParams = {
    repo: body.frame.repo.toLowerCase(),
    sha: body.frame.sha.toLowerCase(),
    env,
    profile: body.profile_id,
    path: spExecutionPath,
    disclosure_hash: discHash,
  };

  // Compute frame hash using the profile schema
  const canonical = canonicalFrame(frameParams, DEPLOY_GATE_PROFILE);
  const fHash = frameHash(canonical);

  // Convert UI gates to SP resolved_gates format
  const resolvedGates: string[] = ['frame'];
  if (body.gates.problem_understood) resolvedGates.push('problem');
  if (body.gates.objective_clear) resolvedGates.push('objective');
  if (body.gates.tradeoffs_acceptable) resolvedGates.push('tradeoff');
  resolvedGates.push('commitment', 'decision_owner');

  // Build SP request
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

  console.log('Sending v0.2 request to SP:', JSON.stringify(spRequest, null, 2));

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

  return NextResponse.json({
    ...data,
    frame_hash: fHash,
    disclosure_hash: discHash,
    role,
    expires_at: new Date(data.expires_at * 1000).toISOString(),
  });
}
