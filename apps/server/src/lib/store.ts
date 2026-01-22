/**
 * Prod State Storage
 *
 * Uses Vercel KV in production, in-memory store for local dev.
 */

export interface ProdState {
  version: number;
  repo: string;
  sha: string;
  env: string;
  profile_id: string;
  execution_path: string;
  frame_hash: string;
  disclosure_hash: string;
  attestation_id: string;
  updated_at: number;
}

// In-memory store for local development
let memoryStore: ProdState | null = null;

export async function getProdState(): Promise<ProdState | null> {
  // Try Vercel KV first
  if (process.env.KV_REST_API_URL) {
    const { kv } = await import('@vercel/kv');
    return kv.get<ProdState>('prod_state');
  }

  // Fall back to memory store
  return memoryStore;
}

export async function setProdState(state: ProdState): Promise<void> {
  // Try Vercel KV first
  if (process.env.KV_REST_API_URL) {
    const { kv } = await import('@vercel/kv');
    await kv.set('prod_state', state);
    return;
  }

  // Fall back to memory store
  memoryStore = state;
}
