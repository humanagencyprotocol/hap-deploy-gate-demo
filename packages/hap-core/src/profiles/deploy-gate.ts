/**
 * Deploy Gate Profile v0.3
 *
 * A Profile defines the complete schema for HAP enforcement in a specific domain.
 * This includes frame structure, canonicalization rules, disclosure schema,
 * execution paths, and TTL policies.
 *
 * v0.3 Changes:
 * - Disclosure provided by developer in .hap/decision.json (not entered in UI)
 * - Per-domain disclosure hashes in attestation (not single hash in frame)
 * - Domain owners validate (not create) disclosure content
 * - More concrete disclosure fields per domain
 */

import type { Profile } from '../types';

/**
 * v0.2 Profile (kept for backward compatibility)
 */
export const DEPLOY_GATE_PROFILE_V02: Profile = {
  id: 'deploy-gate@0.2',
  version: '0.2',

  // Required gates that must be closed before attestation
  requiredGates: ['frame', 'problem', 'objective', 'tradeoff', 'commitment', 'decision_owner'],

  // Frame schema: defines the canonical frame structure
  frameSchema: {
    // Keys in canonical order (order matters for hashing)
    keyOrder: ['repo', 'sha', 'env', 'profile', 'path', 'disclosure_hash'],

    // Field definitions with validation patterns
    fields: {
      repo: {
        description: 'Repository slug (owner/name)',
        pattern: '^[a-z0-9_.-]+\\/[a-z0-9_.-]+$',
        required: true,
      },
      sha: {
        description: 'Git commit SHA (40 hex characters)',
        pattern: '^[a-f0-9]{40}$',
        required: true,
      },
      env: {
        description: 'Deployment environment',
        pattern: '^(prod|staging)$',
        required: true,
        allowedValues: ['prod', 'staging'],
      },
      profile: {
        description: 'Profile identifier with version',
        pattern: '^[a-z0-9_-]+@[0-9]+\\.[0-9]+$',
        required: true,
      },
      path: {
        description: 'Execution path identifier',
        pattern: '^[a-z0-9_-]+$',
        required: true,
      },
      disclosure_hash: {
        description: 'SHA-256 hash of the disclosure content',
        pattern: '^sha256:[a-f0-9]{64}$',
        required: true,
      },
    },
  },

  // Disclosure schema: defines what each domain must articulate
  disclosureSchema: {
    // Shared fields across all domains
    shared: {
      repo: { type: 'string', description: 'Repository being deployed' },
      sha: { type: 'string', description: 'Commit SHA being deployed' },
      changed_paths: { type: 'string[]', description: 'Files changed in this commit' },
      risk_flags: { type: 'string[]', description: 'Detected risk indicators' },
    },

    // Per-domain disclosure requirements
    domains: {
      engineering: {
        problem: {
          type: 'string',
          description: 'What technical problem does this change solve?',
          minLength: 20,
          maxLength: 500,
        },
        objective: {
          type: 'string',
          description: 'What outcome are you approving from an engineering perspective?',
          minLength: 20,
          maxLength: 500,
        },
        tradeoffs: {
          type: 'string',
          description: 'What technical risks or costs are you accepting?',
          minLength: 20,
          maxLength: 500,
        },
      },
      release_management: {
        problem: {
          type: 'string',
          description: 'What release/operational problem does this address?',
          minLength: 20,
          maxLength: 500,
        },
        objective: {
          type: 'string',
          description: 'What outcome are you approving from a release perspective?',
          minLength: 20,
          maxLength: 500,
        },
        tradeoffs: {
          type: 'string',
          description: 'What operational risks or costs are you accepting?',
          minLength: 20,
          maxLength: 500,
        },
      },
    },
  },

  // Execution paths with required scopes
  executionPaths: {
    'deploy-prod-canary': {
      description: 'Canary deployment to production (limited rollout)',
      requiredScopes: [{ domain: 'engineering', env: 'prod' }],
    },
    'deploy-prod-full': {
      description: 'Full deployment to production (immediate rollout)',
      requiredScopes: [
        { domain: 'engineering', env: 'prod' },
        { domain: 'release_management', env: 'prod' },
      ],
    },
  },

  // TTL policies
  ttl: {
    default: 3600,  // 1 hour default TTL
    max: 86400,     // 24 hour max TTL
  },

  // Signal Detection Guides - fetched and executed locally in UI
  sdgSet: [
    'deploy/missing_decision_owner@1.0',
    'deploy/commitment_mismatch@1.0',
    'deploy/tradeoff_execution_mismatch@1.0',
    'deploy/objective_diff_mismatch@1.0',
  ],
};

/**
 * v0.3 Profile
 *
 * Key differences from v0.2:
 * - Frame does NOT include disclosure_hash (moved to per-domain in attestation)
 * - Disclosure fields are concrete per domain (diff_summary, test_status, etc.)
 * - Disclosure is provided in .hap/decision.json, not entered by user
 * - Domain owners validate the proposal, not create it
 */
