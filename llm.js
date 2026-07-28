/**
 * DeepSeek chat helper (deepseek-v4-flash by default).
 * API key from DEEPSEEK_API_KEY env only.
 */
const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions';

function getApiKey() {
  return String(process.env.DEEPSEEK_API_KEY || '').trim();
}

async function chat(messages, options = {}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY not set');
  }
  const model = options.model || DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs || 90000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature != null ? options.temperature : 0.4,
        max_tokens: options.maxTokens || 4096
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = data.error?.message || data.message || JSON.stringify(data).slice(0, 300);
      throw new Error(`DeepSeek ${res.status}: ${detail}`);
    }
    const text = data.choices?.[0]?.message?.content || '';
    if (!text) throw new Error('DeepSeek empty response');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function extractJson(text) {
  const raw = String(text || '').trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1].trim() : raw;
  const aStart = body.indexOf('[');
  const aEnd = body.lastIndexOf(']');
  const oStart = body.indexOf('{');
  const oEnd = body.lastIndexOf('}');
  // Prefer array when it appears before (or without relying on) object slice —
  // otherwise `[ {...}, {...} ]` is wrongly sliced as `{...},{...}` and fails.
  if (aStart >= 0 && aEnd > aStart && (oStart < 0 || aStart <= oStart)) {
    return JSON.parse(body.slice(aStart, aEnd + 1));
  }
  if (oStart >= 0 && oEnd > oStart) {
    return JSON.parse(body.slice(oStart, oEnd + 1));
  }
  return JSON.parse(body);
}

module.exports = { chat, extractJson, getApiKey, DEFAULT_MODEL };
