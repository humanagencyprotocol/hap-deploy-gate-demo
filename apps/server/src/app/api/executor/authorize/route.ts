import { NextRequest, NextResponse } from 'next/server';
import { verifyAttestation } from '@hap-demo/core';
import { getPublicKeyHex, PROFILE_CONFIG } from '@/lib/sp';

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

    return NextResponse.json({
      authorized: true,
      execution: {
        // This is ALL the executor sees
        attestation_id: payload.attestation_id,
        frame_hash: payload.frame_hash,
        profile_id: payload.profile_id,
        resolved_gates: payload.resolved_gates,
        decision_owners: payload.decision_owners,
        scopes: payload.decision_owner_scopes,
        issued_at: new Date(payload.issued_at * 1000).toISOString(),
        expires_at: new Date(payload.expires_at * 1000).toISOString(),
      },
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
function formatExecutorOutput(payload: {
  frame_hash: string;
  decision_owner_scopes: Array<{ domain: string; env: string }>;
  profile_id: string;
}): string {
  const env = payload.decision_owner_scopes[0]?.env || 'unknown';
  const path = payload.profile_id.includes('canary') ? 'canary' : 'full';

  // Extract repo and sha from frame hash context (in real impl, from frame)
  return `
═══════════════════════════════════════════════════════
  DEPLOY AUTHORIZED
═══════════════════════════════════════════════════════

  Frame Hash: ${payload.frame_hash.slice(0, 20)}...
  Environment: ${env}
  Path: ${path}
  Scopes: ${payload.decision_owner_scopes.map(s => s.domain).join(', ')}

═══════════════════════════════════════════════════════

  No objectives.
  No reasoning.
  No AI.

  This is blind execution.

═══════════════════════════════════════════════════════
`.trim();
}
