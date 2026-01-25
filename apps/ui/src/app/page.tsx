'use client';

import { useState, useCallback, useEffect } from 'react';
import { parsePRInput, fetchPRDetails, fetchPRFiles, PRDetails, PRFile } from '../lib/github';
import {
  LocalAIConfig,
  DEFAULT_AI_CONFIG,
  PROVIDER_PRESETS,
  checkAIAvailability,
  getAIAssistance,
  getFallbackAssistance,
  AIAssistanceRequest,
} from '../local-ai/client';

/**
 * HAP Deploy Demo - UI
 *
 * Gate order (HAP v0.2):
 * 1. Frame - repo, sha, env, execution path, disclosures
 * 2. Decision Owner - role + scope (who is responsible)
 * 3. Problem - human articulation of the problem
 * 4. Objective - human articulation of the objective
 * 5. Tradeoffs - risk acceptance by THIS role under THIS path
 * 6. Commitment - explicit authorization (signing)
 *
 * Invariant: Tradeoffs are accepted by a role, not by a change.
 * Therefore, role selection must precede tradeoff articulation.
 */

type Gate = 'frame' | 'decision-owner' | 'problem' | 'objective' | 'tradeoffs' | 'commitment' | 'done';
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

const GATES: { id: Gate; label: string }[] = [
  { id: 'frame', label: 'Frame' },
  { id: 'decision-owner', label: 'Decision Owner' },
  { id: 'problem', label: 'Problem' },
  { id: 'objective', label: 'Objective' },
  { id: 'tradeoffs', label: 'Tradeoffs' },
  { id: 'commitment', label: 'Commitment' },
];

const gateOrder: Gate[] = ['frame', 'decision-owner', 'problem', 'objective', 'tradeoffs', 'commitment', 'done'];

