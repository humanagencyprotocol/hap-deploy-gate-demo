/**
 * Frame Canonicalization
 *
 * Canonical frame string format (Deploy Gate Profile v0.2):
 *
 * repo=<repo_slug>
 * sha=<commit_sha>
 * env=prod
 * profile=deploy-gate@0.2
 * path=<execution_path>
 * disclosure_hash=<sha256:...>
 */

import { createHash } from 'crypto';
import type { FrameParams } from './types';

/**
 * Field format validators per Deploy Gate Profile v0.2
 */
const FIELD_PATTERNS = {
  repo: /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/,
  sha: /^[a-f0-9]{40}$/,
  env: /^(prod|staging)$/,
  profile: /^[a-z0-9_-]+@[0-9]+\.[0-9]+$/,
  path: /^[a-z0-9_-]+$/,
  disclosure_hash: /^sha256:[a-f0-9]{64}$/,
} as const;

/**
 * Validates a frame parameter against its field format
 */
export function validateFrameField(
  field: keyof typeof FIELD_PATTERNS,
  value: string
): { valid: boolean; error?: string } {
  const pattern = FIELD_PATTERNS[field];
  if (!pattern.test(value)) {
    return {
      valid: false,
      error: `Invalid ${field}: "${value}" does not match pattern ${pattern}`,
    };
  }
  return { valid: true };
}

/**
 * Validates all frame parameters
 */
export function validateFrameParams(params: FrameParams): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const [field, value] of Object.entries(params)) {
    const result = validateFrameField(field as keyof typeof FIELD_PATTERNS, value);
    if (!result.valid && result.error) {
      errors.push(result.error);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Builds the canonical frame string from parameters.
 * Keys are in fixed order per Deploy Gate Profile v0.2.
 *
 * @throws Error if any field fails validation
 */
export function canonicalFrame(params: FrameParams): string {
  const validation = validateFrameParams(params);
  if (!validation.valid) {
    throw new Error(`Invalid frame parameters: ${validation.errors.join('; ')}`);
  }

  // Fixed key order per Deploy Gate Profile v0.2
  const lines = [
    `repo=${params.repo}`,
    `sha=${params.sha}`,
    `env=${params.env}`,
    `profile=${params.profile}`,
    `path=${params.path}`,
    `disclosure_hash=${params.disclosure_hash}`,
  ];

  return lines.join('\n');
}

/**
 * Computes the frame hash from a canonical frame string.
 *
 * @returns Hash in format "sha256:<64 hex chars>"
 */
export function frameHash(canonicalFrameString: string): string {
  const hash = createHash('sha256').update(canonicalFrameString, 'utf8').digest('hex');
  return `sha256:${hash}`;
}

/**
 * Convenience function: builds canonical frame and computes hash in one step.
 */
export function computeFrameHash(params: FrameParams): string {
  return frameHash(canonicalFrame(params));
}
