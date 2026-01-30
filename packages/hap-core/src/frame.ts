/**
 * Frame Canonicalization
 *
 * Frames are canonicalized according to the Profile's frameSchema.
 * The Profile defines:
 * - keyOrder: the canonical order of keys for hashing
 * - fields: validation patterns and requirements for each field
 */

import { createHash } from 'crypto';
import type { FrameParams, Profile } from './types';

/**
 * Validates a frame parameter against the profile's field definition
 */
export function validateFrameField(
  field: string,
  value: string,
  profile: Profile
): { valid: boolean; error?: string } {
  const fieldDef = profile.frameSchema.fields[field];

  if (!fieldDef) {
    return {
      valid: false,
      error: `Unknown field "${field}" not defined in profile ${profile.id}`,
    };
  }

  const pattern = new RegExp(fieldDef.pattern);
  if (!pattern.test(value)) {
    return {
      valid: false,
      error: `Invalid ${field}: "${value}" does not match pattern ${fieldDef.pattern}`,
    };
  }

  if (fieldDef.allowedValues && !fieldDef.allowedValues.includes(value)) {
    return {
      valid: false,
      error: `Invalid ${field}: "${value}" not in allowed values [${fieldDef.allowedValues.join(', ')}]`,
    };
  }

  return { valid: true };
}

/**
 * Validates all frame parameters against the profile schema
 */
export function validateFrameParams(
  params: FrameParams,
  profile: Profile
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check all required fields are present
  for (const [fieldName, fieldDef] of Object.entries(profile.frameSchema.fields)) {
    if (fieldDef.required && !(fieldName in params)) {
      errors.push(`Missing required field: ${fieldName}`);
    }
  }

  // Validate each provided field
  for (const [field, value] of Object.entries(params)) {
    const result = validateFrameField(field, value, profile);
    if (!result.valid && result.error) {
      errors.push(result.error);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Builds the canonical frame string from parameters.
 * Keys are ordered according to the profile's keyOrder.
 *
 * @throws Error if any field fails validation
 */
export function canonicalFrame(params: FrameParams, profile: Profile): string {
  const validation = validateFrameParams(params, profile);
  if (!validation.valid) {
    throw new Error(`Invalid frame parameters: ${validation.errors.join('; ')}`);
  }

  // Use profile-defined key order
  const lines = profile.frameSchema.keyOrder.map(
    (key) => `${key}=${params[key as keyof FrameParams]}`
  );

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
export function computeFrameHash(params: FrameParams, profile: Profile): string {
  return frameHash(canonicalFrame(params, profile));
}
