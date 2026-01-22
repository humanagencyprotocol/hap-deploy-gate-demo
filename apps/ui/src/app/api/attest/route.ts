import { NextRequest, NextResponse } from 'next/server';

const SP_URL = process.env.NEXT_PUBLIC_SP_URL || 'http://localhost:3001';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const response = await fetch(`${SP_URL}/api/sp/attest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Attestation error:', error);
    return NextResponse.json(
      { error: 'Failed to request attestation' },
      { status: 500 }
    );
  }
}
