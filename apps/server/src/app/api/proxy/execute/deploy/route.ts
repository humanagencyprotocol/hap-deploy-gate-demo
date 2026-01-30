import { NextRequest, NextResponse } from 'next/server';
import { getPublicKeyHex, PROFILE_CONFIG } from '@/lib/sp';
import { getProdState, setProdState, type ProdState } from '@/lib/store';
import {
  decodeAttestationBlob,
  verifyAttestationSignature,
  checkAttestationExpiry,
  verifyFrameHash,
  computeFrameHash,
  attestationId,
  AttestationError,
  AttestationErrorCodes,
  DEPLOY_GATE_PROFILE,
} from '@hap-demo/core';

interface DeployRequest {
  attestation: string;
  payload: {
    template_id: string;
    params: {
      repo: string;
      sha: string;
      env: 'prod' | 'staging';
      profile_id: string;
      execution_path: string;
      disclosure_hash: string;
    };
  };
}

const ALLOWED_TEMPLATES = ['deploy-prod-v1'];

export async function POST(request: NextRequest) {
  try {
    // Check bearer token
    const authHeader = request.headers.get('authorization');
    const expectedToken = process.env.HAP_PROXY_TOKEN;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'FORBIDDEN', reason: 'NO_AUTH' },
        { status: 403 }
      );
    }

    const token = authHeader.slice(7);
    if (expectedToken && token !== expectedToken) {
      return NextResponse.json(
        { error: 'FORBIDDEN', reason: 'BAD_AUTH' },
        { status: 403 }
      );
    }

    const body: DeployRequest = await request.json();

    // Validate template_id
    if (!ALLOWED_TEMPLATES.includes(body.payload.template_id)) {
      return NextResponse.json(
        { error: 'FORBIDDEN', reason: 'BAD_TEMPLATE' },
        { status: 403 }
      );
    }

    // Decode and verify attestation
    const attestation = decodeAttestationBlob(body.attestation);

    // Verify signature
    const publicKeyHex = await getPublicKeyHex();
    await verifyAttestationSignature(attestation, publicKeyHex);

    // Check expiry
    checkAttestationExpiry(attestation.payload);

    // Verify profile_id
    if (attestation.payload.profile_id !== PROFILE_CONFIG.id) {
      return NextResponse.json(
        { error: 'FORBIDDEN', reason: 'PROFILE_MISMATCH' },
        { status: 403 }
      );
    }

    // Recompute frame_hash from payload params using the profile schema
    const expectedFrameHash = computeFrameHash({
      repo: body.payload.params.repo,
      sha: body.payload.params.sha,
      env: body.payload.params.env,
      profile: body.payload.params.profile_id,
      path: body.payload.params.execution_path,
      disclosure_hash: body.payload.params.disclosure_hash,
    }, DEPLOY_GATE_PROFILE);

    // Verify frame_hash matches
    verifyFrameHash(attestation, expectedFrameHash);

    // Update prod state
    const newState: ProdState = {
      version: 1,
      repo: body.payload.params.repo,
      sha: body.payload.params.sha,
      env: body.payload.params.env,
      profile_id: body.payload.params.profile_id,
      execution_path: body.payload.params.execution_path,
      frame_hash: expectedFrameHash,
      disclosure_hash: body.payload.params.disclosure_hash,
      attestation_id: attestationId(body.attestation),
      updated_at: Math.floor(Date.now() / 1000),
    };

    await setProdState(newState);

    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3001';

    return NextResponse.json({
      ok: true,
      prod_url: `${baseUrl}/prod`,
      prod_state: newState,
    });
  } catch (error) {
    console.error('Deploy error:', error);

    if (error instanceof AttestationError) {
      return NextResponse.json(
        { error: 'FORBIDDEN', reason: error.code },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { error: 'INTERNAL_ERROR', reason: 'Failed to process deploy request' },
      { status: 500 }
    );
  }
}
