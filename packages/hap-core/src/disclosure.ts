/**
 * Disclosure Canonicalization and Validation
 *
 * Disclosure represents what the human reviewed before approving.
 * The hash binds the attestation to the specific review content.
 *
 * Disclosures contain:
 * - Shared context (repo, sha, changed files, risk flags)
 * - Per-domain content (problem, objective, tradeoffs for each required domain)
 */

import { createHash } from 'crypto';
import type { Disclosure, DomainDisclosure, Profile } from './types';

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
 * Validates a domain disclosure against the profile's disclosure schema
 */
export function validateDomainDisclosure(
  domain: string,
  disclosure: DomainDisclosure,
  profile: Profile
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const domainSchema = profile.disclosureSchema.domains[domain];

  if (!domainSchema) {
    errors.push(`Unknown domain "${domain}" not defined in profile ${profile.id}`);
    return { valid: false, errors };
  }

  // Validate each required field
  for (const [fieldName, fieldDef] of Object.entries(domainSchema)) {
    const value = disclosure[fieldName as keyof DomainDisclosure];

    if (!value) {
      errors.push(`Missing required field "${fieldName}" for domain "${domain}"`);
      continue;
    }

    if (fieldDef.minLength && value.length < fieldDef.minLength) {
      errors.push(
        `${domain}.${fieldName}: must be at least ${fieldDef.minLength} characters (got ${value.length})`
      );
    }

    if (fieldDef.maxLength && value.length > fieldDef.maxLength) {
      errors.push(
        `${domain}.${fieldName}: must be at most ${fieldDef.maxLength} characters (got ${value.length})`
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates a complete disclosure against the profile schema
 */
export function validateDisclosure(
  disclosure: Disclosure,
  requiredDomains: string[],
  profile: Profile
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check all required domains are present
  for (const domain of requiredDomains) {
    if (!disclosure.domains[domain]) {
      errors.push(`Missing disclosure for required domain: ${domain}`);
      continue;
    }

    const domainResult = validateDomainDisclosure(domain, disclosure.domains[domain], profile);
    errors.push(...domainResult.errors);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Builds the canonical disclosure object.
 * - Keys are sorted lexicographically at each level
 * - Set-typed fields (changed_paths, risk_flags) are sorted
 * - Domains are sorted alphabetically
 * - No insignificant whitespace
 */
export function canonicalDisclosure(disclosure: Disclosure): string {
  // Sort domains alphabetically
  const sortedDomains = Object.keys(disclosure.domains).sort();

  const canonical = {
    changed_paths: canonicalizePaths(disclosure.changed_paths),
    domains: Object.fromEntries(
      sortedDomains.map((domain) => [
        domain,
        {
          objective: disclosure.domains[domain].objective,
          problem: disclosure.domains[domain].problem,
          tradeoffs: disclosure.domains[domain].tradeoffs,
        },
      ])
    ),
    repo: disclosure.repo,
    risk_flags: sortSetField(disclosure.risk_flags),
    sha: disclosure.sha,
  };

  return JSON.stringify(canonical);
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
