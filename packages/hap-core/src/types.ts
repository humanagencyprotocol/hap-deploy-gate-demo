/**
 * HAP Core Types
 */

export interface FrameParams {
  repo: string;
  sha: string;
  env: 'prod' | 'staging';
  profile: string;
  path: string;
  disclosure_hash: string;
}

export interface Disclosure {
  repo: string;
  sha: string;
  changed_paths: string[];
  risk_flags: string[];
}

export interface DecisionOwnerScope {
  did: string;
  domain: string;
  env: string;
}

export interface AttestationPayload {
  attestation_id: string;
  version: string;
  profile_id: string;
  frame_hash: string;
  resolved_gates: string[];
  decision_owners: string[];
  decision_owner_scopes: DecisionOwnerScope[];
  issued_at: number;
  expires_at: number;
}

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

export interface AttestationBlock {
  profile: string;
  env: string;
  path: string;
  sha: string;
  frame_hash: string;
  disclosure_hash: string;
  blob: string;
}

export interface AttestationRequest {
  profile_id: string;
  frame_hash: string;
  execution_path: string;
  resolved_gates: string[];
  decision_owners: string[];
  decision_owner_scopes: DecisionOwnerScope[];
}
