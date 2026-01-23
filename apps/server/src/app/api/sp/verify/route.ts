import { NextRequest, NextResponse } from 'next/server';
import { verifyAttestation } from '@hap-demo/core';
import { getPublicKeyHex } from '@/lib/sp';

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

      return NextResponse.json({
        valid: true,
        payload: {
          attestation_id: payload.attestation_id,
          profile_id: payload.profile_id,
          frame_hash: payload.frame_hash,
          resolved_gates: payload.resolved_gates,
          decision_owners: payload.decision_owners,
          issued_at: payload.issued_at,
          expires_at: payload.expires_at,
        },
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
