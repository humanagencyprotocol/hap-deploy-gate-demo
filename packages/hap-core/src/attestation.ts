/**
 * Attestation Parsing and Verification
 */

import { createHash } from 'crypto';
import * as ed from '@noble/ed25519';
import type { AttestationBlock, Attestation, AttestationPayload } from './types';

/**
 * Error codes for attestation validation failures
 */
export const AttestationErrorCodes = {
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  EXPIRED: 'EXPIRED',
  FRAME_MISMATCH: 'FRAME_MISMATCH',
  PATH_MISMATCH: 'PATH_MISMATCH',
  SCOPE_INSUFFICIENT: 'SCOPE_INSUFFICIENT',
  MALFORMED_ATTESTATION: 'MALFORMED_ATTESTATION',
  ALREADY_USED: 'ALREADY_USED',
} as const;

export type AttestationErrorCode = (typeof AttestationErrorCodes)[keyof typeof AttestationErrorCodes];

export class AttestationError extends Error {
  constructor(
    public code: AttestationErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AttestationError';
  }
}

/**
 * Parses an attestation block from a PR comment body.
 *
 * Expected format:
 * ---BEGIN HAP_ATTESTATION v=1---
 * profile=deploy-gate@0.2
 * env=prod
 * path=deploy-prod-canary
 * sha=<HEAD_SHA>
 * frame_hash=<sha256:...>
 * disclosure_hash=<sha256:...>
 * blob=<BASE64URL_ATTESTATION>
 * ---END HAP_ATTESTATION---
 *
 * @returns Parsed attestation block or null if not found/invalid
 */
export function parseAttestationBlock(commentBody: string): AttestationBlock | null {
  const beginMarker = '---BEGIN HAP_ATTESTATION v=1---';
  const endMarker = '---END HAP_ATTESTATION---';

  const beginIndex = commentBody.indexOf(beginMarker);
  const endIndex = commentBody.indexOf(endMarker);

  if (beginIndex === -1 || endIndex === -1 || endIndex <= beginIndex) {
    return null;
  }

  const blockContent = commentBody
    .slice(beginIndex + beginMarker.length, endIndex)
    .trim();

  const lines = blockContent.split('\n').map((line) => line.trim()).filter(Boolean);

  const data: Record<string, string> = {};
  const seenKeys = new Set<string>();

  for (const line of lines) {
    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) {
      return null; // Invalid line format
    }

    const key = line.slice(0, eqIndex);
    const value = line.slice(eqIndex + 1);

    // Reject duplicate keys
    if (seenKeys.has(key)) {
      return null;
    }
    seenKeys.add(key);

    data[key] = value;
  }

  // Validate required keys
  const requiredKeys = ['profile', 'env', 'path', 'sha', 'frame_hash', 'disclosure_hash', 'blob'];
  for (const key of requiredKeys) {
    if (!data[key]) {
      return null;
    }
  }

  return {
    profile: data.profile,
    env: data.env,
    path: data.path,
    sha: data.sha,
    frame_hash: data.frame_hash,
    disclosure_hash: data.disclosure_hash,
    blob: data.blob,
  };
}

/**
 * Formats an attestation block for posting to a PR comment.
 */
export function formatAttestationBlock(block: AttestationBlock): string {
  return `---BEGIN HAP_ATTESTATION v=1---
profile=${block.profile}
env=${block.env}
path=${block.path}
sha=${block.sha}
frame_hash=${block.frame_hash}
disclosure_hash=${block.disclosure_hash}
blob=${block.blob}
---END HAP_ATTESTATION---`;
}

/**
 * Decodes a base64url-encoded attestation blob.
 */
export function decodeAttestationBlob(blob: string): Attestation {
  try {
    // Convert base64url to base64
    const base64 = blob.replace(/-/g, '+').replace(/_/g, '/');
    const padding = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
    const json = Buffer.from(base64 + padding, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    throw new AttestationError(
      AttestationErrorCodes.MALFORMED_ATTESTATION,
      'Failed to decode attestation blob'
    );
  }
}

/**
 * Encodes an attestation as a base64url blob (no padding).
 */
export function encodeAttestationBlob(attestation: Attestation): string {
  const json = JSON.stringify(attestation);
  const base64 = Buffer.from(json, 'utf8').toString('base64');
  // Convert to base64url (no padding)
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Computes the attestation ID (hash of the blob).
 */
export function attestationId(blob: string): string {
  const hash = createHash('sha256').update(blob, 'utf8').digest('hex');
  return `sha256:${hash}`;
}

/**
 * Verifies an attestation signature using the SP public key.
 *
 * @param attestation - The decoded attestation
 * @param publicKeyHex - The SP public key in hex format
 * @throws AttestationError if signature is invalid
 */
export async function verifyAttestationSignature(
  attestation: Attestation,
  publicKeyHex: string
): Promise<void> {
  try {
    const payloadBytes = new TextEncoder().encode(JSON.stringify(attestation.payload));
    const signatureBytes = Buffer.from(attestation.signature, 'base64');
    const publicKeyBytes = Buffer.from(publicKeyHex, 'hex');

    const isValid = await ed.verifyAsync(signatureBytes, payloadBytes, publicKeyBytes);

    if (!isValid) {
      throw new AttestationError(
        AttestationErrorCodes.INVALID_SIGNATURE,
        'Attestation signature verification failed'
      );
    }
  } catch (error) {
    if (error instanceof AttestationError) throw error;
    throw new AttestationError(
      AttestationErrorCodes.INVALID_SIGNATURE,
      `Signature verification error: ${error}`
    );
  }
}

/**
 * Checks if an attestation has expired.
 *
 * @param payload - The attestation payload
 * @param now - Current timestamp in seconds (defaults to Date.now() / 1000)
 * @throws AttestationError if expired
 */
export function checkAttestationExpiry(
  payload: AttestationPayload,
  now: number = Math.floor(Date.now() / 1000)
): void {
  if (payload.expires_at <= now) {
    throw new AttestationError(
      AttestationErrorCodes.EXPIRED,
      `Attestation expired at ${payload.expires_at}, current time is ${now}`
    );
  }
}

/**
 * Verifies that the frame hash in the attestation matches the expected hash.
 *
 * @throws AttestationError if frame hash doesn't match
 */
export function verifyFrameHash(attestation: Attestation, expectedFrameHash: string): void {
  if (attestation.payload.frame_hash !== expectedFrameHash) {
    throw new AttestationError(
      AttestationErrorCodes.FRAME_MISMATCH,
      'Frame hash mismatch'
    );
  }
}

/**
 * Verifies that the execution path in the attestation matches the requested path.
 *
 * @throws AttestationError if path doesn't match
 */
export function verifyExecutionPath(
  attestationBlock: AttestationBlock,
  requestedPath: string
): void {
  if (attestationBlock.path !== requestedPath) {
    throw new AttestationError(
      AttestationErrorCodes.PATH_MISMATCH,
      `Path mismatch: attestation is for "${attestationBlock.path}", request is for "${requestedPath}"`
    );
  }
}

/**
 * Full attestation verification (signature + expiry + frame hash).
 *
 * @returns The decoded attestation payload
 * @throws AttestationError on any validation failure
 */
export async function verifyAttestation(
  blob: string,
  publicKeyHex: string,
  expectedFrameHash: string
): Promise<AttestationPayload> {
  const attestation = decodeAttestationBlob(blob);

  await verifyAttestationSignature(attestation, publicKeyHex);
  checkAttestationExpiry(attestation.payload);
  verifyFrameHash(attestation, expectedFrameHash);

  return attestation.payload;
}
