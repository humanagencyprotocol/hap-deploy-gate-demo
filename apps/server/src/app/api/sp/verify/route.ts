import { NextRequest, NextResponse } from 'next/server';
import { verifyAttestation } from '@hap-demo/core';
import type { AttestationPayload, AttestationPayloadV02, AttestationPayloadV03 } from '@hap-demo/core';
import { getPublicKeyHex } from '@/lib/sp';

/**
 * Type guard for v0.2 payload
 */
function isPayloadV02(payload: AttestationPayload): payload is AttestationPayloadV02 {
  return payload.version === '0.2';
}

/**
 * Type guard for v0.3 payload
 */
function isPayloadV03(payload: AttestationPayload): payload is AttestationPayloadV03 {
  return payload.version === '0.3';
}

interface VerifyRequest {
  attestation: string; // base64url blob
  expected_frame_hash?: string; // optional: verify frame hash matches
}

export async function POST(request: NextRequest) {
  try {
    const body: VerifyRequest = await request.json();

    if (!body.attestation) {
      return NextResponse.json(
        { valid: false, error: 'MISSING_ATTESTATION', reason: 'attestation field is required' },
        { status: 400 }
      );
    }

    const publicKeyHex = await getPublicKeyHex();

    try {
      const payload = await verifyAttestation(
        body.attestation,
        publicKeyHex,
        body.expected_frame_hash || '' // Skip frame hash check if not provided
      );

      // Build response based on payload version
      const responsePayload: Record<string, unknown> = {
        attestation_id: payload.attestation_id,
        version: payload.version,
        profile_id: payload.profile_id,
        frame_hash: payload.frame_hash,
        issued_at: payload.issued_at,
        expires_at: payload.expires_at,
      };

      if (isPayloadV02(payload)) {
        responsePayload.resolved_gates = payload.resolved_gates;
        responsePayload.decision_owners = payload.decision_owners;
        responsePayload.decision_owner_scopes = payload.decision_owner_scopes;
      } else if (isPayloadV03(payload)) {
        responsePayload.resolved_domains = payload.resolved_domains;
      }

      return NextResponse.json({
        valid: true,
        payload: responsePayload,
      });
    } catch (verifyError) {
      const errorMessage = verifyError instanceof Error ? verifyError.message : 'Unknown error';

      // Determine error type
      let errorCode = 'VERIFICATION_FAILED';
      if (errorMessage.includes('signature')) {
        errorCode = 'INVALID_SIGNATURE';
      } else if (errorMessage.includes('expired') || errorMessage.includes('EXPIRED')) {
        errorCode = 'EXPIRED';
      } else if (errorMessage.includes('frame') || errorMessage.includes('FRAME_MISMATCH')) {
        errorCode = 'FRAME_MISMATCH';
      }

      return NextResponse.json(
        { valid: false, error: errorCode, reason: errorMessage },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Verify error:', error);
    return NextResponse.json(
      { valid: false, error: 'INTERNAL_ERROR', reason: 'Failed to process verification request' },
      { status: 500 }
    );
  }
}
