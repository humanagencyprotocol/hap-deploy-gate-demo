import { NextRequest, NextResponse } from 'next/server';
import { signPayload, PROFILE_CONFIG, type ExecutionPath } from '@/lib/sp';
import type { AttestationRequest, DecisionOwnerScope, AttestationPayload, Attestation } from '@hap-demo/core';
import { encodeAttestationBlob } from '@hap-demo/core';

interface AttestRequestBody extends AttestationRequest {}

function validateScopes(
  scopes: DecisionOwnerScope[],
  requiredScopes: readonly { domain: string; env: string }[]
): { valid: boolean; missing?: { domain: string; env: string } } {
  for (const required of requiredScopes) {
    const found = scopes.some(
      (s) =>
        s.domain === required.domain &&
        s.env === required.env
    );
    if (!found) {
      // Check for alternative domains (security can substitute for release_management)
      if (required.domain === 'release_management') {
        const hasAlternative = scopes.some(
          (s) => s.domain === 'security' && s.env === required.env
        );
        if (hasAlternative) continue;
      }
      return { valid: false, missing: required };
    }
  }
  return { valid: true };
}

export async function POST(request: NextRequest) {
  try {
    const body: AttestRequestBody = await request.json();

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
          reason: 'SCOPE_INSUFFICIENT',
          details: {
            execution_path: body.execution_path,
            missing_scope: scopeValidation.missing,
          },
        },
        { status: 400 }
      );
    }

    // Build attestation payload
    const now = Math.floor(Date.now() / 1000);
    const payload: AttestationPayload = {
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
  } catch (error) {
    console.error('Attestation error:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', reason: 'Failed to process attestation request' },
      { status: 500 }
    );
  }
}
