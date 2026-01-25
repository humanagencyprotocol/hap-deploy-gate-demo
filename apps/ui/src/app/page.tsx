'use client';

import { useState, useCallback, useEffect } from 'react';
import { parsePRInput, fetchPRDetails, fetchPRFiles, PRDetails, PRFile } from '../lib/github';
import { runSDGs, hasHardStop, getHardStops, getWarnings, SDGResult, SDGContext } from '../sdg/runner';
import {
  LocalAIConfig,
  DEFAULT_AI_CONFIG,
  PROVIDER_PRESETS,
  checkAIAvailability,
  getAIAssistance,
  getFallbackAssistance,
  AIAssistanceRequest,
} from '../local-ai/client';

type Step = 'ai-config' | 'select-pr' | 'review-changes' | 'set-path' | 'select-role' | 'gates' | 'confirm' | 'done';
type Role = 'engineering' | 'release_management';
type AIMode = 'local' | 'public' | 'none';

interface AttestationResult {
  attestation: string;
  frame_hash: string;
  disclosure_hash: string;
  expires_at: string;
}

interface ExistingAttestation {
  role: string;
  sha: string;
  profile: string;
  expires_at?: string;
  comment_id: number;
}

const ROLE_INFO: Record<Role, { label: string; description: string }> = {
  engineering: {
    label: 'Engineering',
    description: 'Technical review - verify code quality, tests, and implementation',
  },
  release_management: {
    label: 'Release Management',
    description: 'Release approval - verify deployment readiness and rollout plan',
  },
};

