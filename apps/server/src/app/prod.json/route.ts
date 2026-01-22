import { NextResponse } from 'next/server';
import { getProdState } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const state = await getProdState();

  if (!state) {
    return NextResponse.json(
      { error: 'NOT_DEPLOYED_YET' },
      { status: 404 }
    );
  }

  return NextResponse.json(state);
}
