/**
 * Service Provider utilities
 */

import * as ed from '@noble/ed25519';
import { DEPLOY_GATE_PROFILE } from '@hap-demo/core';

// In production, these would be environment variables
// For demo, we generate a keypair if not set
let cachedKeyPair: { privateKey: Uint8Array; publicKey: Uint8Array } | null = null;

export async function getKeyPair(): Promise<{ privateKey: Uint8Array; publicKey: Uint8Array }> {
  if (cachedKeyPair) {
    return cachedKeyPair;
  }

  const privateKeyHex = process.env.SP_PRIVATE_KEY;
  const publicKeyHex = process.env.SP_PUBLIC_KEY;

  if (privateKeyHex && publicKeyHex) {
    cachedKeyPair = {
      privateKey: Buffer.from(privateKeyHex, 'hex'),
      publicKey: Buffer.from(publicKeyHex, 'hex'),
    };
  } else {
    // Generate a new keypair for demo
    console.warn('SP_PRIVATE_KEY/SP_PUBLIC_KEY not set, generating ephemeral keypair');
    const privateKey = ed.utils.randomPrivateKey();
    const publicKey = await ed.getPublicKeyAsync(privateKey);
    cachedKeyPair = { privateKey, publicKey };
  }

  return cachedKeyPair;
}

export async function getPublicKeyHex(): Promise<string> {
  const { publicKey } = await getKeyPair();
  return Buffer.from(publicKey).toString('hex');
}

export async function signPayload(payload: object): Promise<string> {
  const { privateKey } = await getKeyPair();
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const signature = await ed.signAsync(payloadBytes, privateKey);
  return Buffer.from(signature).toString('base64');
}

/**
 * Re-export the profile from hap-core for backwards compatibility
 */
export const PROFILE_CONFIG = DEPLOY_GATE_PROFILE;

export type ExecutionPath = keyof typeof PROFILE_CONFIG.executionPaths;
