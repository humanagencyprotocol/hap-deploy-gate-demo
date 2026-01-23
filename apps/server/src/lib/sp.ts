/**
 * Service Provider utilities
 */

import * as ed from '@noble/ed25519';

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
 * Profile validation rules for deploy-gate@0.2
 */
export const PROFILE_CONFIG = {
  id: 'deploy-gate@0.2',
  requiredGates: ['frame', 'problem', 'objective', 'tradeoff', 'commitment', 'decision_owners'],
  executionPaths: {
    'deploy-prod-canary': {
      requiredScopes: [{ domain: 'engineering', env: 'prod' }],
    },
    'deploy-prod-full': {
      requiredScopes: [
        { domain: 'engineering', env: 'prod' },
        { domain: 'release_management', env: 'prod' },
      ],
    },
  },
  ttl: {
    default: 3600, // 1 hour default TTL
    max: 86400, // 24 hour max
  },
  // Signal Detection Guides - fetched and executed locally in UI
  sdgSet: [
    'deploy/missing_decision_owner@1.0',
    'deploy/commitment_mismatch@1.0',
    'deploy/tradeoff_execution_mismatch@1.0',
    'deploy/objective_diff_mismatch@1.0', // Warning only - semantic SDGs cannot block
  ],
} as const;

export type ExecutionPath = keyof typeof PROFILE_CONFIG.executionPaths;
