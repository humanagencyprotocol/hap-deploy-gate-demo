/**
 * Local AI Client - Advisory Only
 *
 * This client connects to a local AI (e.g., Ollama) to provide
 * ADVISORY assistance to reviewers. It helps with thinking,
 * not deciding.
 *
 * PERMISSIONS MODEL:
 * ✅ readSemanticInputs: true  - Can read objectives, diffs, descriptions
 * ❌ writeFrame: false          - Cannot modify frame fields
 * ❌ triggerAttestation: false  - Cannot initiate signing
 * ❌ influenceExecution: false  - Cannot affect what gets executed
 *
 * ALLOWED USES:
 * - Help draft objectives
 * - Summarize risk
 * - Highlight missing domains
 * - Assist SDG detection heuristics
 *
 * FORBIDDEN:
 * - Emit Frame keys
 * - Change execution paths
 * - Block execution directly
 * - Learn from outcomes automatically
 *
 * Local AI output is UX-only.
 */

export interface LocalAIConfig {
  endpoint: string; // e.g., http://localhost:11434 for Ollama, https://api.openai.com/v1 for OpenAI
  model: string; // e.g., 'llama2', 'gpt-4', 'claude-3-haiku'
  apiKey?: string; // Optional API key for authenticated providers
  provider: 'ollama' | 'openai-compatible'; // API format to use
  enabled: boolean;
}

export interface LocalAIPermissions {
  readSemanticInputs: true;
  writeFrame: false;
  triggerAttestation: false;
  influenceExecution: false;
}

// Permissions are fixed - cannot be changed
export const LOCAL_AI_PERMISSIONS: LocalAIPermissions = {
  readSemanticInputs: true,
  writeFrame: false,
  triggerAttestation: false,
  influenceExecution: false,
};

// Default config - uses Ollama on localhost
export const DEFAULT_AI_CONFIG: LocalAIConfig = {
  endpoint: 'http://localhost:11434',
  model: 'llama3.2',
  provider: 'ollama',
  enabled: false, // Disabled by default
};

// Example configs for common providers
export const PROVIDER_PRESETS: Record<string, Partial<LocalAIConfig>> = {
  ollama: {
    endpoint: 'http://localhost:11434',
    model: 'llama3.2',
    provider: 'ollama',
  },
  openai: {
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    provider: 'openai-compatible',
  },
  anthropic: {
    endpoint: 'https://api.anthropic.com/v1',
    model: 'claude-3-haiku-20240307',
    provider: 'openai-compatible',
  },
  groq: {
    endpoint: 'https://api.groq.com/openai/v1',
    model: 'llama-3.1-8b-instant',
    provider: 'openai-compatible',
  },
  together: {
    endpoint: 'https://api.together.xyz/v1',
    model: 'meta-llama/Llama-3-8b-chat-hf',
    provider: 'openai-compatible',
  },
};

export interface AIAssistanceRequest {
  type: 'draft_objective' | 'summarize_risk' | 'highlight_domains' | 'explain_diff';
  context: {
    prTitle?: string;
    prDescription?: string;
    diffSummary?: string;
    changedFiles?: string[];
    currentObjective?: string;
  };
}

export interface AIAssistanceResponse {
  success: boolean;
  suggestion?: string;
  error?: string;
  disclaimer: string; // Always included to remind user this is advisory
}

/**
 * Check if AI is available
 */
