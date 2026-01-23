import { NextRequest, NextResponse } from 'next/server';
import { Octokit } from '@octokit/rest';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const owner = searchParams.get('owner');
  const repo = searchParams.get('repo');
  const pr = searchParams.get('pr');

  if (!owner || !repo || !pr) {
    return NextResponse.json(
      { error: 'Missing required parameters: owner, repo, pr' },
      { status: 400 }
    );
  }

  try {
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

    const { data } = await octokit.issues.listComments({
      owner,
      repo,
      issue_number: parseInt(pr, 10),
      per_page: 100,
    });

    // Return only the fields we need
    const comments = data.map(comment => ({
      id: comment.id,
      body: comment.body || '',
      created_at: comment.created_at,
      user: comment.user?.login,
    }));

    return NextResponse.json(comments);
  } catch (error) {
    console.error('Failed to fetch comments:', error);
    return NextResponse.json(
      { error: 'Failed to fetch comments' },
      { status: 500 }
    );
  }
}
