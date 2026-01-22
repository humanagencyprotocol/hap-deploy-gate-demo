/**
 * Disclosure Canonicalization
 *
 * Disclosure represents what the human reviewed before approving.
 * The hash binds the attestation to the specific review content.
 */

import { createHash } from 'crypto';
import type { Disclosure } from './types';

/**
 * Canonicalizes a path by removing leading ./, .., trailing slashes, and duplicate slashes.
 *
 * @throws Error if path tries to escape repo root (contains ..)
 */
export function canonicalizePath(path: string): string {
  // Reject paths that try to escape
  if (path.includes('..')) {
    throw new Error(`Invalid path "${path}": contains .. (escapes repo root)`);
  }

  return path
    .replace(/^\.\//, '')        // Remove leading ./
    .replace(/\/+/g, '/')        // Collapse duplicate slashes
    .replace(/\/$/, '');         // Remove trailing slash
}

/**
 * Canonicalizes an array of paths and sorts them lexicographically.
 * This is required for set-typed fields in the disclosure.
 */
export function canonicalizePaths(paths: string[]): string[] {
  return paths.map(canonicalizePath).sort();
}

/**
 * Sorts an array of strings lexicographically (for set-typed fields).
 */
export function sortSetField(values: string[]): string[] {
  return [...values].sort();
}

/**
 * Builds the canonical disclosure object.
 * - Keys are sorted lexicographically
 * - Set-typed fields (changed_paths, risk_flags) are sorted
 * - No insignificant whitespace
 */
export function canonicalDisclosure(disclosure: Disclosure): string {
  const canonical = {
    changed_paths: canonicalizePaths(disclosure.changed_paths),
    repo: disclosure.repo,
    risk_flags: sortSetField(disclosure.risk_flags),
    sha: disclosure.sha,
  };

  // JSON.stringify with sorted keys (object is already in correct order due to alphabetical property names)
  // But to be safe, we explicitly sort
  const sortedKeys = Object.keys(canonical).sort();
  const sorted: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    sorted[key] = canonical[key as keyof typeof canonical];
  }

  return JSON.stringify(sorted);
}

/**
 * Computes the disclosure hash from a disclosure object.
 *
 * @returns Hash in format "sha256:<64 hex chars>"
 */
export function disclosureHash(disclosure: Disclosure): string {
  const canonical = canonicalDisclosure(disclosure);
  const hash = createHash('sha256').update(canonical, 'utf8').digest('hex');
  return `sha256:${hash}`;
}
