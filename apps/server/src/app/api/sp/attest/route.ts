import { NextRequest, NextResponse } from 'next/server';
import { signPayload, PROFILE_CONFIG, type ExecutionPath } from '@/lib/sp';
import type {
  AttestationRequestV02,
  AttestationRequestV03,
  DecisionOwnerScope,
  AttestationPayloadV02,
  AttestationPayloadV03,
  Attestation
} from '@hap-demo/core';
import { encodeAttestationBlob } from '@hap-demo/core';

/**
 * Type guard for v0.2 request format
 */
function isRequestV02(body: unknown): body is AttestationRequestV02 {
  return (
    typeof body === 'object' &&
    body !== null &&
    'resolved_gates' in body &&
    'decision_owners' in body &&
    'decision_owner_scopes' in body
  );
}

/**
 * Type guard for v0.3 request format
 */
function isRequestV03(body: unknown): body is AttestationRequestV03 {
  return (
    typeof body === 'object' &&
    body !== null &&
    'domain' in body &&
    'did' in body &&
    'domain_disclosure_hash' in body
  );
}

/**
 * Validate that provided scopes are valid for the execution path.
 * For multi-person approval, we allow partial coverage - each attestation
 * covers one or more scopes, and the workflow aggregates them.
 */
function validateScopes(
  scopes: DecisionOwnerScope[],
  allowedScopes: readonly { domain: string; env: string }[]
): { valid: boolean; invalid?: DecisionOwnerScope } {
  // Check that each provided scope is one of the allowed scopes for this path
  for (const scope of scopes) {
    const isAllowed = allowedScopes.some(
      (allowed) =>
        allowed.domain === scope.domain &&
        allowed.env === scope.env
    );
    // Also allow security to substitute for release_management
    const isAlternative = scope.domain === 'security' &&
      allowedScopes.some(a => a.domain === 'release_management' && a.env === scope.env);

    if (!isAllowed && !isAlternative) {
      return { valid: false, invalid: scope };
    }
  }
  // Must provide at least one scope
  if (scopes.length === 0) {
    return { valid: false };
  }
  return { valid: true };
}

/**
 * Validate v0.3 domain against execution path requirements
 */
function validateDomain(
  domain: string,
  env: string,
  executionPath: string
): { valid: boolean; error?: string } {
  const pathConfig = PROFILE_CONFIG.executionPaths[executionPath as ExecutionPath];
  if (!pathConfig) {
    return { valid: false, error: 'Unknown execution path' };
  }

  // Check if the domain is in the required scopes for this path
  const isValid = pathConfig.requiredScopes.some(
    (scope) => scope.domain === domain && scope.env === env
  );

  if (!isValid) {
    return {
      valid: false,
      error: `Domain '${domain}' with env '${env}' is not valid for path '${executionPath}'`,
    };
  }

  return { valid: true };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Detect version based on request shape
    if (isRequestV03(body)) {
      return handleV03Request(body);
    } else if (isRequestV02(body)) {
      return handleV02Request(body);
    } else {
      return NextResponse.json(
        {
          error: 'INVALID_REQUEST',
          reason: 'UNKNOWN_FORMAT',
          details: 'Request does not match v0.2 or v0.3 format',
        },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Attestation error:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', reason: 'Failed to process attestation request' },
      { status: 500 }
    );
  }
}

/**
 * Handle v0.3 attestation request
 * Per-domain attestation with disclosure hash
 */
