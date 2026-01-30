import { Octokit } from '@octokit/rest';
import type { DecisionFile } from '@hap-demo/core';

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

/**
 * Result of fetching a decision file
 */
export interface DecisionFileResult {
  found: boolean;
  decisionFile: DecisionFile | null;
  error?: string;
}

/**
 * Fetch the .hap/decision.json file from a specific commit
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param sha - Commit SHA to fetch the file from
 * @param token - GitHub token (optional but recommended)
 * @returns The decision file content or null if not found
 */
export async function fetchDecisionFile(
  owner: string,
  repo: string,
  sha: string,
  token?: string
): Promise<DecisionFileResult> {
  const octokit = new Octokit({ auth: token });
  const filePath = '.hap/decision.json';

  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path: filePath,
      ref: sha,
    });

    // getContent returns an array for directories, single object for files
    if (Array.isArray(data)) {
      return {
        found: false,
        decisionFile: null,
        error: `${filePath} is a directory, expected a file`,
      };
    }

    if (data.type !== 'file') {
      return {
        found: false,
        decisionFile: null,
        error: `${filePath} is not a file (type: ${data.type})`,
      };
    }

    // Decode base64 content
    const content = Buffer.from(data.content, 'base64').toString('utf8');

    try {
      const decisionFile = JSON.parse(content) as DecisionFile;

      // Validate required fields
      if (!decisionFile.profile) {
        return {
          found: true,
          decisionFile: null,
          error: 'Decision file missing required field: profile',
        };
      }
      if (!decisionFile.execution_path) {
        return {
          found: true,
          decisionFile: null,
          error: 'Decision file missing required field: execution_path',
        };
      }
      if (!decisionFile.disclosure || typeof decisionFile.disclosure !== 'object') {
        return {
          found: true,
          decisionFile: null,
          error: 'Decision file missing required field: disclosure',
        };
      }

      return {
        found: true,
        decisionFile,
      };
    } catch {
      return {
        found: true,
        decisionFile: null,
        error: 'Decision file is not valid JSON',
      };
    }
  } catch (error) {
    // Check if it's a 404 (file not found)
    if (error instanceof Error && 'status' in error && (error as { status: number }).status === 404) {
      return {
        found: false,
        decisionFile: null,
        error: `No ${filePath} found in commit ${sha.slice(0, 7)}`,
      };
    }

    // Other error
    return {
      found: false,
      decisionFile: null,
      error: `Failed to fetch ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}
