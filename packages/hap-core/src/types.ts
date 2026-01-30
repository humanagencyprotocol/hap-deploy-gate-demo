/**
 * HAP Core Types
 */

/**
 * Frame parameters for v0.2 (includes disclosure_hash)
 */
export interface FrameParamsV02 {
  repo: string;
  sha: string;
  env: 'prod' | 'staging';
  profile: string;
  path: string;
  disclosure_hash: string;
}

/**
 * Frame parameters for v0.3 (no disclosure_hash - moved to attestation)
 */
export interface FrameParamsV03 {
  repo: string;
  sha: string;
  env: 'prod' | 'staging';
  profile: string;
  path: string;
}

/**
 * Union type for frame params (supports both versions)
 */
export type FrameParams = FrameParamsV02 | FrameParamsV03;

/**
 * Domain-specific disclosure content for v0.2
 */
export interface DomainDisclosureV02 {
  problem: string;
  objective: string;
  tradeoffs: string;
}

/**
 * Domain-specific disclosure content for v0.3 (flexible fields)
 */
export type DomainDisclosureV03 = Record<string, string | string[]>;

/**
 * Complete disclosure content that gets hashed (v0.2)
 */
export interface DisclosureV02 {
  // Shared context
  repo: string;
  sha: string;
  changed_paths: string[];
  risk_flags: string[];

  // Per-domain disclosures (keyed by domain name)
  domains: Record<string, DomainDisclosureV02>;
}

/**
 * Decision file structure for v0.3
 * Lives in .hap/decision.json in the commit
 */
export interface DecisionFile {
  profile: string;
  execution_path: string;
  disclosure: Record<string, DomainDisclosureV03>;
}

/**
 * Alias for backward compatibility
 */
export type DomainDisclosure = DomainDisclosureV02;
export type Disclosure = DisclosureV02;

/**
 * Profile field definition
 */
export interface ProfileFieldDef {
  description: string;
  pattern: string;
  required: boolean;
  allowedValues?: string[];
}

/**
 * Profile disclosure field definition
 */
export interface ProfileDisclosureFieldDef {
  type: string;
  description: string;
  minLength?: number;
  maxLength?: number;
}

/**
 * Profile domain disclosure schema for v0.2
 */
export interface ProfileDomainDisclosureSchemaV02 {
  problem: ProfileDisclosureFieldDef;
  objective: ProfileDisclosureFieldDef;
  tradeoffs: ProfileDisclosureFieldDef;
}

/**
 * Profile domain disclosure schema for v0.3 (flexible fields)
 */
export type ProfileDomainDisclosureSchema = Record<string, ProfileDisclosureFieldDef>;

/**
 * Profile execution path definition
 */
export interface ProfileExecutionPath {
  description: string;
  requiredDomains?: string[];  // v0.3: explicit list of required domains
  requiredScopes: Array<{ domain: string; env: string }>;
}

/**
 * Complete Profile definition
 */
export interface Profile {
  id: string;
  version: string;
  requiredGates: string[];

  frameSchema: {
    keyOrder: string[];
    fields: Record<string, ProfileFieldDef>;
  };

  disclosureSchema: {
    shared: Record<string, { type: string; description: string }>;
    domains: Record<string, ProfileDomainDisclosureSchema>;
  };

  executionPaths: Record<string, ProfileExecutionPath>;

  ttl: {
    default: number;
    max: number;
  };

  sdgSet: string[];
}

export interface DecisionOwnerScope {
  did: string;
  domain: string;
  env: string;
}

/**
 * Per-domain disclosure binding for v0.3 attestations
 */
export interface ResolvedDomain {
  domain: string;
  did: string;
  env: string;
  disclosure_hash: string;
}

/**
 * Attestation payload for v0.2
 */
export interface AttestationPayloadV02 {
  attestation_id: string;
  version: '0.2';
  profile_id: string;
  frame_hash: string;
  resolved_gates: string[];
  decision_owners: string[];
  decision_owner_scopes: DecisionOwnerScope[];
  issued_at: number;
  expires_at: number;
}

/**
 * Attestation payload for v0.3
 * Note: resolved_domains contains per-domain disclosure_hash
 */
export interface AttestationPayloadV03 {
  attestation_id: string;
  version: '0.3';
  profile_id: string;
  frame_hash: string;
  resolved_domains: ResolvedDomain[];
  issued_at: number;
  expires_at: number;
}

/**
 * Union type for attestation payloads
 */
export type AttestationPayload = AttestationPayloadV02 | AttestationPayloadV03;

export interface AttestationHeader {
  typ: 'HAP-attestation';
  alg: 'EdDSA';
  kid?: string;
}

export interface Attestation {
  header: AttestationHeader;
  payload: AttestationPayload;
  signature: string;
}

/**
 * Attestation block for v0.2 (single disclosure_hash)
 */
export interface AttestationBlockV02 {
  profile: string;
  role: string;
  env: string;
  path: string;
  sha: string;
  frame_hash: string;
  disclosure_hash: string;
  blob: string;
}

/**
 * Attestation block for v0.3 (per-domain disclosure_hash in blob)
 */
export interface AttestationBlockV03 {
  profile: string;
  domain: string;
  env: string;
  path: string;
  sha: string;
  frame_hash: string;
  domain_disclosure_hash: string;
  blob: string;
}

/**
 * Union type for attestation blocks
 */
export type AttestationBlock = AttestationBlockV02 | AttestationBlockV03;

/**
 * Attestation request for v0.2
 */
export interface AttestationRequestV02 {
  profile_id: string;
  frame_hash: string;
  execution_path: string;
  resolved_gates: string[];
  decision_owners: string[];
  decision_owner_scopes: DecisionOwnerScope[];
}

/**
 * Attestation request for v0.3
 */
export interface AttestationRequestV03 {
  profile_id: string;
  frame_hash: string;
  execution_path: string;
  domain: string;
  did: string;
  env: string;
  domain_disclosure_hash: string;
}

/**
 * Union type for attestation requests
 */
export type AttestationRequest = AttestationRequestV02 | AttestationRequestV03;