async function handleV03Request(body: AttestationRequestV03) {
  // Validate profile_id
  if (body.profile_id !== PROFILE_CONFIG.id) {
    return NextResponse.json(
      {
        error: 'INVALID_REQUEST',
        reason: 'UNKNOWN_PROFILE',
        details: { profile_id: body.profile_id, expected: PROFILE_CONFIG.id },
      },
      { status: 400 }
    );
  }

  // Validate execution_path
  if (!(body.execution_path in PROFILE_CONFIG.executionPaths)) {
    return NextResponse.json(
      {
        error: 'INVALID_REQUEST',
        reason: 'UNKNOWN_EXECUTION_PATH',
        details: {
          execution_path: body.execution_path,
          allowed: Object.keys(PROFILE_CONFIG.executionPaths),
        },
      },
      { status: 400 }
    );
  }

  // Validate domain for this execution path
  const domainValidation = validateDomain(body.domain, body.env, body.execution_path);
  if (!domainValidation.valid) {
    return NextResponse.json(
      {
        error: 'INVALID_REQUEST',
        reason: 'DOMAIN_INVALID',
        details: {
          domain: body.domain,
          env: body.env,
          execution_path: body.execution_path,
          error: domainValidation.error,
        },
      },
      { status: 400 }
    );
  }

  // Build v0.3 attestation payload
  const now = Math.floor(Date.now() / 1000);
  const payload: AttestationPayloadV03 = {
    attestation_id: crypto.randomUUID(),
    version: '0.3',
    profile_id: body.profile_id,
    frame_hash: body.frame_hash,
    resolved_domains: [{
      domain: body.domain,
      did: body.did,
      env: body.env,
      disclosure_hash: body.domain_disclosure_hash,
    }],
    issued_at: now,
    expires_at: now + PROFILE_CONFIG.ttl.default,
  };

  // Sign the payload
  const signature = await signPayload(payload);

  const attestation: Attestation = {
    header: {
      typ: 'HAP-attestation',
      alg: 'EdDSA',
      kid: 'sp-demo-v1',
    },
    payload,
    signature,
  };

  const blob = encodeAttestationBlob(attestation);

  return NextResponse.json({
    attestation: blob,
    issued_at: payload.issued_at,
    expires_at: payload.expires_at,
  });
}

/**
 * Handle legacy v0.2 attestation request
 */
async function handleV02Request(body: AttestationRequestV02) {
  // Validate profile_id
  if (body.profile_id !== PROFILE_CONFIG.id) {
    return NextResponse.json(
      {
        error: 'INVALID_REQUEST',
        reason: 'UNKNOWN_PROFILE',
        details: { profile_id: body.profile_id, expected: PROFILE_CONFIG.id },
      },
      { status: 400 }
    );
  }

  // Validate execution_path
  if (!(body.execution_path in PROFILE_CONFIG.executionPaths)) {
    return NextResponse.json(
      {
        error: 'INVALID_REQUEST',
        reason: 'UNKNOWN_EXECUTION_PATH',
        details: {
          execution_path: body.execution_path,
          allowed: Object.keys(PROFILE_CONFIG.executionPaths),
        },
      },
      { status: 400 }
    );
  }

  // Validate required gates
  const missingGates = PROFILE_CONFIG.requiredGates.filter(
    (g) => !body.resolved_gates.includes(g)
  );
  if (missingGates.length > 0) {
    return NextResponse.json(
      {
        error: 'INVALID_REQUEST',
        reason: 'MISSING_GATES',
        details: { missing: missingGates },
      },
      { status: 400 }
    );
  }

  // Validate Decision Owner scopes
  const pathConfig = PROFILE_CONFIG.executionPaths[body.execution_path as ExecutionPath];
  const scopeValidation = validateScopes(body.decision_owner_scopes, pathConfig.requiredScopes);
  if (!scopeValidation.valid) {
    return NextResponse.json(
      {
        error: 'INVALID_REQUEST',
        reason: 'SCOPE_INVALID',
        details: {
          execution_path: body.execution_path,
          invalid_scope: scopeValidation.invalid,
          allowed_scopes: pathConfig.requiredScopes,
        },
      },
      { status: 400 }
    );
  }

  // Build v0.2 attestation payload
  const now = Math.floor(Date.now() / 1000);
  const payload: AttestationPayloadV02 = {
    attestation_id: crypto.randomUUID(),
    version: '0.2',
    profile_id: body.profile_id,
    frame_hash: body.frame_hash,
    resolved_gates: body.resolved_gates,
    decision_owners: body.decision_owners,
    decision_owner_scopes: body.decision_owner_scopes,
    issued_at: now,
    expires_at: now + PROFILE_CONFIG.ttl.default,
  };

  // Sign the payload
  const signature = await signPayload(payload);

  const attestation: Attestation = {
    header: {
      typ: 'HAP-attestation',
      alg: 'EdDSA',
      kid: 'sp-demo-v1',
    },
    payload,
    signature,
  };

  const blob = encodeAttestationBlob(attestation);

  return NextResponse.json({
    attestation: blob,
    issued_at: payload.issued_at,
    expires_at: payload.expires_at,
  });
}
