const { TOOL_DEFINITIONS } = require('./earningsTools');

const PROVIDERS = {
  deepseek: {
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    baseUrl: () => process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
  },
  openai: {
    apiKeyEnv: 'OPENAI_API_KEY',
    baseUrl: () => process.env.OPENAI_BASE_URL || 'https://api.openai.com',
    defaultModel: 'gpt-4o-mini',
  },
};

function aiProvider() {
  const p = (process.env.AI_PROVIDER || 'deepseek').toLowerCase();
  return PROVIDERS[p] ? p : 'deepseek';
}

function providerConfig() {
  return PROVIDERS[aiProvider()] || PROVIDERS.deepseek;
}

function aiModel() {
  if (process.env.AI_MODEL) return process.env.AI_MODEL;
  if (aiProvider() === 'anthropic') return 'claude-sonnet-4-20250514';
  return providerConfig().defaultModel;
}

function apiKeyForProvider(name) {
  if (name === 'anthropic') return process.env.ANTHROPIC_API_KEY;
  const cfg = PROVIDERS[name];
  return cfg ? process.env[cfg.apiKeyEnv] : null;
}

function hasLlmCredentials() {
  if (aiProvider() === 'anthropic') return Boolean(process.env.ANTHROPIC_API_KEY);
  return Boolean(apiKeyForProvider(aiProvider()));
}

function openAiTools() {
  return TOOL_DEFINITIONS.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

function anthropicTools() {
  return TOOL_DEFINITIONS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

/** OpenAI-compatible chat completions (Deepseek, OpenAI). */
async function callOpenAiCompatible(messages, { baseUrl, apiKey }) {
  const root = String(baseUrl).replace(/\/$/, '');
  const url = root.endsWith('/v1') ? `${root}/chat/completions` : `${root}/v1/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: aiModel(),
      messages,
      tools: openAiTools(),
      tool_choice: 'auto',
      temperature: 0.3,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || res.statusText;
    throw new Error(msg);
  }
  return data.choices?.[0]?.message;
}

async function callChatProvider(messages, system) {
  if (aiProvider() === 'anthropic') {
    return callAnthropic(messages, system);
  }
  const cfg = providerConfig();
  const key = apiKeyForProvider(aiProvider());
  const allMessages = system ? [{ role: 'system', content: system }, ...messages] : messages;
  return callOpenAiCompatible(allMessages, { baseUrl: cfg.baseUrl(), apiKey: key });
}

async function callAnthropic(messages, system) {
  const key = process.env.ANTHROPIC_API_KEY;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: aiModel(),
      max_tokens: 4096,
      system,
      messages: messages.filter((m) => m.role !== 'system'),
      tools: anthropicTools(),
      temperature: 0.3,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || res.statusText);
  return data;
}

/**
 * One planner step: returns tool calls [{ name, arguments }] or null when done.
 */
async function plannerStep({ messages, system }) {
  if (!hasLlmCredentials()) return { done: true, reason: 'no_credentials' };

  if (aiProvider() === 'anthropic') {
    const data = await callAnthropic(messages, system);
    const blocks = data.content || [];
    const toolUses = blocks.filter((b) => b.type === 'tool_use');
    if (toolUses.length) {
      return {
        done: false,
        toolCalls: toolUses.map((t) => ({ name: t.name, arguments: t.input || {} })),
        assistantContent: blocks,
        raw: data,
      };
    }
    const text = blocks.find((b) => b.type === 'text')?.text || '';
    return { done: true, text, raw: data };
  }

  const msg = await callChatProvider(messages, system);
  if (msg?.tool_calls?.length) {
    return {
      done: false,
      toolCalls: msg.tool_calls.map((tc) => ({
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments || '{}'),
        id: tc.id,
      })),
      assistantMessage: msg,
    };
  }
  return { done: true, text: msg?.content || '', assistantMessage: msg };
}

function appendToolResults(messages, step, results) {
  if (aiProvider() === 'anthropic') {
    messages.push({ role: 'assistant', content: step.assistantContent });
    messages.push({
      role: 'user',
      content: results.map((r) => ({
        type: 'tool_result',
        tool_use_id: r.toolUseId,
        content: JSON.stringify(r.output),
      })),
    });
    return messages;
  }

  messages.push(step.assistantMessage);
  for (const r of results) {
    messages.push({
      role: 'tool',
      tool_call_id: r.toolCallId,
      content: JSON.stringify(r.output),
    });
  }
  return messages;
}

module.exports = {
  aiProvider,
  aiModel,
  hasLlmCredentials,
  providerConfig,
  apiKeyForProvider,
  plannerStep,
  appendToolResults,
};
