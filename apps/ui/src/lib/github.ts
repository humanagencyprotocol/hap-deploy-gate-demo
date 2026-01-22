import { Octokit } from '@octokit/rest';

export interface PRDetails {
  number: number;
  title: string;
  body: string | null;
  state: string;
  head: {
    sha: string;
    ref: string;
  };
  base: {
    ref: string;
  };
  user: {
    login: string;
  };
  html_url: string;
  repo: string;
}

export interface PRFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

/**
 * Parse a PR URL or shorthand into owner/repo/number
 */
export function parsePRInput(input: string): { owner: string; repo: string; number: number } | null {
  // Handle full URL: https://github.com/owner/repo/pull/123
  const urlMatch = input.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2], number: parseInt(urlMatch[3], 10) };
  }

  // Handle shorthand: owner/repo#123
  const shortMatch = input.match(/^([^/]+)\/([^#]+)#(\d+)$/);
  if (shortMatch) {
    return { owner: shortMatch[1], repo: shortMatch[2], number: parseInt(shortMatch[3], 10) };
  }

  return null;
}

/**
 * Fetch PR details from GitHub
 */
export async function fetchPRDetails(
  owner: string,
  repo: string,
  pullNumber: number,
  token?: string
): Promise<PRDetails> {
  const octokit = new Octokit({ auth: token });

  const { data } = await octokit.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
  });

  return {
    number: data.number,
    title: data.title,
    body: data.body,
    state: data.state,
    head: {
      sha: data.head.sha,
      ref: data.head.ref,
    },
    base: {
      ref: data.base.ref,
    },
    user: {
      login: data.user?.login || 'unknown',
    },
    html_url: data.html_url,
    repo: `${owner}/${repo}`,
  };
}

/**
 * Fetch files changed in a PR
 */
export async function fetchPRFiles(
  owner: string,
  repo: string,
  pullNumber: number,
  token?: string
): Promise<PRFile[]> {
  const octokit = new Octokit({ auth: token });

  const { data } = await octokit.pulls.listFiles({
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100,
  });

  return data.map(file => ({
    filename: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    changes: file.changes,
    patch: file.patch,
  }));
}

/**
 * Post a comment to a PR
 */
export async function postPRComment(
  owner: string,
  repo: string,
  pullNumber: number,
  body: string,
  token: string
): Promise<string> {
  const octokit = new Octokit({ auth: token });

  const { data } = await octokit.issues.createComment({
    owner,
    repo,
    issue_number: pullNumber,
    body,
  });

  return data.html_url;
}
