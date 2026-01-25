/**
 * Local AI Client - Advisory Only
 *
 * AI may surface reality, but it may not supply intent.
 * Humans must author every commitment.
 *
 * PERMISSIONS MODEL:
 * ✅ readSemanticInputs: true  - Can read objectives, diffs, descriptions
 * ❌ writeFrame: false          - Cannot modify frame fields
 * ❌ triggerAttestation: false  - Cannot initiate signing
 * ❌ influenceExecution: false  - Cannot affect what gets executed
 *
 * RESPONSE FORMAT (non-negotiable):
 * AI must respond only using structured blocks:
 * - Observations: Neutral facts from the diff
 * - Questions: Prompts for the human to think
 * - Considerations: Non-prescriptive risk surfacing
 * - Warnings: Only when mismatch is detected
 *
 * FORBIDDEN:
 * - "You should write..."
 * - "The objective should be..."
 * - "I recommend choosing..."
 * - Any sentence starting with "You should"
 */

export interface LocalAIConfig {
  endpoint: string;
  model: string;
  apiKey?: string;
  provider: 'ollama' | 'openai-compatible';
  enabled: boolean;
}

export interface LocalAIPermissions {
  readSemanticInputs: true;
  writeFrame: false;
  triggerAttestation: false;
  influenceExecution: false;
}

export const LOCAL_AI_PERMISSIONS: LocalAIPermissions = {
  readSemanticInputs: true,
  writeFrame: false,
  triggerAttestation: false,
  influenceExecution: false,
};

export const DEFAULT_AI_CONFIG: LocalAIConfig = {
  endpoint: 'http://localhost:11434',
  model: 'llama3.2',
  provider: 'ollama',
  enabled: false,
};

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
    // Gate-specific checks (structured response format)
    | 'check_problem'      // Help understand what changed and where
    | 'check_objective'    // Detect drift between intent and changes
    | 'check_tradeoffs'    // Surface risks and consequences
    // Execution path explanation only
    | 'explain_path';      // Explain implications of execution path (no recommendations)

  context: {
    prTitle?: string;
    prDescription?: string;
    diffSummary?: string;
    changedFiles?: string[];
    // Gate-specific text
    problemText?: string;
    objectiveText?: string;
    tradeoffsText?: string;
    executionPath?: 'canary' | 'full';
  };
}

export interface AIAssistanceResponse {
  success: boolean;
  suggestion?: string;
  error?: string;
  disclaimer: string;
}

/**
 * Check if AI is available
 */