function getStatusBadge(status: string) {
  const colors: Record<string, { bg: string; text: string }> = {
    added: { bg: '#e8f5e9', text: '#2e7d32' },
    removed: { bg: '#ffebee', text: '#c62828' },
    modified: { bg: '#fff3e0', text: '#e65100' },
    renamed: { bg: '#e3f2fd', text: '#1565c0' },
  };
  const color = colors[status] || { bg: '#f5f5f5', text: '#616161' };
  return (
    <span style={{ display: 'inline-block', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', marginLeft: '0.5rem', backgroundColor: color.bg, color: color.text }}>
      {status}
    </span>
  );
}

function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

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
  // Navigation state
  const [currentGate, setCurrentGate] = useState<Gate>('frame');
  const [expandedGate, setExpandedGate] = useState<Gate | 'ai-setup' | null>('ai-setup');

  const [prInput, setPrInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // PR data
  const [prDetails, setPrDetails] = useState<PRDetails | null>(null);
  const [prFiles, setPrFiles] = useState<PRFile[]>([]);

  // Existing attestations
  const [existingAttestations, setExistingAttestations] = useState<ExistingAttestation[]>([]);

  // Gate 1: Frame (saved values)
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [executionPath, setExecutionPath] = useState<'canary' | 'full'>('canary');
  const [targetEnv] = useState<'staging' | 'prod'>('prod');

  // Draft values for editing completed Frame gate
  const [selectedFilesDraft, setSelectedFilesDraft] = useState<Set<string>>(new Set());
  const [executionPathDraft, setExecutionPathDraft] = useState<'canary' | 'full'>('canary');

  // Gate 2: Decision Owner
  const [selectedRole, setSelectedRole] = useState<Role>('engineering');
  const [roleLocked, setRoleLocked] = useState(false);

  // Gates 3-5: Articulation (saved values)
  const [problemText, setProblemText] = useState('');
  const [objectiveText, setObjectiveText] = useState('');
  const [tradeoffsText, setTradeoffsText] = useState('');

  // Draft values for editing completed gates
  const [problemDraft, setProblemDraft] = useState('');
  const [objectiveDraft, setObjectiveDraft] = useState('');
  const [tradeoffsDraft, setTradeoffsDraft] = useState('');

  // AI Responses per gate (ephemeral)
  const [aiResponses, setAiResponses] = useState<{
    problem: string | null;
    objective: string | null;
    tradeoffs: string | null;
  }>({ problem: null, objective: null, tradeoffs: null });
  const [warningAcknowledged, setWarningAcknowledged] = useState(false);

  // Result
  const [attestationResult, setAttestationResult] = useState<AttestationResult | null>(null);

  // AI Configuration
  const [aiMode, setAiMode] = useState<AIMode>('none');
  const [aiConfig, setAiConfig] = useState<LocalAIConfig>({ ...DEFAULT_AI_CONFIG, enabled: false });
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiConfigTesting, setAiConfigTesting] = useState(false);
  const [aiConfigError, setAiConfigError] = useState<string | null>(null);
  const [saveApiKey, setSaveApiKey] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string>('');

  // Load saved AI configuration from localStorage on mount
  useEffect(() => {
    const savedMode = localStorage.getItem('hap_ai_mode') as AIMode | null;
    const savedKey = localStorage.getItem('hap_public_ai_key');
    const savedProvider = localStorage.getItem('hap_public_ai_provider');
    const shouldSave = localStorage.getItem('hap_save_api_key') === 'true';

    if (savedMode === 'local') {
      setAiMode('local');
      setAiConfig({ ...PROVIDER_PRESETS.ollama, enabled: true } as LocalAIConfig);
      setExpandedGate('frame');
    } else if (savedMode === 'public' && shouldSave && savedKey) {
      setAiMode('public');
      const preset = savedProvider && PROVIDER_PRESETS[savedProvider] ? PROVIDER_PRESETS[savedProvider] : PROVIDER_PRESETS.openai;
      setAiConfig({ ...preset, enabled: true, apiKey: savedKey } as LocalAIConfig);
      setSelectedProvider(savedProvider || 'openai');
      setSaveApiKey(true);
      setExpandedGate('frame');
    } else if (savedMode === 'none') {
      setExpandedGate('frame');
    }
  }, []);

  // Save AI mode selection
  useEffect(() => {
    if (aiMode !== 'none') {
      localStorage.setItem('hap_ai_mode', aiMode);
    } else {
      localStorage.removeItem('hap_ai_mode');
    }
  }, [aiMode]);

  // Save/remove API key and provider from localStorage
  useEffect(() => {
    if (saveApiKey && aiConfig.apiKey) {
      localStorage.setItem('hap_public_ai_key', aiConfig.apiKey);
      localStorage.setItem('hap_save_api_key', 'true');
      if (selectedProvider) {
        localStorage.setItem('hap_public_ai_provider', selectedProvider);
      }
    } else if (!saveApiKey) {
      localStorage.removeItem('hap_public_ai_key');
      localStorage.removeItem('hap_save_api_key');
      localStorage.removeItem('hap_public_ai_provider');
    }
  }, [saveApiKey, aiConfig.apiKey, selectedProvider]);

  // Check AI availability
  useEffect(() => {
    checkAIAvailability(aiConfig).then(setAiAvailable);
  }, [aiConfig]);

  // Validation for articulation gates
  const validateGateText = useCallback((text: string, gate: 'problem' | 'objective' | 'tradeoffs'): { valid: boolean; error?: string } => {
    const trimmed = text.trim();
    if (trimmed.length < 20) {
      return { valid: false, error: `Minimum 20 characters required (${trimmed.length}/20)` };
    }
    if (trimmed.length > 240) {
      return { valid: false, error: `Maximum 240 characters allowed (${trimmed.length}/240)` };
    }

    if (prDetails) {
      const normalized = normalizeText(trimmed);
      if (normalizeText(prDetails.title) === normalized) {
        return { valid: false, error: 'Cannot be identical to PR title' };
      }
      if (prDetails.body && normalizeText(prDetails.body) === normalized) {
        return { valid: false, error: 'Cannot be identical to PR description' };
      }
    }

    if (gate === 'objective' && problemText) {
      if (normalizeText(trimmed) === normalizeText(problemText)) {
        return { valid: false, error: 'Must be different from the Problem' };
      }
    }

    return { valid: true };
  }, [prDetails, problemText]);


  // Validate AI config and test connection
  const validateAndTestAI = useCallback(async (): Promise<boolean> => {
    if (aiMode === 'none') {
      setAiConfigError(null);
      return true;
    }

    if (!aiConfig.endpoint) {
      setAiConfigError('Please enter an endpoint URL');
      return false;
    }

    if (!aiConfig.model) {
      setAiConfigError('Please enter a model name');
      return false;
    }

    if (aiMode === 'public' && !aiConfig.apiKey) {
      setAiConfigError('API key is required for public AI providers');
      return false;
    }

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

  // Check gate with AI assistance
  const checkGateWithAI = useCallback(async (gate: 'problem' | 'objective' | 'tradeoffs') => {
    if (!prDetails) return;

    setAiLoading(true);

    const requestType = gate === 'problem' ? 'check_problem' : gate === 'objective' ? 'check_objective' : 'check_tradeoffs';

    const request: AIAssistanceRequest = {
      type: requestType,
      context: {
        prTitle: prDetails.title,
        prDescription: prDetails.body || undefined,
        diffSummary: prFiles.map(f => `${f.status}: ${f.filename} (+${f.additions}/-${f.deletions})`).join('\n'),
        changedFiles: prFiles.map(f => f.filename),
        problemText: problemText,
        objectiveText: objectiveText,
        tradeoffsText: tradeoffsText,
        executionPath: executionPath,
      },
    };

    let response;
    if (aiAvailable) {
      response = await getAIAssistance(aiConfig, request);
    } else {
      response = getFallbackAssistance(request);
    }

    setAiResponses(prev => ({
      ...prev,
      [gate]: response.suggestion || null,
    }));

    setAiLoading(false);
  }, [prDetails, prFiles, problemText, objectiveText, tradeoffsText, executionPath, aiAvailable, aiConfig]);

  // Check if any gate has a warning
  const hasAnyWarning = aiResponses.problem?.toLowerCase().includes('**warning**') ||
    aiResponses.objective?.toLowerCase().includes('**warning**') ||
    aiResponses.tradeoffs?.toLowerCase().includes('**warning**');

  // Determine required roles based on execution path
  const requiredRoles: Role[] = executionPath === 'full'
    ? ['engineering', 'release_management']
    : ['engineering'];

  const attestedRoles = new Set(existingAttestations.map(a => a.role));
  const roleAlreadyAttested = attestedRoles.has(selectedRole);

  const currentGateIndex = gateOrder.indexOf(currentGate);

  // Check if a gate is accessible (completed or current)
  const isGateAccessible = (gate: Gate): boolean => {
    const gateIndex = gateOrder.indexOf(gate);
    return gateIndex <= currentGateIndex;
  };

  // Check if a gate is completed
  const isGateCompleted = (gate: Gate): boolean => {
    const gateIndex = gateOrder.indexOf(gate);
    return gateIndex < currentGateIndex;
  };

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
      setSelectedFiles(new Set(files.map(f => f.filename)));

      const commentsRes = await fetch(`/api/comments?owner=${parsed.owner}&repo=${parsed.repo}&pr=${parsed.number}`);
      if (commentsRes.ok) {
        const comments = await commentsRes.json();
        const attestations = parseAttestationsFromComments(comments, details.head.sha);
        setExistingAttestations(attestations);
      }
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
            problem_understood: true,
            objective_clear: true,
            tradeoffs_acceptable: true,
          },
          ttl_seconds: 3600,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.reason || 'Attestation failed');
      }

      setAttestationResult(data);
      setCurrentGate('done');
      setExpandedGate(null);
    } catch (err) {
      setError(`Attestation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }, [prDetails, executionPath, targetEnv, selectedFiles, selectedRole]);

  // Initialize drafts from saved values when opening a completed gate for editing
  const initializeDrafts = (gate: Gate) => {
    if (gate === 'frame') {
      setSelectedFilesDraft(new Set(selectedFiles));
      setExecutionPathDraft(executionPath);
    } else if (gate === 'problem') {
      setProblemDraft(problemText);
    } else if (gate === 'objective') {
      setObjectiveDraft(objectiveText);
    } else if (gate === 'tradeoffs') {
      setTradeoffsDraft(tradeoffsText);
    }
  };

  // Handle navigation click
  const handleNavClick = (gate: Gate | 'ai-setup') => {
    // Don't allow navigation once attestation is issued
    if (attestationResult) return;

    if (gate === 'ai-setup') {
      setExpandedGate(expandedGate === 'ai-setup' ? currentGate : 'ai-setup');
    } else if (isGateAccessible(gate)) {
      if (expandedGate === gate) {
        // Collapsing current gate - no action needed, drafts will be discarded
        setExpandedGate(null);
      } else {
        // Opening a gate - initialize drafts if it's a completed gate
        if (isGateCompleted(gate)) {
          initializeDrafts(gate);
        }
        setExpandedGate(gate);
      }
    }
  };

  // Close gate and advance
  const closeGateAndAdvance = (nextGate: Gate) => {
    setCurrentGate(nextGate);
    setExpandedGate(nextGate);
  };

  // Render AI assistance box for articulation gates
  const renderAIAssistance = (gate: 'problem' | 'objective' | 'tradeoffs') => {
    if (!aiConfig.enabled) return null;

    const buttonLabels = {
      problem: 'Help me understand what changed',
      objective: 'Check objective against changes',
      tradeoffs: `Surface risks for ${ROLE_INFO[selectedRole].label} under ${executionPath}`,
    };

    return (
      <div style={{ marginTop: '1rem', padding: '0.75rem', backgroundColor: '#f0f7ff', borderRadius: '4px', border: '1px solid #bbdefb' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5rem' }}>
          <span style={{ fontSize: '0.8rem', color: '#1565c0', fontWeight: 'bold' }}>AI Assistant</span>
          <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', color: '#666' }}>
            surfaces reality, does not supply intent
          </span>
        </div>
        <button
          onClick={() => checkGateWithAI(gate)}
          disabled={aiLoading}
          style={{
            padding: '0.4rem 0.8rem',
            fontSize: '0.85rem',
            backgroundColor: '#fff',
            color: '#1976d2',
            border: '1px solid #1976d2',
            borderRadius: '4px',
            cursor: aiLoading ? 'not-allowed' : 'pointer',
            opacity: aiLoading ? 0.6 : 1,
          }}
        >
          {aiLoading ? 'Analyzing...' : buttonLabels[gate]}
        </button>

        {aiResponses[gate] && (
          <div style={{
            marginTop: '0.75rem',
            padding: '0.75rem',
            backgroundColor: aiResponses[gate]?.toLowerCase().includes('**warning**') ? '#fff3e0' : '#fff',
            borderRadius: '4px',
            border: aiResponses[gate]?.toLowerCase().includes('**warning**') ? '1px solid #ffcc80' : '1px solid #e0e0e0',
          }}>
            <pre style={{
              margin: 0,
              fontSize: '0.85rem',
              color: '#333',
              whiteSpace: 'pre-wrap',
              fontFamily: 'inherit',
              lineHeight: '1.5',
            }}>
              {aiResponses[gate]}
            </pre>
            <div style={{ marginTop: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.75rem', color: '#999', fontStyle: 'italic' }}>
                AI surfaces reality. You supply intent.
              </span>
              <button
                onClick={() => setAiResponses(prev => ({ ...prev, [gate]: null }))}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#666',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Get AI status text for nav
  const getAIStatusText = () => {
    if (aiMode === 'none') return 'Off';
    if (aiMode === 'local') return 'Local';
    if (aiMode === 'public') return selectedProvider || 'Public';
    return '';
  };

  return (
    <main style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ marginBottom: '0.5rem' }}>HAP Deploy Demo</h1>
      <p style={{ color: '#666', marginBottom: '1.5rem', lineHeight: '1.5' }}>
        A human checkpoint that prevents direction drift. Before code ships, decision owners articulate the problem, objective, and tradeoffs in their domain — creating cryptographic proof of informed approval — not just a rubber stamp.
      </p>

      {/* Navigation Bar */}
      <nav style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.75rem 1rem',
        backgroundColor: '#f8f9fa',
        borderRadius: '8px',
        marginBottom: '1.5rem',
        flexWrap: 'wrap',
      }}>
        {/* AI Assistant Link */}
        <button
          onClick={() => handleNavClick('ai-setup')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.5rem 0.75rem',
            backgroundColor: expandedGate === 'ai-setup' ? '#1976d2' : 'transparent',
            color: expandedGate === 'ai-setup' ? 'white' : '#1976d2',
            border: '1px solid #1976d2',
            borderRadius: '20px',
            cursor: 'pointer',
            fontSize: '0.85rem',
            fontWeight: 500,
          }}
        >
          <span>AI Assistant</span>
          <span style={{
            fontSize: '0.7rem',
            padding: '0.1rem 0.4rem',
            backgroundColor: expandedGate === 'ai-setup' ? 'rgba(255,255,255,0.2)' : '#e3f2fd',
            borderRadius: '10px',
          }}>
            {getAIStatusText()}
          </span>
        </button>

        {/* Separator */}
        <div style={{ width: '1px', height: '24px', backgroundColor: '#ddd', margin: '0 0.5rem' }} />

        {/* Gate Pills */}
        {GATES.map((gate, i) => {
          const isAccessible = isGateAccessible(gate.id) && !attestationResult;
          const isCompleted = isGateCompleted(gate.id);
          const isCurrent = currentGate === gate.id;
          const isExpanded = expandedGate === gate.id;
          const isLocked = !!attestationResult;

          return (
            <div key={gate.id} style={{ display: 'flex', alignItems: 'center' }}>
              <button
                onClick={() => handleNavClick(gate.id)}
                disabled={!isAccessible}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.5rem 0.75rem',
                  backgroundColor: isLocked ? '#4caf50' : isExpanded ? '#1976d2' : isCompleted ? '#4caf50' : isCurrent ? '#e3f2fd' : 'transparent',
                  color: isLocked ? 'white' : isExpanded ? 'white' : isCompleted ? 'white' : isCurrent ? '#1976d2' : isAccessible ? '#666' : '#bbb',
                  border: isLocked || isExpanded || isCompleted ? 'none' : isCurrent ? '2px solid #1976d2' : '1px solid #ddd',
                  borderRadius: '20px',
                  cursor: isLocked ? 'default' : isAccessible ? 'pointer' : 'not-allowed',
                  fontSize: '0.85rem',
                  fontWeight: isCurrent || isExpanded ? 600 : 400,
                  opacity: 1,
                }}
              >
                {(isCompleted || isLocked) && !isExpanded && <span>&#10003;</span>}
                <span>{gate.label}</span>
              </button>
              {i < GATES.length - 1 && (
                <div style={{
                  width: '16px',
                  height: '2px',
                  backgroundColor: isCompleted || isLocked ? '#4caf50' : '#ddd',
                  margin: '0 0.25rem',
                }} />
              )}
            </div>
          );
        })}
      </nav>

      {error && (
        <div style={{ color: '#d32f2f', backgroundColor: '#ffebee', padding: '1rem', borderRadius: '4px', marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      {/* AI Setup Panel */}
      {expandedGate === 'ai-setup' && (
        <section style={{ padding: '1.5rem', backgroundColor: '#fff', borderRadius: '8px', marginBottom: '1.5rem', border: '2px solid #1976d2' }}>
          <h2>Setup: AI Assistant</h2>
          <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '1rem' }}>
            AI can help you understand changes, but cannot make decisions for you.
          </p>

          <div style={{ marginBottom: '1rem' }}>
            {/* Local AI */}
            <label
              style={{
                padding: '1rem',
                borderRadius: '8px',
                marginBottom: '0.75rem',
                display: 'block',
                cursor: 'pointer',
                backgroundColor: aiMode === 'local' ? '#e8f5e9' : '#fff',
                border: aiMode === 'local' ? '2px solid #4caf50' : '1px solid #ddd',
              }}
              onClick={() => {
                setAiMode('local');
                setAiConfig({ ...PROVIDER_PRESETS.ollama, enabled: true } as LocalAIConfig);
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                <input type="radio" name="aiMode" checked={aiMode === 'local'} onChange={() => {}} style={{ marginRight: '0.75rem', marginTop: '0.25rem' }} />
                <div style={{ flex: 1 }}>
                  <strong>Use Local/Private AI</strong>
                  <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', padding: '0.15rem 0.4rem', backgroundColor: '#c8e6c9', color: '#2e7d32', borderRadius: '3px' }}>Recommended</span>
                  <p style={{ fontSize: '0.85rem', color: '#666', margin: '0.25rem 0 0' }}>
                    Run AI locally with Ollama. Your data never leaves your machine.
                  </p>
                  {aiMode === 'local' && (
                    <div style={{ marginTop: '0.75rem' }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <input type="text" value={aiConfig.endpoint} onChange={(e) => setAiConfig(prev => ({ ...prev, endpoint: e.target.value }))} placeholder="http://localhost:11434" style={{ padding: '0.5rem', fontSize: '0.9rem', flex: '1', minWidth: '200px', borderRadius: '4px', border: '1px solid #ccc' }} />
                        <input type="text" value={aiConfig.model} onChange={(e) => setAiConfig(prev => ({ ...prev, model: e.target.value }))} placeholder="llama3.2" style={{ padding: '0.5rem', fontSize: '0.9rem', width: '150px', borderRadius: '4px', border: '1px solid #ccc' }} />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </label>

            {/* Public AI */}
            <label
              style={{
                padding: '1rem',
                borderRadius: '8px',
                marginBottom: '0.75rem',
                display: 'block',
                cursor: 'pointer',
                backgroundColor: aiMode === 'public' ? '#fff3e0' : '#fff',
                border: aiMode === 'public' ? '2px solid #ff9800' : '1px solid #ddd',
              }}
              onClick={() => {
                setAiMode('public');
                const savedKey = localStorage.getItem('hap_public_ai_key');
                const savedProvider = localStorage.getItem('hap_public_ai_provider');
                const shouldSave = localStorage.getItem('hap_save_api_key') === 'true';
                const preset = savedProvider && PROVIDER_PRESETS[savedProvider] ? PROVIDER_PRESETS[savedProvider] : PROVIDER_PRESETS.openai;
                setAiConfig({ ...preset, enabled: true, apiKey: savedKey || undefined } as LocalAIConfig);
                if (savedProvider) setSelectedProvider(savedProvider);
                if (shouldSave && savedKey) setSaveApiKey(true);
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                <input type="radio" name="aiMode" checked={aiMode === 'public'} onChange={() => {}} style={{ marginRight: '0.75rem', marginTop: '0.25rem' }} />
                <div style={{ flex: 1 }}>
                  <strong>Use Public AI</strong>
                  <p style={{ fontSize: '0.85rem', color: '#666', margin: '0.25rem 0 0' }}>
                    OpenAI, Groq, or other cloud providers.
                  </p>
                  {aiMode === 'public' && (
                    <div style={{ marginTop: '0.75rem' }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ backgroundColor: '#ffebee', border: '1px solid #ef9a9a', padding: '0.5rem', borderRadius: '4px', marginBottom: '0.75rem', fontSize: '0.8rem', color: '#c62828' }}>
                        <strong>Demo only.</strong> Do not use with sensitive data.
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <select
                          value={selectedProvider}
                          onChange={(e) => {
                            const provider = e.target.value;
                            setSelectedProvider(provider);
                            const preset = PROVIDER_PRESETS[provider];
                            if (preset) setAiConfig(prev => ({ ...prev, ...preset, apiKey: prev.apiKey }));
                          }}
                          style={{ padding: '0.5rem', fontSize: '0.9rem', maxWidth: '180px', borderRadius: '4px', border: '1px solid #ccc' }}
                        >
                          <option value="">Select provider...</option>
                          <option value="openai">OpenAI</option>
                          <option value="groq">Groq</option>
                        </select>
                        <input type="password" value={aiConfig.apiKey || ''} onChange={(e) => setAiConfig(prev => ({ ...prev, apiKey: e.target.value || undefined }))} placeholder="API Key" style={{ padding: '0.5rem', fontSize: '0.9rem', flex: '1', minWidth: '200px', borderRadius: '4px', border: '1px solid #ccc' }} />
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', marginTop: '0.5rem', fontSize: '0.85rem', color: '#666', cursor: 'pointer' }}>
                        <input type="checkbox" checked={saveApiKey} onChange={(e) => setSaveApiKey(e.target.checked)} style={{ marginRight: '0.5rem' }} />
                        Save API key in browser (localStorage)
                      </label>
                    </div>
                  )}
                </div>
              </div>
            </label>

            {/* No AI */}
            <label
              style={{
                padding: '1rem',
                borderRadius: '8px',
                marginBottom: '0.75rem',
                display: 'block',
                cursor: 'pointer',
                backgroundColor: aiMode === 'none' ? '#e3f2fd' : '#fff',
                border: aiMode === 'none' ? '2px solid #1976d2' : '1px solid #ddd',
              }}
              onClick={() => {
                setAiMode('none');
                setAiConfig({ ...DEFAULT_AI_CONFIG, enabled: false });
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                <input type="radio" name="aiMode" checked={aiMode === 'none'} onChange={() => {}} style={{ marginRight: '0.75rem', marginTop: '0.25rem' }} />
                <div>
                  <strong>No AI Assistant</strong>
                  <p style={{ fontSize: '0.85rem', color: '#666', margin: '0.25rem 0 0' }}>
                    Review changes without AI assistance
                  </p>
                </div>
              </div>
            </label>
          </div>

          {aiConfigError && (
            <div style={{ color: '#d32f2f', backgroundColor: '#ffebee', padding: '1rem', borderRadius: '4px', marginBottom: '1rem' }}>
              {aiConfigError}
            </div>
          )}

          <button
            style={{
              padding: '0.75rem 1.5rem',
              fontSize: '1rem',
              backgroundColor: aiConfigTesting ? '#ccc' : '#1976d2',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: aiConfigTesting ? 'not-allowed' : 'pointer',
            }}
            disabled={aiConfigTesting}
            onClick={async () => {
              const valid = await validateAndTestAI();
              if (valid) {
                localStorage.setItem('hap_ai_mode', aiMode);
                setExpandedGate('frame');
              }
            }}
          >
            {aiConfigTesting ? 'Testing connection...' : 'Continue'}
          </button>
        </section>
      )}

      {/* GATE 1: Frame */}
      {expandedGate === 'frame' && (
        <section style={{ padding: '1.5rem', backgroundColor: '#fff', borderRadius: '8px', marginBottom: '1.5rem', border: '2px solid #1976d2' }}>
          <h2>Gate 1: Frame</h2>
          <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '1rem' }}>
            Define what could happen and under what constraints.
          </p>

          {!prDetails ? (
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>Pull Request</label>
              <input
                type="text"
                value={prInput}
                onChange={(e) => setPrInput(e.target.value)}
                placeholder="owner/repo#123 or GitHub URL"
                style={{ width: '100%', padding: '0.75rem', fontSize: '1rem', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box', marginBottom: '0.5rem' }}
                onKeyDown={(e) => e.key === 'Enter' && loadPR()}
              />
              <button
                style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', backgroundColor: loading ? '#ccc' : '#1976d2', color: 'white', border: 'none', borderRadius: '4px', cursor: loading ? 'not-allowed' : 'pointer' }}
                onClick={loadPR}
                disabled={loading}
              >
                {loading ? 'Loading...' : 'Load PR'}
              </button>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: '1.5rem', padding: '1rem', backgroundColor: '#f5f5f5', borderRadius: '4px' }}>
                <p style={{ margin: 0 }}><strong>#{prDetails.number}</strong>: {prDetails.title}</p>
                <p style={{ fontSize: '0.85rem', color: '#666', margin: '0.25rem 0 0' }}>
                  {prDetails.repo} | {prDetails.head.sha.slice(0, 7)} | env: {targetEnv}
                </p>
              </div>

              {existingAttestations.length > 0 && (
                <div style={{ marginBottom: '1rem' }}>
                  <p style={{ fontSize: '0.9rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>Existing Attestations:</p>
                  {existingAttestations.map((att, i) => (
                    <div key={i} style={{ display: 'inline-block', padding: '0.25rem 0.5rem', backgroundColor: '#e8f5e9', color: '#2e7d32', borderRadius: '4px', marginRight: '0.5rem', fontSize: '0.85rem' }}>
                      &#10003; {ROLE_INFO[att.role as Role]?.label || att.role}
                    </div>
                  ))}
                </div>
              )}

              {(() => {
                const isEditing = isGateCompleted('frame');
                const displayFiles = isEditing ? selectedFilesDraft : selectedFiles;
                const displayPath = isEditing ? executionPathDraft : executionPath;
                const hasChanges = isEditing && (
                  selectedFilesDraft.size !== selectedFiles.size ||
                  [...selectedFilesDraft].some(f => !selectedFiles.has(f)) ||
                  executionPathDraft !== executionPath
                );

                const toggleFileHandler = (filename: string) => {
                  if (isEditing) {
                    setSelectedFilesDraft(prev => {
                      const next = new Set(prev);
                      if (next.has(filename)) next.delete(filename);
                      else next.add(filename);
                      return next;
                    });
                  } else {
                    toggleFile(filename);
                  }
                };

                const setPathHandler = (path: 'canary' | 'full') => {
                  if (isEditing) {
                    setExecutionPathDraft(path);
                  } else {
                    setExecutionPath(path);
                  }
                };

                const saveChanges = () => {
                  setSelectedFiles(new Set(selectedFilesDraft));
                  setExecutionPath(executionPathDraft);
                  setExpandedGate(currentGate);
                };

                return (
                  <>
                    <div style={{ marginBottom: '1.5rem' }}>
                      <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                        Changed Files ({displayFiles.size} of {prFiles.length} selected)
                      </label>
                      <ul style={{ listStyle: 'none', padding: 0, margin: '1rem 0', maxHeight: '300px', overflow: 'auto' }}>
                        {prFiles.map((file) => (
                          <li key={file.filename} style={{ padding: '0.5rem', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center' }}>
                            <input type="checkbox" checked={displayFiles.has(file.filename)} onChange={() => toggleFileHandler(file.filename)} style={{ marginRight: '0.5rem', width: '18px', height: '18px' }} />
                            <code style={{ flex: 1, fontSize: '0.85rem' }}>{file.filename}</code>
                            {getStatusBadge(file.status)}
                            <span style={{ marginLeft: '0.5rem', fontSize: '0.8rem', color: '#666' }}>+{file.additions} -{file.deletions}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div style={{ marginBottom: '1.5rem' }}>
                      <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>Execution Path</label>
                      <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.5rem' }}>
                        This constrains how the system may deploy.
                      </p>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', cursor: 'pointer' }}>
                          <input type="radio" name="path" value="canary" checked={displayPath === 'canary'} onChange={() => setPathHandler('canary')} style={{ marginRight: '0.5rem' }} />
                          <strong>Canary</strong> &#8212; gradual rollout, reduced blast radius
                        </label>
                        <label style={{ display: 'block', cursor: 'pointer' }}>
                          <input type="radio" name="path" value="full" checked={displayPath === 'full'} onChange={() => setPathHandler('full')} style={{ marginRight: '0.5rem' }} />
                          <strong>Full</strong> &#8212; immediate rollout, higher risk
                        </label>
                      </div>
                      {displayPath === 'full' && (
                        <div style={{ marginTop: '0.5rem', padding: '0.5rem', backgroundColor: '#fff3e0', borderRadius: '4px', fontSize: '0.85rem', color: '#e65100' }}>
                          Full deployment requires: Engineering + Release Management
                        </div>
                      )}
                    </div>

                    {currentGate === 'frame' ? (
                      <button
                        style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', backgroundColor: displayFiles.size > 0 ? '#1976d2' : '#ccc', color: 'white', border: 'none', borderRadius: '4px', cursor: displayFiles.size > 0 ? 'pointer' : 'not-allowed' }}
                        disabled={displayFiles.size === 0}
                        onClick={() => closeGateAndAdvance('decision-owner')}
                      >
                        Close Gate 1
                      </button>
                    ) : isEditing && (
                      <button
                        style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', backgroundColor: hasChanges ? '#4caf50' : '#ccc', color: 'white', border: 'none', borderRadius: '4px', cursor: hasChanges ? 'pointer' : 'not-allowed' }}
                        disabled={!hasChanges}
                        onClick={saveChanges}
                      >
                        Change Frame
                      </button>
                    )}
                  </>
                );
              })()}
            </>
          )}
        </section>
      )}

      {/* GATE 2: Decision Owner */}
      {expandedGate === 'decision-owner' && prDetails && (
        <section style={{ padding: '1.5rem', backgroundColor: '#fff', borderRadius: '8px', marginBottom: '1.5rem', border: '2px solid #1976d2' }}>
          <h2>Gate 2: Decision Owner</h2>
          <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '1rem' }}>
            Define who is responsible for this approval. Role is locked after this step.
          </p>

          {roleLocked ? (
            <div style={{ padding: '0.75rem 1rem', backgroundColor: '#e3f2fd', borderRadius: '4px', marginBottom: '1rem', border: '1px solid #90caf9' }}>
              <strong>Attesting as:</strong> {ROLE_INFO[selectedRole].label}
              <span style={{ marginLeft: '1rem', fontSize: '0.85rem', color: '#666' }}>(locked)</span>
            </div>
          ) : (
            <>
              {requiredRoles.map(role => {
                const isAttested = attestedRoles.has(role);
                const isSelected = selectedRole === role;
                return (
                  <div
                    key={role}
                    onClick={() => !isAttested && setSelectedRole(role)}
                    style={{
                      padding: '1rem',
                      borderRadius: '8px',
                      marginBottom: '0.75rem',
                      cursor: isAttested ? 'not-allowed' : 'pointer',
                      backgroundColor: isSelected ? '#e3f2fd' : isAttested ? '#f5f5f5' : '#fff',
                      border: isSelected ? '2px solid #1976d2' : '1px solid #ddd',
                      opacity: isAttested ? 0.7 : 1,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <strong>{ROLE_INFO[role].label}</strong>
                        <p style={{ fontSize: '0.85rem', color: '#666', margin: '0.25rem 0 0' }}>{ROLE_INFO[role].description}</p>
                      </div>
                      {isAttested && (
                        <span style={{ backgroundColor: '#e8f5e9', color: '#2e7d32', padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem' }}>
                          &#10003; Attested
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}

              {roleAlreadyAttested && (
                <div style={{ color: '#e65100', backgroundColor: '#fff3e0', padding: '1rem', borderRadius: '4px', marginBottom: '1rem' }}>
                  You have already attested for {ROLE_INFO[selectedRole].label}.
                </div>
              )}

              {currentGate === 'decision-owner' && !roleAlreadyAttested ? (
                <button
                  style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', backgroundColor: '#1976d2', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                  onClick={() => {
                    setRoleLocked(true);
                    closeGateAndAdvance('problem');
                  }}
                >
                  Lock Role &amp; Close Gate 2
                </button>
              ) : isGateCompleted('decision-owner') && (
                <button
                  style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', backgroundColor: '#4caf50', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                  onClick={() => setExpandedGate(currentGate)}
                >
                  Done
                </button>
              )}
            </>
          )}
        </section>
      )}

      {/* GATE 3: Problem */}
      {expandedGate === 'problem' && prDetails && !roleAlreadyAttested && (
        <section style={{ padding: '1.5rem', backgroundColor: '#fff', borderRadius: '8px', marginBottom: '1.5rem', border: '2px solid #1976d2' }}>
          <h2>Gate 3: Problem</h2>
          <p style={{ fontSize: '0.9rem', color: '#333', marginBottom: '0.5rem' }}>
            What concrete problem does this change address, and where does it surface?
          </p>
          <p style={{ fontSize: '0.8rem', color: '#999', marginBottom: '1rem' }}>
            This is for your accountability. It is not evaluated by the system.
          </p>

          {(() => {
            const isEditing = isGateCompleted('problem');
            const displayText = isEditing ? problemDraft : problemText;
            const setDisplayText = isEditing ? setProblemDraft : setProblemText;
            const validation = validateGateText(displayText, 'problem');
            const hasChanges = isEditing && problemDraft !== problemText;

            const saveChanges = () => {
              setProblemText(problemDraft);
              setExpandedGate(currentGate);
            };

            return (
              <>
                <textarea
                  value={displayText}
                  onChange={(e) => setDisplayText(e.target.value)}
                  placeholder="Describe the problem..."
                  style={{ width: '100%', padding: '0.75rem', fontSize: '1rem', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box', minHeight: '100px', resize: 'vertical' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
                  <span style={{ fontSize: '0.8rem', color: !validation.valid && displayText.length > 0 ? '#f44336' : '#666' }}>
                    {validation.error || ''}
                  </span>
                  <span style={{ fontSize: '0.8rem', color: displayText.length < 20 || displayText.length > 240 ? '#f44336' : '#666' }}>
                    {displayText.length}/240
                  </span>
                </div>

                {renderAIAssistance('problem')}

                {currentGate === 'problem' ? (
                  <button
                    style={{ marginTop: '1rem', padding: '0.75rem 1.5rem', fontSize: '1rem', backgroundColor: validation.valid ? '#1976d2' : '#ccc', color: 'white', border: 'none', borderRadius: '4px', cursor: validation.valid ? 'pointer' : 'not-allowed' }}
                    disabled={!validation.valid}
                    onClick={() => closeGateAndAdvance('objective')}
                  >
                    Close Gate 3
                  </button>
                ) : isEditing && (
                  <button
                    style={{ marginTop: '1rem', padding: '0.75rem 1.5rem', fontSize: '1rem', backgroundColor: hasChanges && validation.valid ? '#4caf50' : '#ccc', color: 'white', border: 'none', borderRadius: '4px', cursor: hasChanges && validation.valid ? 'pointer' : 'not-allowed' }}
                    disabled={!hasChanges || !validation.valid}
                    onClick={saveChanges}
                  >
                    Change Problem
                  </button>
                )}
              </>
            );
          })()}
        </section>
      )}

      {/* GATE 4: Objective */}
      {expandedGate === 'objective' && prDetails && !roleAlreadyAttested && (
        <section style={{ padding: '1.5rem', backgroundColor: '#fff', borderRadius: '8px', marginBottom: '1.5rem', border: '2px solid #1976d2' }}>
          <h2>Gate 4: Objective</h2>
          <p style={{ fontSize: '0.9rem', color: '#333', marginBottom: '0.5rem' }}>
            What outcome are you approving this change to achieve?
          </p>
          <p style={{ fontSize: '0.8rem', color: '#999', marginBottom: '1rem' }}>
            This text is not transmitted, signed, or enforced.
          </p>

          {(() => {
            const isEditing = isGateCompleted('objective');
            const displayText = isEditing ? objectiveDraft : objectiveText;
            const setDisplayText = isEditing ? setObjectiveDraft : setObjectiveText;
            const validation = validateGateText(displayText, 'objective');
            const hasChanges = isEditing && objectiveDraft !== objectiveText;

            const saveChanges = () => {
              setObjectiveText(objectiveDraft);
              setExpandedGate(currentGate);
            };

            return (
              <>
                <textarea
                  value={displayText}
                  onChange={(e) => setDisplayText(e.target.value)}
                  placeholder="Describe the objective..."
                  style={{ width: '100%', padding: '0.75rem', fontSize: '1rem', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box', minHeight: '100px', resize: 'vertical' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
                  <span style={{ fontSize: '0.8rem', color: !validation.valid && displayText.length > 0 ? '#f44336' : '#666' }}>
                    {validation.error || ''}
                  </span>
                  <span style={{ fontSize: '0.8rem', color: displayText.length < 20 || displayText.length > 240 ? '#f44336' : '#666' }}>
                    {displayText.length}/240
                  </span>
                </div>

                {renderAIAssistance('objective')}

                {currentGate === 'objective' ? (
                  <button
                    style={{ marginTop: '1rem', padding: '0.75rem 1.5rem', fontSize: '1rem', backgroundColor: validation.valid ? '#1976d2' : '#ccc', color: 'white', border: 'none', borderRadius: '4px', cursor: validation.valid ? 'pointer' : 'not-allowed' }}
                    disabled={!validation.valid}
                    onClick={() => closeGateAndAdvance('tradeoffs')}
                  >
                    Close Gate 4
                  </button>
                ) : isEditing && (
                  <button
                    style={{ marginTop: '1rem', padding: '0.75rem 1.5rem', fontSize: '1rem', backgroundColor: hasChanges && validation.valid ? '#4caf50' : '#ccc', color: 'white', border: 'none', borderRadius: '4px', cursor: hasChanges && validation.valid ? 'pointer' : 'not-allowed' }}
                    disabled={!hasChanges || !validation.valid}
                    onClick={saveChanges}
                  >
                    Change Objective
                  </button>
                )}
              </>
            );
          })()}
        </section>
      )}

      {/* GATE 5: Tradeoffs */}
      {expandedGate === 'tradeoffs' && prDetails && !roleAlreadyAttested && (
        <section style={{ padding: '1.5rem', backgroundColor: '#fff', borderRadius: '8px', marginBottom: '1.5rem', border: '2px solid #1976d2' }}>
          <h2>Gate 5: Tradeoffs</h2>

          <div style={{ padding: '0.75rem 1rem', backgroundColor: '#e3f2fd', borderRadius: '4px', marginBottom: '1rem', border: '1px solid #90caf9' }}>
            <strong>You are approving as:</strong> {ROLE_INFO[selectedRole].label}<br />
            <strong>Execution path:</strong> {executionPath === 'canary' ? 'Canary (gradual rollout)' : 'Full (immediate deployment)'}
          </div>

          <p style={{ fontSize: '0.9rem', color: '#333', marginBottom: '0.5rem' }}>
            What tradeoffs are you explicitly accepting by approving this change?
          </p>
          <p style={{ fontSize: '0.8rem', color: '#999', marginBottom: '1rem' }}>
            This is your acknowledgment of risk. Execution constraints are defined separately.
          </p>

          {(() => {
            const isEditing = isGateCompleted('tradeoffs');
            const displayText = isEditing ? tradeoffsDraft : tradeoffsText;
            const setDisplayText = isEditing ? setTradeoffsDraft : setTradeoffsText;
            const validation = validateGateText(displayText, 'tradeoffs');
            const hasChanges = isEditing && tradeoffsDraft !== tradeoffsText;

            const saveChanges = () => {
              setTradeoffsText(tradeoffsDraft);
              setExpandedGate(currentGate);
            };

            return (
              <>
                <textarea
                  value={displayText}
                  onChange={(e) => setDisplayText(e.target.value)}
                  placeholder={`As ${ROLE_INFO[selectedRole].label}, I accept...`}
                  style={{ width: '100%', padding: '0.75rem', fontSize: '1rem', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box', minHeight: '100px', resize: 'vertical' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
                  <span style={{ fontSize: '0.8rem', color: !validation.valid && displayText.length > 0 ? '#f44336' : '#666' }}>
                    {validation.error || ''}
                  </span>
                  <span style={{ fontSize: '0.8rem', color: displayText.length < 20 || displayText.length > 240 ? '#f44336' : '#666' }}>
                    {displayText.length}/240
                  </span>
                </div>

                {renderAIAssistance('tradeoffs')}

                {currentGate === 'tradeoffs' ? (
                  <button
                    style={{ marginTop: '1rem', padding: '0.75rem 1.5rem', fontSize: '1rem', backgroundColor: validation.valid ? '#1976d2' : '#ccc', color: 'white', border: 'none', borderRadius: '4px', cursor: validation.valid ? 'pointer' : 'not-allowed' }}
                    disabled={!validation.valid}
                    onClick={() => closeGateAndAdvance('commitment')}
                  >
                    Close Gate 5
                  </button>
                ) : isEditing && (
                  <button
                    style={{ marginTop: '1rem', padding: '0.75rem 1.5rem', fontSize: '1rem', backgroundColor: hasChanges && validation.valid ? '#4caf50' : '#ccc', color: 'white', border: 'none', borderRadius: '4px', cursor: hasChanges && validation.valid ? 'pointer' : 'not-allowed' }}
                    disabled={!hasChanges || !validation.valid}
                    onClick={saveChanges}
                  >
                    Change Tradeoffs
                  </button>
                )}
              </>
            );
          })()}
        </section>
      )}

      {/* GATE 6: Commitment */}
      {expandedGate === 'commitment' && prDetails && !roleAlreadyAttested && (
        <section style={{ padding: '1.5rem', backgroundColor: '#fff', borderRadius: '8px', marginBottom: '1.5rem', border: '2px solid #1976d2' }}>
          <h2>Gate 6: Commitment</h2>
          <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '1rem' }}>
            Review and sign your attestation.
          </p>

          <div style={{ backgroundColor: '#1a1a2e', color: '#e0e0e0', padding: '1.5rem', borderRadius: '8px', marginBottom: '1.5rem', fontFamily: 'monospace', fontSize: '0.9rem' }}>
            <p style={{ color: '#4fc3f7', marginBottom: '1rem', fontWeight: 'bold' }}>You are about to sign:</p>
            <p style={{ margin: '0.5rem 0' }}>&#8226; <strong>Profile:</strong> deploy-gate@0.2</p>
            <p style={{ margin: '0.5rem 0' }}>&#8226; <strong>Repo:</strong> {prDetails.repo}</p>
            <p style={{ margin: '0.5rem 0' }}>&#8226; <strong>Commit:</strong> {prDetails.head.sha.slice(0, 12)}...</p>
            <p style={{ margin: '0.5rem 0' }}>&#8226; <strong>Environment:</strong> {targetEnv}</p>
            <p style={{ margin: '0.5rem 0' }}>&#8226; <strong>Execution path:</strong> {executionPath}</p>
            <p style={{ margin: '0.5rem 0' }}>&#8226; <strong>Role:</strong> {ROLE_INFO[selectedRole].label}</p>
            <p style={{ margin: '0.5rem 0' }}>&#8226; <strong>Gates closed:</strong> 1-5 &#10003;</p>
          </div>

          <div style={{ backgroundColor: '#fff8e1', border: '1px solid #ffcc02', padding: '1rem', borderRadius: '4px', marginBottom: '1.5rem' }}>
            <p style={{ margin: 0, fontWeight: 'bold', color: '#f57c00' }}>
              Your written explanations are not included in the attestation.
            </p>
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem', color: '#666' }}>
              By signing, you authorize the action above &#8212; not your reasoning.
            </p>
          </div>

          {hasAnyWarning && (
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ color: '#e65100', backgroundColor: '#fff3e0', padding: '1rem', borderRadius: '4px', marginBottom: '0.5rem' }}>
                <strong>AI raised concerns during your review.</strong>
                <p style={{ margin: '0.5rem 0', fontSize: '0.9rem' }}>
                  Review the warnings shown in the gates above before signing.
                </p>
              </div>
              <label style={{ display: 'flex', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={warningAcknowledged}
                  onChange={(e) => setWarningAcknowledged(e.target.checked)}
                  style={{ marginRight: '0.5rem', width: '18px', height: '18px' }}
                />
                <span style={{ fontSize: '0.9rem' }}>I have reviewed the warnings and choose to proceed</span>
              </label>
            </div>
          )}

          {currentGate === 'commitment' && (
            <button
              style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', backgroundColor: (loading || (hasAnyWarning && !warningAcknowledged)) ? '#ccc' : '#1976d2', color: 'white', border: 'none', borderRadius: '4px', cursor: (loading || (hasAnyWarning && !warningAcknowledged)) ? 'not-allowed' : 'pointer' }}
              onClick={requestAttestation}
              disabled={loading || (hasAnyWarning && !warningAcknowledged)}
            >
              {loading ? 'Signing...' : 'Sign Attestation'}
            </button>
          )}
        </section>
      )}

      {/* DONE */}
      {attestationResult && (
        <section style={{ padding: '1.5rem', backgroundColor: '#fff', borderRadius: '8px', marginBottom: '1.5rem', border: '2px solid #4caf50' }}>
          <h2>Attestation Complete</h2>
          <div style={{ color: '#2e7d32', backgroundColor: '#e8f5e9', padding: '1rem', borderRadius: '4px', marginBottom: '1rem' }}>
            All 6 gates closed. Attestation created for {ROLE_INFO[selectedRole].label}.
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <p><strong>Frame Hash:</strong></p>
            <code style={{ fontSize: '0.85rem', wordBreak: 'break-all' }}>{attestationResult.frame_hash}</code>
          </div>
          <div style={{ marginBottom: '1.5rem' }}>
            <p><strong>Expires:</strong> {new Date(attestationResult.expires_at).toLocaleString()}</p>
          </div>

          <div style={{ backgroundColor: '#f5f5f5', padding: '1rem', borderRadius: '4px', marginBottom: '1rem' }}>
            <p style={{ margin: '0 0 0.75rem', fontWeight: 'bold' }}>Next step:</p>
            <p style={{ margin: '0 0 1rem', fontSize: '0.9rem', color: '#666' }}>
              Copy the attestation below and paste it as a comment on your pull request. The GitHub Action will verify it and allow the merge.
            </p>
            <button
              style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', backgroundColor: '#1976d2', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
              onClick={() => {
                const attestationText = `## HAP Deploy Demo Attestation

**Profile:** \`deploy-gate@0.2\`
**Role:** \`${selectedRole}\` (${ROLE_INFO[selectedRole].label})
**Execution Path:** \`${executionPath}\` (${executionPath === 'canary' ? 'Canary (gradual rollout)' : 'Full (immediate deployment)'})
**Environment:** \`${targetEnv}\`
**Commit:** \`${prDetails?.head.sha}\`

### Gates Closed
- [x] Gate 1: Frame validated
- [x] Gate 2: Decision Owner confirmed (${ROLE_INFO[selectedRole].label})
- [x] Gate 3: Problem articulated
- [x] Gate 4: Objective articulated
- [x] Gate 5: Tradeoffs accepted (as ${ROLE_INFO[selectedRole].label} under ${executionPath})
- [x] Gate 6: Commitment signed

---

\`\`\`
---BEGIN HAP_ATTESTATION v=1---
profile=deploy-gate@0.2
role=${selectedRole}
env=${targetEnv}
path=${executionPath}
sha=${prDetails?.head.sha}
frame_hash=${attestationResult.frame_hash}
disclosure_hash=${attestationResult.disclosure_hash}
blob=${attestationResult.attestation}
---END HAP_ATTESTATION---
\`\`\`

*Attestation expires: ${new Date(attestationResult.expires_at).toLocaleString()}*`;
                navigator.clipboard.writeText(attestationText);
                alert('Attestation copied to clipboard!');
              }}
            >
              Copy Attestation
            </button>
          </div>

          <details>
            <summary style={{ cursor: 'pointer', color: '#666' }}>View raw attestation block</summary>
            <pre style={{ backgroundColor: '#263238', color: '#aed581', padding: '1rem', borderRadius: '4px', overflow: 'auto', fontSize: '0.85rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all', marginTop: '0.5rem' }}>
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
          <a href="https://humanagencyprotocol.org" style={{ color: '#1976d2' }}>Human Agency Protocol</a>
          {' | '}
          <a href="https://service.humanagencyprotocol.org" style={{ color: '#1976d2' }}>Service Provider</a>
        </p>
      </footer>
    </main>
  );
}