export const DEPLOY_GATE_PROFILE: Profile = {
  id: 'deploy-gate@0.3',
  version: '0.3',

  // Required gates that must be closed before attestation
  // Note: Gates are now for VALIDATION, not data entry
  requiredGates: ['frame', 'decision_owner', 'disclosure_review', 'commitment'],

  // Frame schema: defines the canonical frame structure
  // v0.3: NO disclosure_hash in frame (moved to per-domain in attestation)
  frameSchema: {
    // Keys in canonical order (order matters for hashing)
    keyOrder: ['repo', 'sha', 'env', 'profile', 'path'],

    // Field definitions with validation patterns
    fields: {
      repo: {
        description: 'Repository slug (owner/name)',
        pattern: '^[a-z0-9_.-]+\\/[a-z0-9_.-]+$',
        required: true,
      },
      sha: {
        description: 'Git commit SHA (40 hex characters)',
        pattern: '^[a-f0-9]{40}$',
        required: true,
      },
      env: {
        description: 'Deployment environment',
        pattern: '^(prod|staging)$',
        required: true,
        allowedValues: ['prod', 'staging'],
      },
      profile: {
        description: 'Profile identifier with version',
        pattern: '^[a-z0-9_-]+@[0-9]+\\.[0-9]+$',
        required: true,
      },
      path: {
        description: 'Execution path identifier',
        pattern: '^[a-z0-9_-]+$',
        required: true,
      },
    },
  },

  // Disclosure schema: defines what each domain must be shown
  // v0.3: These fields come from .hap/decision.json, not user input
  disclosureSchema: {
    // Shared fields across all domains (from decision file)
    shared: {
      repo: { type: 'string', description: 'Repository being deployed' },
      sha: { type: 'string', description: 'Commit SHA being deployed' },
    },

    // Per-domain disclosure requirements
    // These are the fields that must be present in .hap/decision.json for each domain
    domains: {
      engineering: {
        diff_summary: {
          type: 'string',
          description: 'Summary of the changes being deployed',
          minLength: 10,
          maxLength: 1000,
        },
        changed_paths: {
          type: 'string[]',
          description: 'List of files changed in this commit',
        },
        test_status: {
          type: 'string',
          description: 'Status of automated tests',
          minLength: 10,
          maxLength: 500,
        },
        rollback_strategy: {
          type: 'string',
          description: 'How to revert if issues are discovered',
          minLength: 10,
          maxLength: 500,
        },
      },
      release_management: {
        deployment_window: {
          type: 'string',
          description: 'When this deployment should occur',
          minLength: 5,
          maxLength: 200,
        },
        rollback_plan: {
          type: 'string',
          description: 'Operational rollback procedure',
          minLength: 10,
          maxLength: 500,
        },
        monitoring_dashboards: {
          type: 'string',
          description: 'Links to monitoring dashboards',
          minLength: 3,
          maxLength: 500,
        },
      },
      marketing: {
        behavior_change_summary: {
          type: 'string',
          description: 'How user-visible behavior changes',
          minLength: 10,
          maxLength: 1000,
        },
        demo_url: {
          type: 'string',
          description: 'Preview URL to see the changes',
          minLength: 5,
          maxLength: 500,
        },
        rollout_plan: {
          type: 'string',
          description: 'How the change will be rolled out to users',
          minLength: 10,
          maxLength: 500,
        },
      },
      security: {
        affected_surfaces: {
          type: 'string[]',
          description: 'Security surfaces affected by this change',
        },
        threat_category: {
          type: 'string',
          description: 'Category of security concern',
          minLength: 5,
          maxLength: 200,
        },
        mitigation_path: {
          type: 'string',
          description: 'How security risks are mitigated',
          minLength: 10,
          maxLength: 500,
        },
      },
    },
  },

  // Execution paths with required domains
  // v0.3: Uses requiredDomains instead of requiredScopes
  executionPaths: {
    'deploy-prod-canary': {
      description: 'Canary deployment to production (limited rollout)',
      requiredDomains: ['engineering'],
      requiredScopes: [{ domain: 'engineering', env: 'prod' }],
    },
    'deploy-prod-full': {
      description: 'Full deployment to production (immediate rollout)',
      requiredDomains: ['engineering', 'release_management'],
      requiredScopes: [
        { domain: 'engineering', env: 'prod' },
        { domain: 'release_management', env: 'prod' },
      ],
    },
    'deploy-prod-user-facing': {
      description: 'User-facing feature deployment',
      requiredDomains: ['engineering', 'marketing'],
      requiredScopes: [
        { domain: 'engineering', env: 'prod' },
        { domain: 'marketing', env: 'prod' },
      ],
    },
    'deploy-prod-security': {
      description: 'Security-sensitive deployment',
      requiredDomains: ['engineering', 'security'],
      requiredScopes: [
        { domain: 'engineering', env: 'prod' },
        { domain: 'security', env: 'prod' },
      ],
    },
  },

  // TTL policies
  ttl: {
    default: 3600,  // 1 hour default TTL
    max: 86400,     // 24 hour max TTL
  },

  // Signal Detection Guides - fetched and executed locally in UI
  sdgSet: [
    'deploy/missing_decision_owner@1.0',
    'deploy/commitment_mismatch@1.0',
    'deploy/decision_file_missing@1.0',
    'deploy/disclosure_incomplete@1.0',
  ],
};

/**
 * Get a profile by ID
 */
export function getProfile(profileId: string): Profile | undefined {
  if (profileId === 'deploy-gate@0.3') {
    return DEPLOY_GATE_PROFILE;
  }
  if (profileId === 'deploy-gate@0.2') {
    return DEPLOY_GATE_PROFILE_V02;
  }
  return undefined;
}

/**
 * Get the latest profile version
 */
export function getLatestProfile(): Profile {
  return DEPLOY_GATE_PROFILE;
}
