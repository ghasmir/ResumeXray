/**
 * OpenAI LLM Provider
 * Implements the standard provider interface: generate() and stream().
 * 
 * Hybrid model strategy:
 *   - gpt-4o-mini: Fast extraction, mapping, analysis (cheap)
 *   - gpt-4o: High-quality CAR bullet rewrites (premium)
 */

const OpenAI = require('openai');

let client = null;

const MODELS = {
  fast: 'gpt-4o-mini',
  premium: 'gpt-4o'
};

function getClient() {
  if (!client && process.env.OPENAI_API_KEY) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

/**
 * Generate a completion (non-streaming).
 * @param {string} prompt - The user prompt
 * @param {object} options - { systemPrompt, model, temperature, maxTokens }
 * @returns {string} The generated text
 */
async function generate(prompt, options = {}) {
  const c = getClient();
  if (!c) throw new Error('OpenAI API not configured. Set OPENAI_API_KEY in .env');

  const modelKey = options.model || 'fast';
  const model = MODELS[modelKey] || MODELS.fast;

  const messages = [];
  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const response = await c.chat.completions.create({
    model,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens || 2048,
  });

  return response.choices[0]?.message?.content?.trim() || '';
}

/**
 * Stream a completion token-by-token.
 * @param {string} prompt - The user prompt
 * @param {function} onToken - Callback for each text chunk
 * @param {object} options - { systemPrompt, model, temperature, maxTokens }
 * @returns {string} The full generated text
 */
async function stream(prompt, onToken, options = {}) {
  const c = getClient();
  if (!c) throw new Error('OpenAI API not configured. Set OPENAI_API_KEY in .env');

  const modelKey = options.model || 'fast';
  const model = MODELS[modelKey] || MODELS.fast;

  const messages = [];
  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const streamResponse = await c.chat.completions.create({
    model,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens || 2048,
    stream: true,
  });

  let fullText = '';
  for await (const chunk of streamResponse) {
    const delta = chunk.choices[0]?.delta?.content || '';
    if (delta) {
      fullText += delta;
      if (onToken) onToken(delta);
    }
  }

  return fullText.trim();
}

/**
 * Generate an embedding vector for the given text.
 * @param {string} text - The text to embed
 * @returns {number[]} The embedding vector (1536 dimensions)
 */
async function embed(text) {
  const c = getClient();
  if (!c) throw new Error('OpenAI API not configured. Set OPENAI_API_KEY in .env');
  const response = await c.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.substring(0, 30000),
  });
  return response.data[0].embedding;
}

module.exports = { generate, stream, embed, MODELS };