export async function checkAIAvailability(config: LocalAIConfig): Promise<boolean> {
  if (!config.enabled) return false;

  try {
    if (config.provider === 'ollama') {
      // Ollama health check
      const response = await fetch(`${config.endpoint}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } else {
      // OpenAI-compatible: check models endpoint
      const headers: Record<string, string> = {};
      if (config.apiKey) {
        headers['Authorization'] = `Bearer ${config.apiKey}`;
      }
      const response = await fetch(`${config.endpoint}/models`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    }
  } catch {
    return false;
  }
}

/**
 * Get AI assistance - advisory only, never affects protocol
 */
export async function getAIAssistance(
  config: LocalAIConfig,
  request: AIAssistanceRequest
): Promise<AIAssistanceResponse> {
  const disclaimer = 'This is AI-assisted thinking, not a decision. You own the final choice.';

  if (!config.enabled) {
    return {
      success: false,
      error: 'AI is not enabled',
      disclaimer,
    };
  }

  const prompt = buildPrompt(request);

  try {
    let suggestion: string;

    if (config.provider === 'ollama') {
      // Ollama API format
      const response = await fetch(`${config.endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          prompt,
          stream: false,
          options: {
            temperature: 0.7,
            num_predict: 500,
          },
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        throw new Error(`AI request failed: ${response.status}`);
      }

      const data = await response.json();
      suggestion = data.response?.trim() || 'No suggestion generated.';
    } else {
      // OpenAI-compatible API format
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (config.apiKey) {
        headers['Authorization'] = `Bearer ${config.apiKey}`;
      }

      const response = await fetch(`${config.endpoint}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: config.model,
          messages: [
            {
              role: 'system',
              content: 'You are an assistant helping a human reviewer think through a code deployment. Be concise and helpful.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.7,
          max_tokens: 500,
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AI request failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      suggestion = data.choices?.[0]?.message?.content?.trim() || 'No suggestion generated.';
    }

    return {
      success: true,
      suggestion,
      disclaimer,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      disclaimer,
    };
  }
}

/**
 * Build prompt based on request type
 */
function buildPrompt(request: AIAssistanceRequest): string {
  const { type, context } = request;

  const contextBlock = `
Context:
- PR Title: ${context.prTitle || 'Not provided'}
- PR Description: ${context.prDescription || 'Not provided'}
- Changed Files: ${context.changedFiles?.join(', ') || 'Not provided'}
- Diff Summary: ${context.diffSummary || 'Not provided'}
${context.currentObjective ? `- Current Objective Draft: ${context.currentObjective}` : ''}
`.trim();

  switch (type) {
    case 'draft_objective':
      return `You are helping a human reviewer draft their objective for a code deployment.

${contextBlock}

Based on the PR context, suggest a clear, concise objective statement (1-2 sentences) that captures what this deployment aims to achieve.

Important: This is YOUR objective as the reviewer - what do YOU want to accomplish by approving this? Focus on the outcome, not the code changes.

Respond with just the objective statement, nothing else.`;

    case 'summarize_risk':
      return `You are helping a human reviewer understand the risks of a code deployment.

${contextBlock}

Summarize the potential risks of this deployment in 2-3 bullet points. Consider:
- What could go wrong?
- What areas of the system are affected?
- Are there any red flags in the changes?

Be concise and actionable.`;

    case 'highlight_domains':
      return `You are helping a human reviewer identify which organizational domains are affected by a code deployment.

${contextBlock}

Based on the changed files and diff, identify which domains are likely affected:
- engineering (code quality, architecture)
- security (auth, data protection)
- infrastructure (deployment, scaling)
- finance (billing, payments)
- compliance (legal, regulatory)

List only the affected domains with a brief reason for each.`;

    case 'explain_diff':
      return `You are helping a human reviewer understand a code diff.

${contextBlock}

Explain in plain language what this code change does. Focus on:
- What behavior is being changed?
- Why might this change have been made?
- What should the reviewer pay attention to?

Keep it brief and accessible.`;

    default:
      return 'Please provide assistance with the code review.';
  }
}

/**
 * Simple in-browser fallback when no local AI is available
 * Uses basic heuristics, not real AI
 */
export function getFallbackAssistance(request: AIAssistanceRequest): AIAssistanceResponse {
  const { type, context } = request;
  const disclaimer = 'This is a simple heuristic, not AI. Consider enabling local AI for better assistance.';

  switch (type) {
    case 'draft_objective':
      if (context.prTitle) {
        // Simple: use PR title as starting point
        const objective = context.prTitle
          .replace(/^(fix|feat|chore|docs|refactor|test)(\(.*?\))?:\s*/i, '')
          .trim();
        return {
          success: true,
          suggestion: `Deploy changes to ${objective.toLowerCase()}`,
          disclaimer,
        };
      }
      return {
        success: true,
        suggestion: 'Deploy the changes in this PR to improve the system.',
        disclaimer,
      };

    case 'highlight_domains':
      const domains: string[] = ['engineering'];
      const files = context.changedFiles || [];
      const filesLower = files.map(f => f.toLowerCase()).join(' ');

      if (filesLower.includes('auth') || filesLower.includes('security') || filesLower.includes('password')) {
        domains.push('security');
      }
      if (filesLower.includes('billing') || filesLower.includes('payment') || filesLower.includes('price')) {
        domains.push('finance');
      }
      if (filesLower.includes('deploy') || filesLower.includes('infra') || filesLower.includes('docker') || filesLower.includes('k8s')) {
        domains.push('infrastructure');
      }

      return {
        success: true,
        suggestion: `Affected domains: ${domains.join(', ')}`,
        disclaimer,
      };

    default:
      return {
        success: false,
        error: 'Fallback not available for this request type',
        disclaimer,
      };
  }
}