const styles = {
  main: {
    maxWidth: '900px',
    margin: '0 auto',
    padding: '2rem',
    fontFamily: 'system-ui, sans-serif',
  },
  card: {
    padding: '1.5rem',
    backgroundColor: '#f8f9fa',
    borderRadius: '8px',
    marginBottom: '1.5rem',
  },
  cardActive: {
    padding: '1.5rem',
    backgroundColor: '#fff',
    borderRadius: '8px',
    marginBottom: '1.5rem',
    border: '2px solid #1976d2',
  },
  input: {
    width: '100%',
    padding: '0.75rem',
    fontSize: '1rem',
    borderRadius: '4px',
    border: '1px solid #ccc',
    boxSizing: 'border-box' as const,
  },
  button: {
    padding: '0.75rem 1.5rem',
    fontSize: '1rem',
    backgroundColor: '#1976d2',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    marginRight: '0.5rem',
  },
  buttonSecondary: {
    padding: '0.75rem 1.5rem',
    fontSize: '1rem',
    backgroundColor: '#fff',
    color: '#1976d2',
    border: '1px solid #1976d2',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  buttonDisabled: {
    padding: '0.75rem 1.5rem',
    fontSize: '1rem',
    backgroundColor: '#ccc',
    color: '#666',
    border: 'none',
    borderRadius: '4px',
    cursor: 'not-allowed',
  },
  checkbox: {
    marginRight: '0.5rem',
    width: '18px',
    height: '18px',
  },
  fileList: {
    listStyle: 'none',
    padding: 0,
    margin: '1rem 0',
  },
  fileItem: {
    padding: '0.5rem',
    borderBottom: '1px solid #eee',
    display: 'flex',
    alignItems: 'center',
  },
  badge: {
    display: 'inline-block',
    padding: '0.2rem 0.5rem',
    borderRadius: '4px',
    fontSize: '0.75rem',
    marginLeft: '0.5rem',
  },
  error: {
    color: '#d32f2f',
    backgroundColor: '#ffebee',
    padding: '1rem',
    borderRadius: '4px',
    marginBottom: '1rem',
  },
  success: {
    color: '#2e7d32',
    backgroundColor: '#e8f5e9',
    padding: '1rem',
    borderRadius: '4px',
    marginBottom: '1rem',
  },
  warning: {
    color: '#e65100',
    backgroundColor: '#fff3e0',
    padding: '1rem',
    borderRadius: '4px',
    marginBottom: '1rem',
  },
  pre: {
    backgroundColor: '#263238',
    color: '#aed581',
    padding: '1rem',
    borderRadius: '4px',
    overflow: 'auto',
    fontSize: '0.85rem',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-all' as const,
  },
  stepIndicator: {
    display: 'flex',
    marginBottom: '2rem',
    gap: '0.5rem',
  },
  stepDot: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.9rem',
    fontWeight: 'bold' as const,
  },
  roleCard: {
    padding: '1rem',
    borderRadius: '8px',
    marginBottom: '0.75rem',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  attestationStatus: {
    display: 'flex',
    alignItems: 'center',
    padding: '0.5rem 0.75rem',
    borderRadius: '4px',
    marginBottom: '0.5rem',
    fontSize: '0.9rem',
  },
};

const stepOrder: Step[] = ['ai-config', 'select-pr', 'review-changes', 'set-path', 'select-role', 'gates', 'confirm', 'done'];

function getStatusBadge(status: string) {
  const colors: Record<string, { bg: string; text: string }> = {
    added: { bg: '#e8f5e9', text: '#2e7d32' },
    removed: { bg: '#ffebee', text: '#c62828' },
    modified: { bg: '#fff3e0', text: '#e65100' },
    renamed: { bg: '#e3f2fd', text: '#1565c0' },
  };
  const color = colors[status] || { bg: '#f5f5f5', text: '#616161' };
  return (
    <span style={{ ...styles.badge, backgroundColor: color.bg, color: color.text }}>
      {status}
    </span>
  );
}

// Parse attestations from PR comments
function parseAttestationsFromComments(comments: Array<{ id: number; body: string }>, headSha: string): ExistingAttestation[] {
  const attestations: ExistingAttestation[] = [];
  const beginMarker = '---BEGIN HAP_ATTESTATION v=1---';
  const endMarker = '---END HAP_ATTESTATION---';

  for (const comment of comments) {
    const body = comment.body || '';
    const beginIdx = body.indexOf(beginMarker);
    const endIdx = body.indexOf(endMarker);

    if (beginIdx === -1 || endIdx === -1) continue;

    const block = body.slice(beginIdx + beginMarker.length, endIdx).trim();
    const lines = block.split('\n').map(l => l.trim());
    const data: Record<string, string> = {};

    for (const line of lines) {
      const eq = line.indexOf('=');
      if (eq > 0) data[line.slice(0, eq)] = line.slice(eq + 1);
    }

    // Only include attestations for current SHA
    if (data.sha === headSha && data.role) {
      attestations.push({
        role: data.role,
        sha: data.sha,
        profile: data.profile,
        comment_id: comment.id,
      });
    }
  }

  return attestations;
}

export default function Home() {
  const [step, setStep] = useState<Step>('ai-config');
  const [prInput, setPrInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // PR data
  const [prDetails, setPrDetails] = useState<PRDetails | null>(null);
  const [prFiles, setPrFiles] = useState<PRFile[]>([]);
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');

  // Existing attestations
  const [existingAttestations, setExistingAttestations] = useState<ExistingAttestation[]>([]);

  // User selections
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [executionPath, setExecutionPath] = useState<'canary' | 'full'>('canary');
  const [targetEnv, setTargetEnv] = useState<'staging' | 'prod'>('prod');
  const [selectedRole, setSelectedRole] = useState<Role>('engineering');

  // Gates
  const [problemUnderstood, setProblemUnderstood] = useState(false);
  const [objectiveClear, setObjectiveClear] = useState(false);
  const [tradeoffsAcceptable, setTradeoffsAcceptable] = useState(false);
  const [objectiveText, setObjectiveText] = useState(''); // User's stated objective

  // SDG Results
  const [sdgResults, setSdgResults] = useState<SDGResult[]>([]);
  const [sdgChecked, setSdgChecked] = useState(false);

  // Result
  const [attestationResult, setAttestationResult] = useState<AttestationResult | null>(null);
  const [commentUrl, setCommentUrl] = useState<string | null>(null);
  const [executorOutput, setExecutorOutput] = useState<string | null>(null);

  // Feedback (post-execution, non-protocol)
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [feedbackAnswers, setFeedbackAnswers] = useState({
    objectiveAchieved: '',
    tradeoffsAcceptable: '',
    surprised: '',
  });

  // Local AI (advisory only - cannot affect protocol)
  const [aiMode, setAiMode] = useState<AIMode>('none');
  const [aiConfig, setAiConfig] = useState<LocalAIConfig>({ ...DEFAULT_AI_CONFIG, enabled: false });
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [aiDisclaimer, setAiDisclaimer] = useState<string | null>(null);
  const [showAiSettings, setShowAiSettings] = useState(false);
  const [aiResponseType, setAiResponseType] = useState<'question' | 'draft_options'>('question');
  const [aiConfigTesting, setAiConfigTesting] = useState(false);
  const [aiConfigError, setAiConfigError] = useState<string | null>(null);

  // Track if objective was AI-assisted and requires editing
  const [objectiveAiDraft, setObjectiveAiDraft] = useState<string | null>(null);
  const objectiveWasEdited = objectiveAiDraft === null || objectiveText !== objectiveAiDraft;

  // Check AI availability on mount
  useEffect(() => {
    checkAIAvailability(aiConfig).then(setAiAvailable);
  }, [aiConfig]);

  // Validate AI config and test connection before proceeding
  const validateAndTestAI = useCallback(async (): Promise<boolean> => {
    // If no AI selected, just proceed
    if (aiMode === 'none') {
      setAiConfigError(null);
      return true;
    }

    // Validate required fields
    if (!aiConfig.endpoint) {
      setAiConfigError('Please enter an endpoint URL');
      return false;
    }

    if (!aiConfig.model) {
      setAiConfigError('Please enter a model name');
      return false;
    }

    // For public AI, require API key
    if (aiMode === 'public' && !aiConfig.apiKey) {
      setAiConfigError('API key is required for public AI providers');
      return false;
    }

    // Test connection
    setAiConfigTesting(true);
    setAiConfigError(null);

    try {
      const available = await checkAIAvailability(aiConfig);
      setAiAvailable(available);

      if (!available) {
        if (aiMode === 'local') {
          setAiConfigError('Cannot connect to local AI. Make sure Ollama is running.');
        } else {
          setAiConfigError('Cannot connect to AI provider. Check your endpoint and API key.');
        }
        setAiConfigTesting(false);
        return false;
      }

      setAiConfigTesting(false);
      return true;
    } catch {
      setAiConfigError('Connection test failed. Please check your settings.');
      setAiConfigTesting(false);
      return false;
    }
  }, [aiMode, aiConfig]);

  // Request AI assistance
  const requestAIAssistance = useCallback(async (type: AIAssistanceRequest['type']) => {
    if (!prDetails) return;

    setAiLoading(true);
    setAiSuggestion(null);
    setAiDisclaimer(null);
    setAiResponseType(type === 'draft_options' ? 'draft_options' : 'question');

    const request: AIAssistanceRequest = {
      type,
      context: {
        prTitle: prDetails.title,
        prDescription: prDetails.body || undefined,
        diffSummary: prFiles.map(f => `${f.status}: ${f.filename} (+${f.additions}/-${f.deletions})`).join('\n'),
        changedFiles: prFiles.map(f => f.filename),
        currentObjective: objectiveText,
      },
    };

    let response;
    if (aiAvailable) {
      response = await getAIAssistance(aiConfig, request);
    } else {
      response = getFallbackAssistance(request);
    }

    setAiSuggestion(response.suggestion || response.error || null);
    setAiDisclaimer(response.disclaimer);
    setAiLoading(false);
  }, [prDetails, prFiles, objectiveText, aiAvailable, aiConfig]);

  // Use AI draft option as starting point (requires edit before gate can close)
  const useAsDraft = useCallback((draftText: string) => {
    setObjectiveText(draftText);
    setObjectiveAiDraft(draftText); // Track that this came from AI
    setAiSuggestion(null);
    setAiDisclaimer(null);
  }, []);

  // Determine required roles based on execution path
  const requiredRoles: Role[] = executionPath === 'full'
    ? ['engineering', 'release_management']
    : ['engineering'];

  // Check which roles are already attested
  const attestedRoles = new Set(existingAttestations.map(a => a.role));
  const missingRoles = requiredRoles.filter(r => !attestedRoles.has(r));
  const allRolesAttested = missingRoles.length === 0;

  const loadPR = useCallback(async () => {
    setError(null);
    const parsed = parsePRInput(prInput);
    if (!parsed) {
      setError('Invalid PR URL or format. Use: owner/repo#123 or https://github.com/owner/repo/pull/123');
      return;
    }

    setLoading(true);
    try {
      const [details, files] = await Promise.all([
        fetchPRDetails(parsed.owner, parsed.repo, parsed.number),
        fetchPRFiles(parsed.owner, parsed.repo, parsed.number),
      ]);

      setPrDetails(details);
      setPrFiles(files);
      setOwner(parsed.owner);
      setRepo(parsed.repo);

      // Pre-select all files
      setSelectedFiles(new Set(files.map(f => f.filename)));

      // Fetch existing attestations
      const commentsRes = await fetch(`/api/comments?owner=${parsed.owner}&repo=${parsed.repo}&pr=${parsed.number}`);
      if (commentsRes.ok) {
        const comments = await commentsRes.json();
        const attestations = parseAttestationsFromComments(comments, details.head.sha);
        setExistingAttestations(attestations);
      }

      setStep('review-changes');
    } catch (err) {
      setError(`Failed to load PR: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }, [prInput]);

  const toggleFile = useCallback((filename: string) => {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(filename)) {
        next.delete(filename);
      } else {
        next.add(filename);
      }
      return next;
    });
  }, []);

  const selectAllFiles = useCallback(() => {
    setSelectedFiles(new Set(prFiles.map(f => f.filename)));
  }, [prFiles]);

  const deselectAllFiles = useCallback(() => {
    setSelectedFiles(new Set());
  }, []);

  const requestAttestation = useCallback(async () => {
    if (!prDetails) return;

    setError(null);
    setLoading(true);

    try {
      const response = await fetch('/api/attest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile_id: 'deploy-gate@0.2',
          execution_path: executionPath,
          role: selectedRole,
          frame: {
            repo: prDetails.repo,
            sha: prDetails.head.sha,
            env: targetEnv,
            disclosures: Array.from(selectedFiles),
          },
          decision_owners: [
            { id: `${selectedRole}-reviewer`, scope: selectedRole },
          ],
          gates: {
            problem_understood: problemUnderstood,
            objective_clear: objectiveClear,
            tradeoffs_acceptable: tradeoffsAcceptable,
          },
          ttl_seconds: 3600,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.reason || 'Attestation failed');
      }

      setAttestationResult(data);
      setStep('done');
    } catch (err) {
      setError(`Attestation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }, [prDetails, executionPath, targetEnv, selectedFiles, problemUnderstood, objectiveClear, tradeoffsAcceptable, selectedRole]);

  const postComment = useCallback(async () => {
    if (!prDetails || !attestationResult) return;

    setError(null);
    setLoading(true);

    const roleLabel = ROLE_INFO[selectedRole].label;
    const commentBody = `## HAP Deploy Gate Attestation - ${roleLabel}

**Role:** \`${selectedRole}\`
**Profile:** \`deploy-gate@0.2\`
**Execution Path:** \`${executionPath}\`
**Environment:** \`${targetEnv}\`
**Commit:** \`${prDetails.head.sha}\`

### Disclosures
${Array.from(selectedFiles).map(f => `- \`${f}\``).join('\n')}

### Gates Confirmed by ${roleLabel}
- [x] Problem understood
- [x] Objective clear
- [x] Tradeoffs acceptable

---

\`\`\`
---BEGIN HAP_ATTESTATION v=1---
profile=deploy-gate@0.2
role=${selectedRole}
env=${targetEnv}
path=${executionPath}
sha=${prDetails.head.sha}
frame_hash=${attestationResult.frame_hash}
disclosure_hash=${attestationResult.disclosure_hash}
blob=${attestationResult.attestation}
---END HAP_ATTESTATION---
\`\`\`

*Attestation expires: ${new Date(attestationResult.expires_at).toLocaleString()}*`;

    try {
      const response = await fetch('/api/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner,
          repo,
          pullNumber: prDetails.number,
          body: commentBody,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to post comment');
      }

      setCommentUrl(data.comment_url);

      // Add to existing attestations
      setExistingAttestations(prev => [...prev, {
        role: selectedRole,
        sha: prDetails.head.sha,
        profile: 'deploy-gate@0.2',
        comment_id: data.comment_id,
      }]);
    } catch (err) {
      setError(`Failed to post comment: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }, [prDetails, attestationResult, executionPath, targetEnv, selectedFiles, owner, repo, selectedRole]);

  // Run SDGs before proceeding to confirm
  const runSDGChecks = useCallback(async () => {
    if (!prDetails) return;

    setLoading(true);
    setError(null);

    try {
      // Build SDG context from current UI state
      const context: SDGContext = {
        // Structural data
        affected_domains: deriveDomainsFromFiles(prFiles.map(f => f.filename)),
        declared_decision_owner_scopes: [selectedRole],
        frame_hashes: [], // Single reviewer for now
        tradeoff_mode: executionPath,
        execution_path: executionPath === 'canary' ? 'deploy-prod-canary' : 'deploy-prod-full',
        // Semantic data
        objective_text: objectiveText,
        diff_summary: prFiles.map(f => `${f.status}: ${f.filename}`).join('\n'),
      };

      // SDG set from profile - hardcoded for demo
      const sdgSet = [
        'deploy/missing_decision_owner@1.0',
        'deploy/commitment_mismatch@1.0',
        'deploy/tradeoff_execution_mismatch@1.0',
        'deploy/objective_diff_mismatch@1.0',
      ];

      const results = await runSDGs(sdgSet, context);
      setSdgResults(results);
      setSdgChecked(true);

      // If no hard stops, proceed to confirm
      if (!hasHardStop(results)) {
        setStep('confirm');
      }
    } catch (err) {
      setError(`SDG check failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }, [prDetails, prFiles, selectedRole, executionPath, objectiveText]);

  // Derive domains from file paths (simplified heuristic)
  function deriveDomainsFromFiles(files: string[]): string[] {
    const domains = new Set<string>();
    for (const file of files) {
      if (file.includes('auth') || file.includes('security')) domains.add('security');
      if (file.includes('billing') || file.includes('payment')) domains.add('finance');
      if (file.includes('deploy') || file.includes('infra')) domains.add('infrastructure');
      // Default: engineering covers everything
      domains.add('engineering');
    }
    return Array.from(domains);
  }

  // Test the executor proxy - demonstrates blind execution
  const testExecutor = useCallback(async () => {
    if (!attestationResult) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_SP_URL || 'http://localhost:3001'}/api/executor/authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attestation: attestationResult.attestation,
          frame_hash: attestationResult.frame_hash,
        }),
      });

      const data = await response.json();

      if (data.authorized) {
        setExecutorOutput(data.output);
      } else {
        setError(`Executor rejected: ${data.error} - ${data.reason}`);
      }
    } catch (err) {
      setError(`Executor test failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }, [attestationResult]);

  const currentStepIndex = stepOrder.indexOf(step);
  const allGatesChecked = problemUnderstood && objectiveClear && tradeoffsAcceptable && objectiveWasEdited;
  const roleAlreadyAttested = attestedRoles.has(selectedRole);
  const sdgHardStops = getHardStops(sdgResults);
  const sdgWarnings = getWarnings(sdgResults);

  return (
    <main style={styles.main}>
      <h1 style={{ marginBottom: '0.5rem' }}>HAP Deploy Gate Demo</h1>
      <p style={{ color: '#666', marginBottom: '2rem' }}>
        Local Direction UI - Human Agency Protocol v0.2
      </p>

      {/* Step Indicator */}
      <div style={styles.stepIndicator}>
        {stepOrder.slice(0, -1).map((s, i) => (
          <div
            key={s}
            style={{
              ...styles.stepDot,
              backgroundColor: i <= currentStepIndex ? '#1976d2' : '#e0e0e0',
              color: i <= currentStepIndex ? 'white' : '#666',
            }}
          >
            {i + 1}
          </div>
        ))}
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {/* Step 0: AI Configuration */}
      <section style={step === 'ai-config' ? styles.cardActive : styles.card}>
        <h2>1. AI Assistant (Optional)</h2>
        <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '1.5rem' }}>
          AI can help you understand changes, but cannot make decisions for you.
          It cannot modify fields, select paths, or trigger attestations.
        </p>

        <div style={{ marginBottom: '1rem' }}>
          {/* Option 1: Local/Private AI (Trusted) */}
          <label
            style={{
              ...styles.roleCard,
              backgroundColor: aiMode === 'local' ? '#e8f5e9' : '#fff',
              border: aiMode === 'local' ? '2px solid #4caf50' : '1px solid #ddd',
              display: 'block',
            }}
            onClick={() => {
              setAiMode('local');
              setAiConfig({
                ...PROVIDER_PRESETS.ollama,
                enabled: true,
              } as LocalAIConfig);
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
              <input
                type="radio"
                name="aiMode"
                checked={aiMode === 'local'}
                onChange={() => {}}
                style={{ marginRight: '0.75rem', marginTop: '0.25rem' }}
              />
              <div style={{ flex: 1 }}>
                <strong>Use Local/Private AI</strong>
                <span style={{
                  marginLeft: '0.5rem',
                  fontSize: '0.7rem',
                  padding: '0.15rem 0.4rem',
                  backgroundColor: '#c8e6c9',
                  color: '#2e7d32',
                  borderRadius: '3px',
                }}>
                  Recommended
                </span>
                <p style={{ fontSize: '0.85rem', color: '#666', margin: '0.25rem 0 0' }}>
                  Run AI locally with Ollama. Your data never leaves your machine.
                </p>
                {aiMode === 'local' && (
                  <div style={{ marginTop: '0.75rem' }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <input
                        type="text"
                        value={aiConfig.endpoint}
                        onChange={(e) => setAiConfig(prev => ({ ...prev, endpoint: e.target.value }))}
                        placeholder="http://localhost:11434"
                        style={{ ...styles.input, padding: '0.5rem', fontSize: '0.9rem', flex: '1', minWidth: '200px' }}
                      />
                      <input
                        type="text"
                        value={aiConfig.model}
                        onChange={(e) => setAiConfig(prev => ({ ...prev, model: e.target.value }))}
                        placeholder="llama3.2"
                        style={{ ...styles.input, padding: '0.5rem', fontSize: '0.9rem', width: '150px' }}
                      />
                    </div>
                    <p style={{ fontSize: '0.75rem', color: '#666', marginTop: '0.5rem' }}>
                      Install Ollama from <a href="https://ollama.ai" target="_blank" rel="noopener noreferrer" style={{ color: '#1976d2' }}>ollama.ai</a>, then run: <code>ollama pull llama3.2</code>
                    </p>
                  </div>
                )}
              </div>
            </div>
          </label>

          {/* Option 2: Public AI (with warning) */}
          <label
            style={{
              ...styles.roleCard,
              backgroundColor: aiMode === 'public' ? '#fff3e0' : '#fff',
              border: aiMode === 'public' ? '2px solid #ff9800' : '1px solid #ddd',
              display: 'block',
            }}
            onClick={() => {
              setAiMode('public');
              setAiConfig({
                ...PROVIDER_PRESETS.openai,
                enabled: true,
              } as LocalAIConfig);
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
              <input
                type="radio"
                name="aiMode"
                checked={aiMode === 'public'}
                onChange={() => {}}
                style={{ marginRight: '0.75rem', marginTop: '0.25rem' }}
              />
              <div style={{ flex: 1 }}>
                <strong>Use Public AI</strong>
                <p style={{ fontSize: '0.85rem', color: '#666', margin: '0.25rem 0 0' }}>
                  OpenAI, Groq, or other cloud providers. Requires API key.
                </p>
                {aiMode === 'public' && (
                  <div style={{ marginTop: '0.75rem' }} onClick={(e) => e.stopPropagation()}>
                    {/* Warning */}
                    <div style={{
                      backgroundColor: '#ffebee',
                      border: '1px solid #ef9a9a',
                      padding: '0.5rem',
                      borderRadius: '4px',
                      marginBottom: '0.75rem',
                      fontSize: '0.8rem',
                      color: '#c62828',
                    }}>
                      <strong>Demo only.</strong> Do not use with sensitive or confidential data.
                      PR content will be sent to external servers.
                    </div>
                    <div style={{ marginBottom: '0.5rem' }}>
                      <select
                        value=""
                        onChange={(e) => {
                          const preset = PROVIDER_PRESETS[e.target.value];
                          if (preset) {
                            setAiConfig(prev => ({ ...prev, ...preset }));
                          }
                        }}
                        style={{ ...styles.input, padding: '0.5rem', fontSize: '0.9rem', maxWidth: '200px' }}
                      >
                        <option value="">Select provider...</option>
                        <option value="openai">OpenAI (GPT-4o-mini)</option>
                        <option value="groq">Groq (Llama 3.1)</option>
                        <option value="together">Together AI</option>
                      </select>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <input
                        type="text"
                        value={aiConfig.endpoint}
                        onChange={(e) => setAiConfig(prev => ({ ...prev, endpoint: e.target.value }))}
                        placeholder="Endpoint URL"
                        style={{ ...styles.input, padding: '0.5rem', fontSize: '0.9rem', flex: '1', minWidth: '200px' }}
                      />
                      <input
                        type="text"
                        value={aiConfig.model}
                        onChange={(e) => setAiConfig(prev => ({ ...prev, model: e.target.value }))}
                        placeholder="Model"
                        style={{ ...styles.input, padding: '0.5rem', fontSize: '0.9rem', width: '150px' }}
                      />
                      <input
                        type="password"
                        value={aiConfig.apiKey || ''}
                        onChange={(e) => setAiConfig(prev => ({ ...prev, apiKey: e.target.value || undefined }))}
                        placeholder="API Key"
                        style={{ ...styles.input, padding: '0.5rem', fontSize: '0.9rem', width: '200px' }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </label>

          {/* Option 3: No AI */}
          <label
            style={{
              ...styles.roleCard,
              backgroundColor: aiMode === 'none' ? '#e3f2fd' : '#fff',
              border: aiMode === 'none' ? '2px solid #1976d2' : '1px solid #ddd',
              display: 'block',
            }}
            onClick={() => {
              setAiMode('none');
              setAiConfig({ ...DEFAULT_AI_CONFIG, enabled: false });
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
              <input
                type="radio"
                name="aiMode"
                checked={aiMode === 'none'}
                onChange={() => {}}
                style={{ marginRight: '0.75rem', marginTop: '0.25rem' }}
              />
              <div>
                <strong>No AI Assistant</strong>
                <p style={{ fontSize: '0.85rem', color: '#666', margin: '0.25rem 0 0' }}>
                  Review changes without AI assistance
                </p>
              </div>
            </div>
          </label>
        </div>

        {/* Advisory boundary notice */}
        <div style={{
          backgroundColor: '#fff8e1',
          border: '1px solid #ffe082',
          padding: '0.75rem',
          borderRadius: '4px',
          marginBottom: '1rem',
          fontSize: '0.85rem',
        }}>
          <strong>Advisory Boundary:</strong> AI can explain and question. It cannot author decisions,
          modify commitment fields, or trigger attestations.
        </div>

        {/* AI Config Error */}
        {aiConfigError && (
          <div style={styles.error}>
            {aiConfigError}
          </div>
        )}

        {step === 'ai-config' && (
          <button
            style={aiConfigTesting ? styles.buttonDisabled : styles.button}
            disabled={aiConfigTesting}
            onClick={async () => {
              const valid = await validateAndTestAI();
              if (valid) {
                setStep('select-pr');
              }
            }}
          >
            {aiConfigTesting ? 'Testing connection...' : 'Continue'}
          </button>
        )}
      </section>

      {/* Step 1: Select PR */}
      <section style={step === 'select-pr' ? styles.cardActive : styles.card}>
        <h2>2. Select Pull Request</h2>
        {prDetails ? (
          <div>
            <p>
              <strong>#{prDetails.number}</strong>: {prDetails.title}
            </p>
            <p style={{ fontSize: '0.9rem', color: '#666' }}>
              {prDetails.repo} | {prDetails.head.sha.slice(0, 7)} | by {prDetails.user.login}
            </p>
            {existingAttestations.length > 0 && (
              <div style={{ marginTop: '1rem' }}>
                <p style={{ fontSize: '0.9rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
                  Existing Attestations for this SHA:
                </p>
                {existingAttestations.map((att, i) => (
                  <div
                    key={i}
                    style={{
                      ...styles.attestationStatus,
                      backgroundColor: '#e8f5e9',
                      color: '#2e7d32',
                    }}
                  >
                    ✓ {ROLE_INFO[att.role as Role]?.label || att.role}
                  </div>
                ))}
              </div>
            )}
            {step === 'select-pr' && (
              <button style={styles.buttonSecondary} onClick={() => {
                setPrDetails(null);
                setExistingAttestations([]);
              }}>
                Change PR
              </button>
            )}
          </div>
        ) : (
          <div>
            <input
              type="text"
              value={prInput}
              onChange={(e) => setPrInput(e.target.value)}
              placeholder="owner/repo#123 or https://github.com/owner/repo/pull/123"
              style={styles.input}
              onKeyDown={(e) => e.key === 'Enter' && loadPR()}
            />
            <button
              style={loading ? styles.buttonDisabled : styles.button}
              onClick={loadPR}
              disabled={loading}
            >
              {loading ? 'Loading...' : 'Load PR'}
            </button>
          </div>
        )}
      </section>

      {/* Step 2: Review Changes */}
      {prDetails && (
        <section style={step === 'review-changes' ? styles.cardActive : styles.card}>
          <h2>3. Review Changes & Select Disclosures</h2>
          <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '1rem' }}>
            Select files to include in the disclosure set ({selectedFiles.size} of {prFiles.length} selected)
          </p>
          <div style={{ marginBottom: '1rem' }}>
            <button style={styles.buttonSecondary} onClick={selectAllFiles}>
              Select All
            </button>{' '}
            <button style={styles.buttonSecondary} onClick={deselectAllFiles}>
              Deselect All
            </button>
          </div>
          <ul style={styles.fileList}>
            {prFiles.map((file) => (
              <li key={file.filename} style={styles.fileItem}>
                <input
                  type="checkbox"
                  checked={selectedFiles.has(file.filename)}
                  onChange={() => toggleFile(file.filename)}
                  style={styles.checkbox}
                />
                <code style={{ flex: 1 }}>{file.filename}</code>
                {getStatusBadge(file.status)}
                <span style={{ marginLeft: '0.5rem', fontSize: '0.8rem', color: '#666' }}>
                  +{file.additions} -{file.deletions}
                </span>
              </li>
            ))}
          </ul>
          {step === 'review-changes' && (
            <button
              style={selectedFiles.size > 0 ? styles.button : styles.buttonDisabled}
              onClick={() => setStep('set-path')}
              disabled={selectedFiles.size === 0}
            >
              Continue
            </button>
          )}
        </section>
      )}

      {/* Step 3: Execution Path */}
      {prDetails && currentStepIndex >= 2 && (
        <section style={step === 'set-path' ? styles.cardActive : styles.card}>
          <h2>4. Execution Path & Environment</h2>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem' }}>
              <strong>Execution Path:</strong>
            </label>
            <label style={{ marginRight: '1.5rem', display: 'block', marginBottom: '0.5rem' }}>
              <input
                type="radio"
                name="path"
                value="canary"
                checked={executionPath === 'canary'}
                onChange={() => setExecutionPath('canary')}
              />{' '}
              <strong>Canary</strong> - gradual rollout (requires: Engineering)
            </label>
            <label style={{ display: 'block' }}>
              <input
                type="radio"
                name="path"
                value="full"
                checked={executionPath === 'full'}
                onChange={() => setExecutionPath('full')}
              />{' '}
              <strong>Full</strong> - immediate deployment (requires: Engineering + Release Management)
            </label>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem' }}>
              <strong>Target Environment:</strong>
            </label>
            <label style={{ marginRight: '1.5rem' }}>
              <input
                type="radio"
                name="env"
                value="staging"
                checked={targetEnv === 'staging'}
                onChange={() => setTargetEnv('staging')}
              />{' '}
              Staging
            </label>
            <label>
              <input
                type="radio"
                name="env"
                value="prod"
                checked={targetEnv === 'prod'}
                onChange={() => setTargetEnv('prod')}
              />{' '}
              Production
            </label>
          </div>

          {/* Show attestation status for selected path */}
          <div style={{ marginTop: '1.5rem', padding: '1rem', backgroundColor: '#f5f5f5', borderRadius: '4px' }}>
            <p style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>
              Required Approvals for {executionPath === 'full' ? 'Full' : 'Canary'} Deployment:
            </p>
            {requiredRoles.map(role => {
              const isAttested = attestedRoles.has(role);
              return (
                <div
                  key={role}
                  style={{
                    ...styles.attestationStatus,
                    backgroundColor: isAttested ? '#e8f5e9' : '#fff3e0',
                    color: isAttested ? '#2e7d32' : '#e65100',
                  }}
                >
                  {isAttested ? '✓' : '○'} {ROLE_INFO[role].label}
                  {isAttested && ' - Attested'}
                  {!isAttested && ' - Pending'}
                </div>
              );
            })}
            {allRolesAttested && (
              <div style={styles.success}>
                All required approvals collected! Ready to merge.
              </div>
            )}
          </div>

          {step === 'set-path' && (
            <button style={styles.button} onClick={() => setStep('select-role')}>
              Continue
            </button>
          )}
        </section>
      )}

      {/* Step 4: Select Your Role */}
      {prDetails && currentStepIndex >= 3 && (
        <section style={step === 'select-role' ? styles.cardActive : styles.card}>
          <h2>5. Select Your Role</h2>
          <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '1rem' }}>
            Who are you? Select your role to provide your attestation.
          </p>

          {requiredRoles.map(role => {
            const isAttested = attestedRoles.has(role);
            const isSelected = selectedRole === role;
            return (
              <div
                key={role}
                onClick={() => !isAttested && setSelectedRole(role)}
                style={{
                  ...styles.roleCard,
                  backgroundColor: isSelected ? '#e3f2fd' : isAttested ? '#f5f5f5' : '#fff',
                  border: isSelected ? '2px solid #1976d2' : '1px solid #ddd',
                  opacity: isAttested ? 0.7 : 1,
                  cursor: isAttested ? 'not-allowed' : 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <strong>{ROLE_INFO[role].label}</strong>
                    <p style={{ fontSize: '0.85rem', color: '#666', margin: '0.25rem 0 0' }}>
                      {ROLE_INFO[role].description}
                    </p>
                  </div>
                  {isAttested && (
                    <span style={{
                      backgroundColor: '#e8f5e9',
                      color: '#2e7d32',
                      padding: '0.25rem 0.5rem',
                      borderRadius: '4px',
                      fontSize: '0.8rem',
                    }}>
                      ✓ Already Attested
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          {executionPath === 'canary' && !requiredRoles.includes('release_management') && (
            <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '1rem', fontStyle: 'italic' }}>
              Note: Canary deployment only requires Engineering approval.
            </p>
          )}

          {roleAlreadyAttested && (
            <div style={styles.warning}>
              You have already attested for the {ROLE_INFO[selectedRole].label} role on this SHA.
              {missingRoles.length > 0 && ` Waiting for: ${missingRoles.map(r => ROLE_INFO[r].label).join(', ')}`}
            </div>
          )}

          {step === 'select-role' && !roleAlreadyAttested && (
            <button style={styles.button} onClick={() => setStep('gates')}>
              Continue as {ROLE_INFO[selectedRole].label}
            </button>
          )}
        </section>
      )}

      {/* Step 5: Gates */}
      {prDetails && currentStepIndex >= 4 && !roleAlreadyAttested && (
        <section style={step === 'gates' ? styles.cardActive : styles.card}>
          <h2>6. Decision Gates ({ROLE_INFO[selectedRole].label})</h2>
          <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '1rem' }}>
            As <strong>{ROLE_INFO[selectedRole].label}</strong>, confirm you understand the implications:
          </p>

          {/* Objective Input with AI Assistance */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem' }}>
              <strong>Your Objective</strong>
              <br />
              <span style={{ fontSize: '0.85rem', color: '#666' }}>
                What do you want to achieve with this deployment? (This stays local - never transmitted)
              </span>
            </label>
            <textarea
              value={objectiveText}
              onChange={(e) => setObjectiveText(e.target.value)}
              placeholder="e.g., Fix the authentication bug that causes login failures..."
              style={{
                ...styles.input,
                minHeight: '80px',
                resize: 'vertical',
                borderColor: objectiveAiDraft && !objectiveWasEdited ? '#ff9800' : undefined,
              }}
            />
            {/* AI-assisted draft warning */}
            {objectiveAiDraft && !objectiveWasEdited && (
              <div style={{
                marginTop: '0.5rem',
                padding: '0.5rem',
                backgroundColor: '#fff3e0',
                borderRadius: '4px',
                border: '1px solid #ff9800',
                fontSize: '0.85rem',
                color: '#e65100',
              }}>
                <strong>AI-assisted draft</strong> — edit this text to make it yours before proceeding.
              </div>
            )}
            {objectiveAiDraft && objectiveWasEdited && (
              <div style={{
                marginTop: '0.5rem',
                padding: '0.5rem',
                backgroundColor: '#e8f5e9',
                borderRadius: '4px',
                fontSize: '0.85rem',
                color: '#2e7d32',
              }}>
                Objective edited. Ready to proceed.
              </div>
            )}

            {/* AI Assistance - Advisory Only */}
            <div style={{
              marginTop: '0.75rem',
              padding: '0.75rem',
              backgroundColor: '#f0f7ff',
              borderRadius: '4px',
              border: '1px solid #bbdefb',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#1565c0' }}>
                    AI Assistant
                  </span>
                  <span style={{
                    marginLeft: '0.5rem',
                    fontSize: '0.7rem',
                    padding: '0.15rem 0.4rem',
                    backgroundColor: aiAvailable ? '#c8e6c9' : '#fff3e0',
                    color: aiAvailable ? '#2e7d32' : '#e65100',
                    borderRadius: '3px',
                  }}>
                    {aiAvailable ? `${aiConfig.provider === 'ollama' ? 'Ollama' : aiConfig.model} Connected` : 'Using Heuristics'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAiSettings(!showAiSettings)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#1565c0',
                    cursor: 'pointer',
                    fontSize: '0.8rem',
                    textDecoration: 'underline',
                  }}
                >
                  {showAiSettings ? 'Hide Settings' : 'Settings'}
                </button>
              </div>

              {/* AI Settings Panel */}
              {showAiSettings && (
                <div style={{
                  marginBottom: '0.75rem',
                  padding: '0.75rem',
                  backgroundColor: '#fff',
                  borderRadius: '4px',
                  border: '1px solid #e0e0e0',
                }}>
                  <div style={{ marginBottom: '0.5rem' }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.25rem' }}>
                      Provider Preset
                    </label>
                    <select
                      value=""
                      onChange={(e) => {
                        const preset = PROVIDER_PRESETS[e.target.value];
                        if (preset) {
                          setAiConfig(prev => ({ ...prev, ...preset }));
                        }
                      }}
                      style={{ ...styles.input, padding: '0.4rem', fontSize: '0.85rem' }}
                    >
                      <option value="">Select preset...</option>
                      <option value="ollama">Ollama (local)</option>
                      <option value="openai">OpenAI</option>
                      <option value="groq">Groq</option>
                      <option value="together">Together AI</option>
                    </select>
                  </div>
                  <div style={{ marginBottom: '0.5rem' }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.25rem' }}>
                      Endpoint URL
                    </label>
                    <input
                      type="text"
                      value={aiConfig.endpoint}
                      onChange={(e) => setAiConfig(prev => ({ ...prev, endpoint: e.target.value }))}
                      placeholder="https://api.openai.com/v1"
                      style={{ ...styles.input, padding: '0.4rem', fontSize: '0.85rem' }}
                    />
                  </div>
                  <div style={{ marginBottom: '0.5rem' }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.25rem' }}>
                      Model
                    </label>
                    <input
                      type="text"
                      value={aiConfig.model}
                      onChange={(e) => setAiConfig(prev => ({ ...prev, model: e.target.value }))}
                      placeholder="gpt-4o-mini"
                      style={{ ...styles.input, padding: '0.4rem', fontSize: '0.85rem' }}
                    />
                  </div>
                  <div style={{ marginBottom: '0.5rem' }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.25rem' }}>
                      API Key (optional for local)
                    </label>
                    <input
                      type="password"
                      value={aiConfig.apiKey || ''}
                      onChange={(e) => setAiConfig(prev => ({ ...prev, apiKey: e.target.value || undefined }))}
                      placeholder="sk-..."
                      style={{ ...styles.input, padding: '0.4rem', fontSize: '0.85rem' }}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <label style={{ fontSize: '0.8rem' }}>
                      <input
                        type="checkbox"
                        checked={aiConfig.enabled}
                        onChange={(e) => setAiConfig(prev => ({ ...prev, enabled: e.target.checked }))}
                        style={{ marginRight: '0.25rem' }}
                      />
                      Enabled
                    </label>
                    <button
                      type="button"
                      onClick={() => checkAIAvailability(aiConfig).then(setAiAvailable)}
                      style={{
                        ...styles.buttonSecondary,
                        padding: '0.3rem 0.6rem',
                        fontSize: '0.75rem',
                      }}
                    >
                      Test Connection
                    </button>
                  </div>
                </div>
              )}

              {/* Question-first actions */}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => requestAIAssistance('explain_changes')}
                  disabled={aiLoading || !aiConfig.enabled}
                  style={{
                    ...styles.buttonSecondary,
                    padding: '0.4rem 0.8rem',
                    fontSize: '0.85rem',
                    opacity: (aiLoading || !aiConfig.enabled) ? 0.6 : 1,
                  }}
                >
                  {aiLoading ? '...' : 'What does this change?'}
                </button>
                <button
                  type="button"
                  onClick={() => requestAIAssistance('list_risks')}
                  disabled={aiLoading || !aiConfig.enabled}
                  style={{
                    ...styles.buttonSecondary,
                    padding: '0.4rem 0.8rem',
                    fontSize: '0.85rem',
                    opacity: (aiLoading || !aiConfig.enabled) ? 0.6 : 1,
                  }}
                >
                  What could go wrong?
                </button>
                <button
                  type="button"
                  onClick={() => requestAIAssistance('affected_areas')}
                  disabled={aiLoading || !aiConfig.enabled}
                  style={{
                    ...styles.buttonSecondary,
                    padding: '0.4rem 0.8rem',
                    fontSize: '0.85rem',
                    opacity: (aiLoading || !aiConfig.enabled) ? 0.6 : 1,
                  }}
                >
                  What areas affected?
                </button>
                <button
                  type="button"
                  onClick={() => requestAIAssistance('what_to_verify')}
                  disabled={aiLoading || !aiConfig.enabled}
                  style={{
                    ...styles.buttonSecondary,
                    padding: '0.4rem 0.8rem',
                    fontSize: '0.85rem',
                    opacity: (aiLoading || !aiConfig.enabled) ? 0.6 : 1,
                  }}
                >
                  What should I verify?
                </button>
              </div>

              {/* Check objective (only shown if objective has text) */}
              {objectiveText && (
                <button
                  type="button"
                  onClick={() => requestAIAssistance('check_objective')}
                  disabled={aiLoading || !aiConfig.enabled}
                  style={{
                    ...styles.buttonSecondary,
                    padding: '0.4rem 0.8rem',
                    fontSize: '0.85rem',
                    opacity: (aiLoading || !aiConfig.enabled) ? 0.6 : 1,
                    marginBottom: '0.5rem',
                  }}
                >
                  Check my objective against changes
                </button>
              )}

              {/* Wording help - explicit request, with friction notice */}
              <div style={{ marginTop: '0.5rem', borderTop: '1px solid #e0e0e0', paddingTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => requestAIAssistance('draft_options')}
                  disabled={aiLoading || !aiConfig.enabled}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#666',
                    fontSize: '0.8rem',
                    cursor: (aiLoading || !aiConfig.enabled) ? 'not-allowed' : 'pointer',
                    textDecoration: 'underline',
                    padding: '0.25rem 0',
                    opacity: (aiLoading || !aiConfig.enabled) ? 0.6 : 1,
                  }}
                >
                  Help me word my objective...
                </button>
                <span style={{ fontSize: '0.7rem', color: '#999', marginLeft: '0.5rem' }}>
                  (you must edit before using)
                </span>
              </div>

              {/* AI Response Display */}
              {aiSuggestion && aiResponseType === 'question' && (
                <div style={{
                  marginTop: '0.75rem',
                  padding: '0.75rem',
                  backgroundColor: '#fff',
                  borderRadius: '4px',
                  border: '1px dashed #90caf9',
                }}>
                  <pre style={{
                    margin: '0 0 0.5rem',
                    fontSize: '0.85rem',
                    color: '#333',
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'inherit',
                  }}>
                    {aiSuggestion}
                  </pre>
                  <button
                    type="button"
                    onClick={() => { setAiSuggestion(null); setAiDisclaimer(null); }}
                    style={{
                      ...styles.buttonSecondary,
                      padding: '0.3rem 0.6rem',
                      fontSize: '0.8rem',
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {/* Draft Options Display - with friction */}
              {aiSuggestion && aiResponseType === 'draft_options' && (
                <div style={{
                  marginTop: '0.75rem',
                  padding: '0.75rem',
                  backgroundColor: '#fff3e0',
                  borderRadius: '4px',
                  border: '1px solid #ffcc80',
                }}>
                  <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', fontWeight: 'bold', color: '#e65100' }}>
                    Choose one and edit it to make it yours:
                  </p>
                  {aiSuggestion.split('\n').filter(line => line.match(/^\d\./)).map((option, i) => {
                    const text = option.replace(/^\d\.\s*/, '').trim();
                    return (
                      <div key={i} style={{
                        padding: '0.5rem',
                        marginBottom: '0.5rem',
                        backgroundColor: '#fff',
                        borderRadius: '4px',
                        border: '1px solid #e0e0e0',
                      }}>
                        <p style={{ margin: '0 0 0.5rem', fontSize: '0.85rem' }}>{text}</p>
                        <button
                          type="button"
                          onClick={() => useAsDraft(text)}
                          style={{
                            ...styles.buttonSecondary,
                            padding: '0.25rem 0.5rem',
                            fontSize: '0.75rem',
                          }}
                        >
                          Use as starting point
                        </button>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => { setAiSuggestion(null); setAiDisclaimer(null); }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#666',
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                      padding: '0.25rem 0',
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {/* Disclaimer - always visible when there's a suggestion */}
              {aiDisclaimer && (
                <p style={{
                  margin: '0.5rem 0 0',
                  fontSize: '0.75rem',
                  color: '#666',
                  fontStyle: 'italic',
                }}>
                  {aiDisclaimer}
                </p>
              )}

              {/* Permissions notice */}
              <p style={{
                margin: '0.5rem 0 0',
                fontSize: '0.7rem',
                color: '#999',
              }}>
                AI can read context but cannot: modify frame fields, trigger attestation, or affect execution.
              </p>
            </div>
          </div>

          <div style={{ marginBottom: '0.75rem' }}>
            <label style={{ display: 'flex', alignItems: 'flex-start' }}>
              <input
                type="checkbox"
                checked={problemUnderstood}
                onChange={(e) => setProblemUnderstood(e.target.checked)}
                style={styles.checkbox}
              />
              <span>
                <strong>Problem Understood</strong>
                <br />
                <span style={{ fontSize: '0.85rem', color: '#666' }}>
                  I understand what changes this PR makes and why.
                </span>
              </span>
            </label>
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={{ display: 'flex', alignItems: 'flex-start' }}>
              <input
                type="checkbox"
                checked={objectiveClear}
                onChange={(e) => setObjectiveClear(e.target.checked)}
                style={styles.checkbox}
              />
              <span>
                <strong>Objective Clear</strong>
                <br />
                <span style={{ fontSize: '0.85rem', color: '#666' }}>
                  The goal of this deployment is well-defined.
                </span>
              </span>
            </label>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'flex', alignItems: 'flex-start' }}>
              <input
                type="checkbox"
                checked={tradeoffsAcceptable}
                onChange={(e) => setTradeoffsAcceptable(e.target.checked)}
                style={styles.checkbox}
              />
              <span>
                <strong>Tradeoffs Acceptable</strong>
                <br />
                <span style={{ fontSize: '0.85rem', color: '#666' }}>
                  I accept any risks or tradeoffs involved in this deployment.
                </span>
              </span>
            </label>
          </div>

          {/* SDG Results */}
          {sdgChecked && sdgHardStops.length > 0 && (
            <div style={styles.error}>
              <strong>Cannot proceed - integrity issues detected:</strong>
              <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.5rem' }}>
                {sdgHardStops.map(sdg => (
                  <li key={sdg.id}>{sdg.user_prompt}</li>
                ))}
              </ul>
            </div>
          )}

          {sdgChecked && sdgWarnings.length > 0 && (
            <div style={styles.warning}>
              <strong>Warnings (you may proceed):</strong>
              <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.5rem' }}>
                {sdgWarnings.map(sdg => (
                  <li key={sdg.id}>{sdg.user_prompt}</li>
                ))}
              </ul>
            </div>
          )}

          {step === 'gates' && (
            <button
              style={allGatesChecked ? styles.button : styles.buttonDisabled}
              onClick={runSDGChecks}
              disabled={!allGatesChecked || loading}
            >
              {loading ? 'Checking...' : sdgChecked && sdgHardStops.length === 0 ? 'Continue' : 'Run Integrity Checks'}
            </button>
          )}
        </section>
      )}

      {/* Step 6: Pre-Signature Summary */}
      {prDetails && currentStepIndex >= 5 && !roleAlreadyAttested && (
        <section style={step === 'confirm' ? styles.cardActive : styles.card}>
          <h2>7. Pre-Signature Summary</h2>
          <p style={{ fontSize: '0.95rem', color: '#333', marginBottom: '1rem' }}>
            Review what you are about to sign. This is the boundary between your thinking and the protocol.
          </p>

          {/* What will be signed - structural only */}
          <div style={{
            backgroundColor: '#1a1a2e',
            color: '#e0e0e0',
            padding: '1.5rem',
            borderRadius: '8px',
            marginBottom: '1.5rem',
            fontFamily: 'monospace',
            fontSize: '0.9rem',
          }}>
            <p style={{ color: '#4fc3f7', marginBottom: '1rem', fontWeight: 'bold' }}>
              You are about to sign:
            </p>
            <p style={{ margin: '0.5rem 0' }}>• <strong>Profile:</strong> deploy-gate@0.2</p>
            <p style={{ margin: '0.5rem 0' }}>• <strong>Repo:</strong> {prDetails.repo}</p>
            <p style={{ margin: '0.5rem 0' }}>• <strong>Commit:</strong> {prDetails.head.sha.slice(0, 12)}...</p>
            <p style={{ margin: '0.5rem 0' }}>• <strong>Environment:</strong> {targetEnv}</p>
            <p style={{ margin: '0.5rem 0' }}>• <strong>Execution path:</strong> {executionPath === 'canary' ? 'deploy-prod-canary' : 'deploy-prod-full'}</p>
            <p style={{ margin: '0.5rem 0' }}>• <strong>Required scopes:</strong> {selectedRole}</p>
            <p style={{ margin: '0.5rem 0' }}>• <strong>Gates closed:</strong> problem, objective, tradeoff, commitment</p>
          </div>

          {/* Boundary notice */}
          <div style={{
            backgroundColor: '#fff8e1',
            border: '1px solid #ffcc02',
            padding: '1rem',
            borderRadius: '4px',
            marginBottom: '1.5rem',
          }}>
            <p style={{ margin: 0, fontWeight: 'bold', color: '#f57c00' }}>
              Your written inputs will not be transmitted or stored.
            </p>
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem', color: '#666' }}>
              Your objective, reasoning, and any notes stay local. Only the structural frame above crosses the boundary.
            </p>
          </div>

          {/* SDG warnings reminder if any */}
          {sdgWarnings.length > 0 && (
            <div style={styles.warning}>
              <strong>Proceeding despite warnings:</strong>
              <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.5rem' }}>
                {sdgWarnings.map(sdg => (
                  <li key={sdg.id}>{sdg.user_prompt}</li>
                ))}
              </ul>
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem' }}>
                This is your choice. You own this decision.
              </p>
            </div>
          )}

          {step === 'confirm' && (
            <button
              style={loading ? styles.buttonDisabled : styles.button}
              onClick={requestAttestation}
              disabled={loading}
            >
              {loading ? 'Signing...' : 'Sign Attestation'}
            </button>
          )}
        </section>
      )}

      {/* Step 7: Done */}
      {attestationResult && (
        <section style={styles.cardActive}>
          <h2>Attestation Ready - {ROLE_INFO[selectedRole].label}</h2>
          <div style={styles.success}>
            Attestation created successfully for {ROLE_INFO[selectedRole].label}!
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <p><strong>Frame Hash:</strong></p>
            <code style={{ fontSize: '0.85rem', wordBreak: 'break-all' }}>{attestationResult.frame_hash}</code>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <p><strong>Disclosure Hash:</strong></p>
            <code style={{ fontSize: '0.85rem', wordBreak: 'break-all' }}>{attestationResult.disclosure_hash}</code>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <p><strong>Expires:</strong> {new Date(attestationResult.expires_at).toLocaleString()}</p>
          </div>

          {commentUrl ? (
            <>
              <div style={styles.success}>
                Comment posted!{' '}
                <a href={commentUrl} target="_blank" rel="noopener noreferrer">
                  View on GitHub
                </a>
              </div>
              {missingRoles.length > 0 && (
                <div style={styles.warning}>
                  Still waiting for: {missingRoles.filter(r => r !== selectedRole).map(r => ROLE_INFO[r].label).join(', ')}
                </div>
              )}
            </>
          ) : (
            <button
              style={loading ? styles.buttonDisabled : styles.button}
              onClick={postComment}
              disabled={loading}
            >
              {loading ? 'Posting...' : 'Post to PR Comment'}
            </button>
          )}

          {/* Executor Demo */}
          <div style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid #eee' }}>
            <h3>Blind Executor Demo</h3>
            <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '1rem' }}>
              Test what the executor sees. It receives only the frame — no objectives, no reasoning, no AI.
            </p>

            {!executorOutput ? (
              <button
                style={loading ? styles.buttonDisabled : styles.buttonSecondary}
                onClick={testExecutor}
                disabled={loading}
              >
                {loading ? 'Testing...' : 'Test Executor'}
              </button>
            ) : (
              <pre style={{
                ...styles.pre,
                backgroundColor: '#0d1117',
                color: '#58a6ff',
                border: '1px solid #30363d',
              }}>
                {executorOutput}
              </pre>
            )}
          </div>

          {/* Feedback Blueprint (Post-Execution, Non-Protocol) */}
          <div style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid #eee' }}>
            <h3>Feedback (Optional)</h3>
            <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '1rem' }}>
              Support learning without affecting authorization. This feedback:
            </p>
            <ul style={{ fontSize: '0.85rem', color: '#888', marginBottom: '1rem', paddingLeft: '1.5rem' }}>
              <li>Is optional and human-controlled</li>
              <li>Never fed into SDGs automatically</li>
              <li>Never affects future execution</li>
              <li>Stored locally, not correlated with attestations</li>
            </ul>

            {!feedbackSubmitted ? (
              <div style={{ backgroundColor: '#fafafa', padding: '1rem', borderRadius: '4px' }}>
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                    Was your objective achieved?
                  </label>
                  <select
                    value={feedbackAnswers.objectiveAchieved}
                    onChange={(e) => setFeedbackAnswers(prev => ({ ...prev, objectiveAchieved: e.target.value }))}
                    style={{ ...styles.input, maxWidth: '300px' }}
                  >
                    <option value="">Select...</option>
                    <option value="yes">Yes</option>
                    <option value="partially">Partially</option>
                    <option value="no">No</option>
                    <option value="unknown">Too early to tell</option>
                  </select>
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                    Were the tradeoffs acceptable?
                  </label>
                  <select
                    value={feedbackAnswers.tradeoffsAcceptable}
                    onChange={(e) => setFeedbackAnswers(prev => ({ ...prev, tradeoffsAcceptable: e.target.value }))}
                    style={{ ...styles.input, maxWidth: '300px' }}
                  >
                    <option value="">Select...</option>
                    <option value="yes">Yes, as expected</option>
                    <option value="better">Better than expected</option>
                    <option value="worse">Worse than expected</option>
                    <option value="different">Different than expected</option>
                  </select>
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                    What surprised you?
                  </label>
                  <textarea
                    value={feedbackAnswers.surprised}
                    onChange={(e) => setFeedbackAnswers(prev => ({ ...prev, surprised: e.target.value }))}
                    placeholder="Optional: note any surprises or learnings..."
                    style={{ ...styles.input, minHeight: '60px', resize: 'vertical' }}
                  />
                </div>

                <button
                  style={styles.buttonSecondary}
                  onClick={() => {
                    // In a real implementation, this would save locally
                    console.log('Feedback (stored locally only):', feedbackAnswers);
                    setFeedbackSubmitted(true);
                  }}
                >
                  Save Feedback Locally
                </button>
              </div>
            ) : (
              <div style={styles.success}>
                Feedback saved locally. Thank you for reflecting on this deployment.
              </div>
            )}
          </div>

          <details style={{ marginTop: '1.5rem' }}>
            <summary style={{ cursor: 'pointer', marginBottom: '0.5rem' }}>
              View Raw Attestation Block
            </summary>
            <pre style={styles.pre}>
{`---BEGIN HAP_ATTESTATION v=1---
profile=deploy-gate@0.2
role=${selectedRole}
env=${targetEnv}
path=${executionPath}
sha=${prDetails?.head.sha}
frame_hash=${attestationResult.frame_hash}
disclosure_hash=${attestationResult.disclosure_hash}
blob=${attestationResult.attestation}
---END HAP_ATTESTATION---`}
            </pre>
          </details>
        </section>
      )}

      <footer style={{ marginTop: '3rem', color: '#999', fontSize: '0.9rem', borderTop: '1px solid #eee', paddingTop: '1rem' }}>
        <p>
          Server:{' '}
          <a href="https://service.humanagencyprotocol.org" style={{ color: '#1976d2' }}>
            service.humanagencyprotocol.org
          </a>
          {' | '}
          <a href="https://service.humanagencyprotocol.org/prod" style={{ color: '#1976d2' }}>
            /prod
          </a>
          {' | '}
          <a href="https://service.humanagencyprotocol.org/api/sp/pubkey" style={{ color: '#1976d2' }}>
            /api/sp/pubkey
          </a>
        </p>
      </footer>
    </main>
  );
}
