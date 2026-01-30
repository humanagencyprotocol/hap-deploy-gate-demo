import { NextRequest, NextResponse } from 'next/server';
import { verifyAttestation } from '@hap-demo/core';
import type { AttestationPayload, AttestationPayloadV02, AttestationPayloadV03 } from '@hap-demo/core';
import { getPublicKeyHex, PROFILE_CONFIG } from '@/lib/sp';

/**
 * Type guard for v0.2 attestation payload
 */
function isPayloadV02(payload: AttestationPayload): payload is AttestationPayloadV02 {
  return payload.version === '0.2';
}

/**
 * Type guard for v0.3 attestation payload
 */
function isPayloadV03(payload: AttestationPayload): payload is AttestationPayloadV03 {
  return payload.version === '0.3';
}

/**
 * Executor Proxy - Blind Executor Demo
 *
 * This endpoint demonstrates the core HAP principle:
 * The executor sees ONLY the verified Frame.
 *
 * What the executor receives:
 * - attestation blob (cryptographic proof)
 * - expected frame hash
 *
 * What the executor NEVER sees:
 * - Objectives
 * - Reasoning
 * - Tradeoff analysis
 * - Any semantic content
 *
 * This is blind execution by construction.
 */

interface ExecuteRequest {
  attestation: string; // base64url blob
  frame_hash: string;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body: ExecuteRequest = await request.json();

    if (!body.attestation || !body.frame_hash) {
      return NextResponse.json({
        authorized: false,
        error: 'MISSING_FIELDS',
        reason: 'attestation and frame_hash are required',
      }, { status: 400 });
    }

    // Get public key for verification
    const publicKeyHex = await getPublicKeyHex();

    // Verify the attestation
    let payload;
    try {
      payload = await verifyAttestation(
        body.attestation,
        publicKeyHex,
        body.frame_hash
      );
    } catch (verifyError) {
      const errorMessage = verifyError instanceof Error ? verifyError.message : 'Unknown error';
      return NextResponse.json({
        authorized: false,
        error: 'VERIFICATION_FAILED',
        reason: errorMessage,
      }, { status: 400 });
    }

    // Check TTL
    const now = Math.floor(Date.now() / 1000);
    if (payload.expires_at < now) {
      return NextResponse.json({
        authorized: false,
        error: 'EXPIRED',
        reason: `Attestation expired at ${new Date(payload.expires_at * 1000).toISOString()}`,
      }, { status: 400 });
    }

    // Check required scopes for the execution path
    const pathConfig = PROFILE_CONFIG.executionPaths[payload.profile_id.includes('canary') ? 'deploy-prod-canary' : 'deploy-prod-full'];
    // Note: In a real executor, you'd parse execution path from frame_hash or payload

    // Authorization successful - return what the executor sees
    // Note: NO objectives, NO reasoning, NO semantic content
    const processingTime = Date.now() - startTime;

    // Build execution info based on payload version
    const execution: Record<string, unknown> = {
      attestation_id: payload.attestation_id,
      frame_hash: payload.frame_hash,
      profile_id: payload.profile_id,
      issued_at: new Date(payload.issued_at * 1000).toISOString(),
      expires_at: new Date(payload.expires_at * 1000).toISOString(),
    };

    if (isPayloadV02(payload)) {
      // v0.2: include resolved_gates, decision_owners, decision_owner_scopes
      execution.resolved_gates = payload.resolved_gates;
      execution.decision_owners = payload.decision_owners;
      execution.scopes = payload.decision_owner_scopes;
    } else if (isPayloadV03(payload)) {
      // v0.3: include resolved_domains
      execution.resolved_domains = payload.resolved_domains;
    }

    return NextResponse.json({
      authorized: true,
      execution,
      // What the executor would print
      output: formatExecutorOutput(payload),
      meta: {
        processing_time_ms: processingTime,
        executor_version: '1.0.0-demo',
      },
    });
  } catch (error) {
    console.error('Executor error:', error);
    return NextResponse.json({
      authorized: false,
      error: 'INTERNAL_ERROR',
      reason: 'Failed to process authorization request',
    }, { status: 500 });
  }
}

/**
 * Format what the executor would actually print
 * This demonstrates that execution is BLIND to semantics
 */
function formatExecutorOutput(payload: AttestationPayload): string {
  let env = 'unknown';
  let domains: string[] = [];

  if (isPayloadV02(payload)) {
    env = payload.decision_owner_scopes[0]?.env || 'unknown';
    domains = payload.decision_owner_scopes.map(s => s.domain);
  } else if (isPayloadV03(payload)) {
    env = payload.resolved_domains[0]?.env || 'unknown';
    domains = payload.resolved_domains.map(d => d.domain);
  }

  const path = payload.profile_id.includes('canary') ? 'canary' : 'full';

  // Extract repo and sha from frame hash context (in real impl, from frame)
  return `
═══════════════════════════════════════════════════════
  DEPLOY AUTHORIZED
═══════════════════════════════════════════════════════

  Frame Hash: ${payload.frame_hash.slice(0, 20)}...
  Environment: ${env}
  Path: ${path}
  Domains: ${domains.join(', ') || 'none'}

═══════════════════════════════════════════════════════

  No objectives.
  No reasoning.
  No AI.

  This is blind execution.

═══════════════════════════════════════════════════════
`.trim();
}
