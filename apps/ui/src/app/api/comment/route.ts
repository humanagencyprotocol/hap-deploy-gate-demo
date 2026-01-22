import { NextRequest, NextResponse } from 'next/server';
import { Octokit } from '@octokit/rest';

export async function POST(request: NextRequest) {
  const githubToken = process.env.GITHUB_TOKEN;

  if (!githubToken) {
    return NextResponse.json(
      { error: 'GITHUB_TOKEN not configured' },
      { status: 500 }
    );
  }

  try {
    const { owner, repo, pullNumber, body } = await request.json();

    if (!owner || !repo || !pullNumber || !body) {
      return NextResponse.json(
        { error: 'Missing required fields: owner, repo, pullNumber, body' },
        { status: 400 }
      );
    }

    const octokit = new Octokit({ auth: githubToken });

    const { data } = await octokit.issues.createComment({
      owner,
      repo,
      issue_number: pullNumber,
      body,
    });

    return NextResponse.json({
      comment_url: data.html_url,
      comment_id: data.id,
    });
  } catch (error) {
    console.error('Comment error:', error);
    return NextResponse.json(
      { error: 'Failed to post comment' },
      { status: 500 }
    );
  }
}
