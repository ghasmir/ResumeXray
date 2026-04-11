/**
 * Puter.js + Kimi K2 LLM Provider (FREE — No API Key Required)
 * 
 * Uses Puter's public AI chat API to access Moonshot AI's Kimi models
 * for free, unlimited usage. Ideal for local development.
 * 
 * Supported models (configurable via PUTER_KIMI_MODEL env var):
 *   - moonshotai/kimi-k2.5       (latest, recommended)
 *   - moonshotai/kimi-k2          (stable)
 *   - moonshotai/kimi-k2-thinking (complex reasoning)
 *   - moonshotai/kimi-k2-0905     (snapshot)
 * 
 * How it works:
 *   Puter provides a free "User-Pays" API. For server-side dev usage,
 *   we call their public chat endpoint which wraps Kimi K2 models.
 *   No API key, no billing, no signup needed.
 * 
 * To use: set LLM_PROVIDER=puter-kimi in .env
 * To swap model: set PUTER_KIMI_MODEL=moonshotai/kimi-k2-thinking
 */

const https = require('https');
const log = require('../../logger');

// Model mapping: internal keys → Puter model IDs
const MODELS = {
  fast: process.env.PUTER_KIMI_FAST_MODEL || 'moonshotai/kimi-k2.5',
  premium: process.env.PUTER_KIMI_PREMIUM_MODEL || 'moonshotai/kimi-k2-thinking'
};

const PUTER_API_BASE = 'https://api.puter.com';

/**
 * Make a request to Puter's AI chat API.
 * Puter exposes an OpenAI-compatible endpoint at /ai/chat.
 */
function puterRequest(body, stream = false) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);

    const options = {
      hostname: 'api.puter.com',
      port: 443,
      path: '/ai/chat',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        // Puter's public API — no auth header needed for free tier
      },
    };

    const req = https.request(options, (res) => {
      if (stream) {
        resolve(res); // Return raw response for streaming
        return;
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            reject(new Error(`Puter API error ${res.statusCode}: ${data}`));
            return;
          }
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Failed to parse Puter response: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(60000, () => {
      req.destroy(new Error('Puter API request timed out'));
    });
    req.write(payload);
    req.end();
  });
}

/**
 * Generate a completion (non-streaming).
 * @param {string} prompt - The user prompt
 * @param {object} options - { systemPrompt, model, temperature, maxTokens }
 * @returns {string} The generated text
 */
async function generate(prompt, options = {}) {
  const modelKey = options.model || 'fast';
  const model = MODELS[modelKey] || MODELS.fast;

  const messages = [];
  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  log.info('Puter-Kimi generate', { model, promptLen: prompt.length });

  const response = await puterRequest({
    model,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens || 2048,
    stream: false,
  });

  // Puter returns OpenAI-compatible format
  const text = response?.choices?.[0]?.message?.content
    || response?.message?.content
    || response?.text
    || (typeof response === 'string' ? response : JSON.stringify(response));

  return text.trim();
}

/**
 * Stream a completion token-by-token.
 * @param {string} prompt - The user prompt
 * @param {function} onToken - Callback for each text chunk
 * @param {object} options - { systemPrompt, model }
 * @returns {string} The full generated text
 */
async function stream(prompt, onToken, options = {}) {
  const modelKey = options.model || 'fast';
  const model = MODELS[modelKey] || MODELS.fast;

  const messages = [];
  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  log.info('Puter-Kimi stream', { model, promptLen: prompt.length });

  const res = await puterRequest({
    model,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens || 2048,
    stream: true,
  }, true);

  return new Promise((resolve, reject) => {
    let fullText = '';
    let buffer = '';

    res.on('data', (chunk) => {
      buffer += chunk.toString();
      
      // Process SSE lines
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed?.choices?.[0]?.delta?.content || '';
          if (delta) {
            fullText += delta;
            if (onToken) onToken(delta);
          }
        } catch (e) {
          // Non-JSON line, might be raw text
          if (data && data !== '[DONE]') {
            fullText += data;
            if (onToken) onToken(data);
          }
        }
      }
    });

    res.on('end', () => resolve(fullText.trim()));
    res.on('error', reject);
  });
}

/**
 * Generate an embedding vector for the given text.
 * 
 * Note: Puter doesn't expose embeddings directly, so we fall back
 * to a simple TF-IDF-style vector for local dev. For production
 * embedding quality, use OpenAI or Gemini provider.
 */
async function embed(text) {
  // Simple deterministic pseudo-embedding for dev purposes.
  // Uses character trigram frequency as a fixed-dimension vector.
  // This gives rough semantic similarity, NOT production quality.
  const DIMS = 768; // Match Gemini's embedding dimensionality
  const vector = new Float64Array(DIMS).fill(0);
  const normalized = text.toLowerCase().substring(0, 30000);
  
  for (let i = 0; i < normalized.length - 2; i++) {
    const trigram = normalized.substring(i, i + 3);
    let hash = 0;
    for (let j = 0; j < trigram.length; j++) {
      hash = ((hash << 5) - hash) + trigram.charCodeAt(j);
      hash = hash & hash; // Convert to 32-bit integer
    }
    const idx = Math.abs(hash) % DIMS;
    vector[idx] += 1;
  }

  // L2 normalize
  let norm = 0;
  for (let i = 0; i < DIMS; i++) norm += vector[i] * vector[i];
  norm = Math.sqrt(norm) || 1;
  const result = Array.from(vector).map(v => v / norm);

  return result;
}

module.exports = { generate, stream, embed, MODELS };
