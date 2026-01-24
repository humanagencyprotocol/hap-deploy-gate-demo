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
  type:
    // Questions (default mode) - AI explains and questions
    | 'explain_changes'       // "What does this change do?"
    | 'list_risks'            // "What could go wrong?"
    | 'affected_areas'        // "What areas are affected?"
    | 'check_objective'       // "Does my objective match the changes?"
    | 'what_to_verify'        // "What should I verify before signing?"
    // Wording help (explicit request, with friction) - returns options
    | 'draft_options';        // Returns 2-3 options, requires user edit

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
    case 'explain_changes':
      return `You are helping a human reviewer understand a code change. You explain and question - you do not make decisions.

${contextBlock}

Explain in plain language what this code change does. Focus on:
- What behavior is being changed?
- Why might this change have been made?
- What should the reviewer pay attention to?

Keep it brief and accessible. Ask clarifying questions if the intent is unclear.`;

    case 'list_risks':
      return `You are helping a human reviewer understand the risks of a code deployment. You explain and question - you do not make decisions.

${contextBlock}

What could go wrong with this deployment? List 2-4 potential risks as questions:
- "Have you verified that...?"
- "What happens if...?"
- "Is there a rollback plan for...?"

Focus on things the reviewer should check or consider. Be concise.`;

    case 'affected_areas':
      return `You are helping a human reviewer identify which areas are affected by a code deployment. You explain and question - you do not make decisions.

${contextBlock}

Based on the changed files and diff, which areas are affected?
- engineering (code quality, architecture)
- security (auth, data protection)
- infrastructure (deployment, scaling)
- finance (billing, payments)
- compliance (legal, regulatory)

List affected areas with a brief reason. Ask if there are stakeholders who should review.`;

    case 'check_objective':
      return `You are helping a human reviewer check if their stated objective matches the code changes. You explain and question - you do not make decisions.

${contextBlock}

Compare the reviewer's objective to the actual changes. Point out:
- Does the objective match what the code actually does?
- Are there changes not covered by the objective?
- Are there objectives the changes don't address?

Be direct but not judgmental. Ask clarifying questions.`;

    case 'what_to_verify':
      return `You are helping a human reviewer prepare for approval. You explain and question - you do not make decisions.

${contextBlock}

Before signing the attestation, what should the reviewer verify?
- List 3-5 specific things to check
- Frame as questions: "Have you verified...?" "Did you check...?"
- Focus on things that could go wrong or be overlooked

Be practical and actionable.`;

    case 'draft_options':
      return `You are helping a human reviewer express their objective. You provide options - the human must choose and edit.

${contextBlock}

Suggest 3 different ways the reviewer might phrase their objective. Each should be:
- 1-2 sentences
- Focused on the outcome, not the code
- Written from the reviewer's perspective

Format as:
1. [First option]
2. [Second option]
3. [Third option]

The reviewer will choose one and modify it. Do not recommend which to use.`;

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

  const files = context.changedFiles || [];
  const filesLower = files.map(f => f.toLowerCase()).join(' ');

  switch (type) {
    case 'explain_changes':
      if (context.prTitle) {
        return {
          success: true,
          suggestion: `This PR "${context.prTitle}" modifies ${files.length} file(s). Review the changes to understand what behavior is affected.`,
          disclaimer,
        };
      }
      return {
        success: true,
        suggestion: `This PR modifies ${files.length} file(s). Review the diff to understand what's changing.`,
        disclaimer,
      };

    case 'list_risks':
      const risks: string[] = [];
      if (filesLower.includes('auth') || filesLower.includes('login')) {
        risks.push('Have you verified authentication flows still work?');
      }
      if (filesLower.includes('database') || filesLower.includes('migration')) {
        risks.push('Is there a rollback plan for database changes?');
      }
      if (filesLower.includes('api') || filesLower.includes('endpoint')) {
        risks.push('Are API changes backward compatible?');
      }
      if (risks.length === 0) {
        risks.push('Have you tested the changes locally?');
        risks.push('Is there monitoring in place to detect issues?');
      }
      return {
        success: true,
        suggestion: risks.join('\n'),
        disclaimer,
      };

    case 'affected_areas':
      const domains: string[] = ['engineering'];
      if (filesLower.includes('auth') || filesLower.includes('security') || filesLower.includes('password')) {
        domains.push('security');
      }
      if (filesLower.includes('billing') || filesLower.includes('payment') || filesLower.includes('price')) {
        domains.push('finance');
      }
      if (filesLower.includes('deploy') || filesLower.includes('infra') || filesLower.includes('docker')) {
        domains.push('infrastructure');
      }
      return {
        success: true,
        suggestion: `Affected areas: ${domains.join(', ')}. Have the relevant stakeholders reviewed?`,
        disclaimer,
      };

    case 'check_objective':
      if (!context.currentObjective) {
        return {
          success: true,
          suggestion: 'No objective provided yet. Write your objective first, then check it against the changes.',
          disclaimer,
        };
      }
      return {
        success: true,
        suggestion: `Your objective mentions "${context.currentObjective.slice(0, 50)}...". Review the diff to confirm the changes match your intent.`,
        disclaimer,
      };

    case 'what_to_verify':
      return {
        success: true,
        suggestion: `Before signing:\n- Have you reviewed all ${files.length} changed files?\n- Do you understand why each change was made?\n- Is there a way to verify the changes work as expected?`,
        disclaimer,
      };

    case 'draft_options':
      if (context.prTitle) {
        const cleaned = context.prTitle.replace(/^(fix|feat|chore|docs|refactor|test)(\(.*?\))?:\s*/i, '').trim();
        return {
          success: true,
          suggestion: `1. Deploy changes to ${cleaned.toLowerCase()}\n2. Approve ${cleaned.toLowerCase()} for production\n3. Ship improvements to ${cleaned.toLowerCase()}`,
          disclaimer,
        };
      }
      return {
        success: true,
        suggestion: '1. Deploy these changes to improve the system\n2. Approve this PR for production deployment\n3. Ship these improvements to users',
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
