export interface DecisionOwner {
  id: string;
  label: string;
  scope: string;
}

export interface DisclosureItem {
  file: string;
  selected: boolean;
  category: 'code' | 'config' | 'docs' | 'other';
}

export interface AttestationRequest {
  profile_id: string;
  execution_path: string;
  frame: {
    repo: string;
    sha: string;
    env: string;
    disclosures: string[];
  };
  decision_owners: Array<{
    id: string;
    scope: string;
  }>;
  gates: {
    problem_understood: boolean;
    objective_clear: boolean;
    tradeoffs_acceptable: boolean;
  };
  ttl_seconds: number;
}

export interface AttestationResponse {
  attestation: string; // base64url blob
  frame_hash: string;
  disclosure_hash: string;
  expires_at: string;
}

export type Step = 'select-pr' | 'review-changes' | 'set-path' | 'gates' | 'confirm' | 'done';
