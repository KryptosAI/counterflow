const fs = require('fs');
const path = require('path');

function loadEnvFile() {
  const candidates = [
    path.join(process.cwd(), '.env'),
    path.join(__dirname, '..', '..', '.env'),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const lines = fs.readFileSync(p, 'utf-8').split('\n');
    for (const line of lines) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2].replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

loadEnvFile();

const deepseekKey = process.env.DEEPSEEK_API_KEY || null;
const openaiKey = process.env.OPENAI_API_KEY || null;
const cloudKey = deepseekKey || openaiKey;

const LLM_CONFIG = {
  cloudProvider: deepseekKey ? 'deepseek' : (openaiKey ? 'openai' : null),
  cloudEndpoint: deepseekKey
    ? 'https://api.deepseek.com/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions',
  cloudModel: deepseekKey
    ? (process.env.DEEPSEEK_MODEL || 'deepseek-chat')
    : (process.env.OPENAI_MODEL || 'gpt-4o-mini'),
  enabled: !!cloudKey,
  timeout: parseInt(process.env.LLM_TIMEOUT || '60000'),
  temperature: 0,
};

function extractJSON(text) {
  const cleaned = text.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) return null;
  try { return JSON.parse(cleaned.substring(firstBrace, lastBrace + 1)); }
  catch { return null; }
}

async function callLLM(systemPrompt, userPrompt) {
  if (!LLM_CONFIG.enabled) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LLM_CONFIG.timeout);
    const resp = await fetch(LLM_CONFIG.cloudEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cloudKey}`,
      },
      body: JSON.stringify({
        model: LLM_CONFIG.cloudModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: LLM_CONFIG.temperature,
        max_tokens: 2048,
        stream: false,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const data = await resp.json();
    const usage = data.usage || {};
    return {
      content: data.choices?.[0]?.message?.content || null,
      provider: LLM_CONFIG.cloudProvider,
      model: LLM_CONFIG.cloudModel,
      inputTokens: usage.prompt_tokens || 0,
      outputTokens: usage.completion_tokens || 0,
    };
  } catch {
    return null;
  }
}

module.exports = { callLLM, extractJSON, LLM_CONFIG };