export async function checkAIAvailability(config: LocalAIConfig): Promise<boolean> {
  if (!config.enabled) return false;

  try {
    if (config.provider === 'ollama') {
      const response = await fetch(`${config.endpoint}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } else {
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
  const disclaimer = 'AI surfaces reality. You supply intent.';

  if (!config.enabled) {
    return {
      success: false,
      error: 'AI is not enabled',
      disclaimer,
    };
  }

  const { systemPrompt, userPrompt } = buildPrompt(request);

  try {
    let suggestion: string;

    if (config.provider === 'ollama') {
      const response = await fetch(`${config.endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          prompt: `${systemPrompt}\n\n${userPrompt}`,
          stream: false,
          options: {
            temperature: 0.7,
            num_predict: 600,
          },
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        throw new Error(`AI request failed: ${response.status}`);
      }

      const data = await response.json();
      suggestion = data.response?.trim() || 'No response generated.';
    } else {
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
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.7,
          max_tokens: 600,
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AI request failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      suggestion = data.choices?.[0]?.message?.content?.trim() || 'No response generated.';
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
 * Build gate-specific prompts
 * Each gate has a different purpose and constraint set
 */
function buildPrompt(request: AIAssistanceRequest): { systemPrompt: string; userPrompt: string } {
  const { type, context } = request;

  const contextBlock = `
PR Title: ${context.prTitle || 'Not provided'}
PR Description: ${context.prDescription || 'Not provided'}
Changed Files: ${context.changedFiles?.join(', ') || 'Not provided'}
Diff Summary:
${context.diffSummary || 'Not provided'}
`.trim();

  // Response format instruction (used in all prompts)
  const responseFormat = `
RESPONSE FORMAT (required):
You must respond using ONLY these structured blocks:

**Observation**
[Neutral fact derived from the diff]

**Question**
[Prompt for the human to think]

**Consideration**
[Non-prescriptive risk or consequence]

**Warning**
[Only when clear mismatch is detected]

FORBIDDEN:
- Never say "You should write..."
- Never say "I recommend..."
- Never suggest wording for any field
- Never tell the user what to decide
`.trim();

  switch (type) {
    case 'check_problem':
      return {
        systemPrompt: `You are assisting a human reviewer.
Your role is to help them understand the code change.

Given the diff:
- Identify affected components or domains
- Describe where the problem likely surfaces
- Ask clarifying questions

Do NOT:
- Propose wording for the problem statement
- Judge correctness
- Suggest approval or rejection
- Infer intent

${responseFormat}`,
        userPrompt: `${contextBlock}

${context.problemText ? `The reviewer has written this problem statement:\n"${context.problemText}"` : 'The reviewer has not yet written a problem statement.'}

Help them understand what is actually changing and where the problem manifests.`,
      };

    case 'check_objective':
      return {
        systemPrompt: `You are checking alignment between a human-stated objective and a code diff.

Compare the objective to the diff.
- Identify areas of alignment
- Identify areas that may be unrelated or missing
- Ask questions if intent is unclear

Do NOT:
- Suggest a better objective
- Rewrite the objective
- Block progress

If misalignment is detected, raise a Warning.

${responseFormat}`,
        userPrompt: `${contextBlock}

The reviewer's stated objective:
"${context.objectiveText || 'Not provided'}"

Check if the objective aligns with the actual code changes.`,
      };

    case 'check_tradeoffs':
      return {
        systemPrompt: `You are helping a human reflect on tradeoffs.

Given:
- The code diff
- The selected execution path
- The stated tradeoffs text

Surface:
- Risks implied by the execution path
- Potential downsides not explicitly acknowledged

Do NOT:
- Recommend an execution path
- Suggest wording
- Evaluate acceptability

Respond using Considerations or Warnings only.

${responseFormat}`,
        userPrompt: `${contextBlock}

Execution Path: ${context.executionPath || 'Not selected'}
${context.executionPath === 'full' ? '(Full = immediate rollout, higher risk)' : '(Canary = gradual rollout, reduced blast radius)'}

The reviewer's stated tradeoffs:
"${context.tradeoffsText || 'Not provided'}"

Help surface risks and consequences they should consider.`,
      };

    case 'explain_path':
      return {
        systemPrompt: `You are explaining execution path implications.

You may:
- Explain what each path means
- Describe risk profiles

You must NOT:
- Recommend which path to choose
- Influence the decision

${responseFormat}`,
        userPrompt: `${contextBlock}

The reviewer is considering: ${context.executionPath || 'not yet selected'}

Explain the implications of the execution paths available (Canary vs Full).
Do not make a recommendation.`,
      };

    default:
      return {
        systemPrompt: 'You are a code review assistant. Be helpful and concise.',
        userPrompt: contextBlock,
      };
  }
}

/**
 * Fallback when no AI is available - uses simple heuristics
 */
export function getFallbackAssistance(request: AIAssistanceRequest): AIAssistanceResponse {
  const { type, context } = request;
  const disclaimer = 'Heuristic-based (no AI). Enable AI for better assistance.';

  const files = context.changedFiles || [];
  const filesLower = files.map(f => f.toLowerCase()).join(' ');

  switch (type) {
    case 'check_problem': {
      const observations: string[] = [];

      if (files.length > 0) {
        observations.push(`**Observation**\nThis change modifies ${files.length} file(s): ${files.slice(0, 3).join(', ')}${files.length > 3 ? '...' : ''}`);
      }

      if (filesLower.includes('auth') || filesLower.includes('login')) {
        observations.push('**Observation**\nAuthentication-related files are affected.');
      }
      if (filesLower.includes('api') || filesLower.includes('endpoint')) {
        observations.push('**Observation**\nAPI endpoints are modified.');
      }

      observations.push('**Question**\nWhere does this problem surface for users?');

      return {
        success: true,
        suggestion: observations.join('\n\n'),
        disclaimer,
      };
    }

    case 'check_objective': {
      if (!context.objectiveText) {
        return {
          success: true,
          suggestion: '**Question**\nWhat outcome are you trying to achieve with this change?',
          disclaimer,
        };
      }

      const response: string[] = [];
      response.push(`**Observation**\nYour objective mentions: "${context.objectiveText.slice(0, 60)}${context.objectiveText.length > 60 ? '...' : ''}"`);
      response.push(`**Question**\nDoes every changed file contribute to this objective?`);

      if (files.length > 5) {
        response.push('**Consideration**\nThis change touches many files. Ensure the scope matches your stated intent.');
      }

      return {
        success: true,
        suggestion: response.join('\n\n'),
        disclaimer,
      };
    }

    case 'check_tradeoffs': {
      const response: string[] = [];

      if (context.executionPath === 'full') {
        response.push('**Consideration**\nA full rollout increases blast radius if something goes wrong.');
        response.push('**Question**\nIs there a rollback plan if issues are detected?');
      } else {
        response.push('**Consideration**\nCanary deployment reduces risk but delays full availability.');
      }

      if (filesLower.includes('database') || filesLower.includes('migration')) {
        response.push('**Warning**\nDatabase changes detected. These may be difficult to roll back.');
      }

      if (!context.tradeoffsText) {
        response.push('**Question**\nWhat downsides are you accepting by making this change?');
      }

      return {
        success: true,
        suggestion: response.join('\n\n'),
        disclaimer,
      };
    }

    case 'explain_path':
      return {
        success: true,
        suggestion: `**Observation**
Canary: Gradual rollout to a subset of users first. Lower risk, slower full deployment.

**Observation**
Full: Immediate deployment to all users. Faster availability, higher blast radius if issues occur.

**Question**
What is the acceptable risk level for this change?`,
        disclaimer,
      };

    default:
      return {
        success: false,
        error: 'Unknown request type',
        disclaimer,
      };
  }
}
