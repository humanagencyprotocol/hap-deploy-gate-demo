import { NextResponse } from 'next/server';
import { getPublicKeyHex } from '@/lib/sp';

export async function GET() {
  const publicKey = await getPublicKeyHex();

  return NextResponse.json({
    public_key: publicKey,
    alg: 'Ed25519',
    kid: 'sp-demo-v1',
  });
}
