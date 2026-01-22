'use client';

import { useState, useCallback } from 'react';
import { parsePRInput, fetchPRDetails, fetchPRFiles, PRDetails, PRFile } from '../lib/github';

type Step = 'select-pr' | 'review-changes' | 'set-path' | 'gates' | 'confirm' | 'done';

interface AttestationResult {
  attestation: string;
  frame_hash: string;
  disclosure_hash: string;
  expires_at: string;
}

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
};

const stepOrder: Step[] = ['select-pr', 'review-changes', 'set-path', 'gates', 'confirm', 'done'];

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

export default function Home() {
  const [step, setStep] = useState<Step>('select-pr');
  const [prInput, setPrInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // PR data
  const [prDetails, setPrDetails] = useState<PRDetails | null>(null);
  const [prFiles, setPrFiles] = useState<PRFile[]>([]);
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');

  // User selections
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [executionPath, setExecutionPath] = useState<'canary' | 'full'>('canary');
  const [targetEnv, setTargetEnv] = useState<'staging' | 'prod'>('prod');

  // Gates
  const [problemUnderstood, setProblemUnderstood] = useState(false);
  const [objectiveClear, setObjectiveClear] = useState(false);
  const [tradeoffsAcceptable, setTradeoffsAcceptable] = useState(false);

  // Result
  const [attestationResult, setAttestationResult] = useState<AttestationResult | null>(null);
  const [commentUrl, setCommentUrl] = useState<string | null>(null);

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
          frame: {
            repo: prDetails.repo,
            sha: prDetails.head.sha,
            env: targetEnv,
            disclosures: Array.from(selectedFiles),
          },
          decision_owners: [
            { id: 'human-reviewer', scope: '*' },
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
        throw new Error(data.error || 'Attestation failed');
      }

      setAttestationResult(data);
      setStep('done');
    } catch (err) {
      setError(`Attestation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }, [prDetails, executionPath, targetEnv, selectedFiles, problemUnderstood, objectiveClear, tradeoffsAcceptable]);

  const postComment = useCallback(async () => {
    if (!prDetails || !attestationResult) return;

    setError(null);
    setLoading(true);

    const commentBody = `## HAP Deploy Gate Attestation

**Profile:** \`deploy-gate@0.2\`
**Execution Path:** \`${executionPath}\`
**Environment:** \`${targetEnv}\`
**Commit:** \`${prDetails.head.sha}\`

### Disclosures
${Array.from(selectedFiles).map(f => `- \`${f}\``).join('\n')}

### Gates Confirmed
- [x] Problem understood
- [x] Objective clear
- [x] Tradeoffs acceptable

---

\`\`\`
---BEGIN HAP_ATTESTATION v=1---
profile=${attestationResult.frame_hash.includes('deploy-gate') ? 'deploy-gate@0.2' : 'deploy-gate@0.2'}
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
    } catch (err) {
      setError(`Failed to post comment: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }, [prDetails, attestationResult, executionPath, targetEnv, selectedFiles, owner, repo]);

  const currentStepIndex = stepOrder.indexOf(step);
  const allGatesChecked = problemUnderstood && objectiveClear && tradeoffsAcceptable;

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

      {/* Step 1: Select PR */}
      <section style={step === 'select-pr' ? styles.cardActive : styles.card}>
        <h2>1. Select Pull Request</h2>
        {prDetails ? (
          <div>
            <p>
              <strong>#{prDetails.number}</strong>: {prDetails.title}
            </p>
            <p style={{ fontSize: '0.9rem', color: '#666' }}>
              {prDetails.repo} | {prDetails.head.sha.slice(0, 7)} | by {prDetails.user.login}
            </p>
            {step === 'select-pr' && (
              <button style={styles.buttonSecondary} onClick={() => setPrDetails(null)}>
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
          <h2>2. Review Changes & Select Disclosures</h2>
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
          <h2>3. Execution Path & Environment</h2>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem' }}>
              <strong>Execution Path:</strong>
            </label>
            <label style={{ marginRight: '1.5rem' }}>
              <input
                type="radio"
                name="path"
                value="canary"
                checked={executionPath === 'canary'}
                onChange={() => setExecutionPath('canary')}
              />{' '}
              Canary (gradual rollout)
            </label>
            <label>
              <input
                type="radio"
                name="path"
                value="full"
                checked={executionPath === 'full'}
                onChange={() => setExecutionPath('full')}
              />{' '}
              Full (immediate deployment)
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
          {step === 'set-path' && (
            <button style={styles.button} onClick={() => setStep('gates')}>
              Continue
            </button>
          )}
        </section>
      )}

      {/* Step 4: Gates */}
      {prDetails && currentStepIndex >= 3 && (
        <section style={step === 'gates' ? styles.cardActive : styles.card}>
          <h2>4. Decision Gates</h2>
          <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '1rem' }}>
            Confirm you understand the implications of this deployment:
          </p>
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
          {step === 'gates' && (
            <button
              style={allGatesChecked ? styles.button : styles.buttonDisabled}
              onClick={() => setStep('confirm')}
              disabled={!allGatesChecked}
            >
              Continue
            </button>
          )}
        </section>
      )}

      {/* Step 5: Confirm & Request Attestation */}
      {prDetails && currentStepIndex >= 4 && (
        <section style={step === 'confirm' ? styles.cardActive : styles.card}>
          <h2>5. Confirm & Request Attestation</h2>
          <div style={{ backgroundColor: '#f5f5f5', padding: '1rem', borderRadius: '4px', marginBottom: '1rem' }}>
            <p><strong>Repository:</strong> {prDetails.repo}</p>
            <p><strong>Commit:</strong> {prDetails.head.sha}</p>
            <p><strong>Environment:</strong> {targetEnv}</p>
            <p><strong>Execution Path:</strong> {executionPath}</p>
            <p><strong>Disclosures:</strong> {selectedFiles.size} files</p>
          </div>
          {step === 'confirm' && (
            <button
              style={loading ? styles.buttonDisabled : styles.button}
              onClick={requestAttestation}
              disabled={loading}
            >
              {loading ? 'Requesting...' : 'Request Attestation'}
            </button>
          )}
        </section>
      )}

      {/* Step 6: Done */}
      {attestationResult && (
        <section style={styles.cardActive}>
          <h2>Attestation Ready</h2>
          <div style={styles.success}>
            Attestation created successfully!
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
            <div style={styles.success}>
              Comment posted!{' '}
              <a href={commentUrl} target="_blank" rel="noopener noreferrer">
                View on GitHub
              </a>
            </div>
          ) : (
            <button
              style={loading ? styles.buttonDisabled : styles.button}
              onClick={postComment}
              disabled={loading}
            >
              {loading ? 'Posting...' : 'Post to PR Comment'}
            </button>
          )}

          <details style={{ marginTop: '1.5rem' }}>
            <summary style={{ cursor: 'pointer', marginBottom: '0.5rem' }}>
              View Raw Attestation Block
            </summary>
            <pre style={styles.pre}>
{`---BEGIN HAP_ATTESTATION v=1---
profile=deploy-gate@0.2
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
          <a href="http://localhost:3001" style={{ color: '#1976d2' }}>
            http://localhost:3001
          </a>
          {' | '}
          <a href="http://localhost:3001/prod" style={{ color: '#1976d2' }}>
            /prod
          </a>
          {' | '}
          <a href="http://localhost:3001/api/sp/pubkey" style={{ color: '#1976d2' }}>
            /api/sp/pubkey
          </a>
        </p>
      </footer>
    </main>
  );
}
