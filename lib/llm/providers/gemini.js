/**
 * Gemini LLM Provider
 * Implements the standard provider interface: generate() and stream().
 * Extracted from the original lib/gemini.js to fit the abstracted architecture.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

let genAI = null;
let models = {};

const MODELS = {
  fast: 'gemini-2.5-flash',
  premium: 'gemini-2.5-pro'
};

function getModel(modelKey = 'fast') {
  const modelName = MODELS[modelKey] || MODELS.fast;

  if (!genAI && process.env.GEMINI_API_KEY) {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  if (!genAI) return null;

  if (!models[modelName]) {
    models[modelName] = genAI.getGenerativeModel({ model: modelName });
  }
  return models[modelName];
}

/**
 * Generate a completion (non-streaming).
 * @param {string} prompt - The user prompt (system prompt is prepended)
 * @param {object} options - { systemPrompt, model, temperature }
 * @returns {string} The generated text
 */
async function generate(prompt, options = {}) {
  const modelKey = options.model || 'fast';
  const m = getModel(modelKey);
  if (!m) throw new Error('Gemini API not configured. Set GEMINI_API_KEY in .env');

  // Gemini uses a single prompt; prepend system instructions
  const fullPrompt = options.systemPrompt
    ? `${options.systemPrompt}\n\n${prompt}`
    : prompt;

  const result = await m.generateContent(fullPrompt);
  return result.response.text().trim();
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
  const m = getModel(modelKey);
  if (!m) throw new Error('Gemini API not configured. Set GEMINI_API_KEY in .env');

  const fullPrompt = options.systemPrompt
    ? `${options.systemPrompt}\n\n${prompt}`
    : prompt;

  const result = await m.generateContentStream(fullPrompt);
  let fullText = '';
  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) {
      fullText += text;
      if (onToken) onToken(text);
    }
  }
  return fullText.trim();
}

/**
 * Generate an embedding vector for the given text.
 * @param {string} text - The text to embed
 * @returns {number[]} The embedding vector (768 dimensions)
 */
async function embed(text) {
  if (!genAI && process.env.GEMINI_API_KEY) {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  if (!genAI) throw new Error('Gemini API not configured. Set GEMINI_API_KEY in .env');
  const embeddingModel = genAI.getGenerativeModel({ model: 'text-embedding-004' });
  const result = await embeddingModel.embedContent(text.substring(0, 30000));
  return result.embedding.values;
}

module.exports = { generate, stream, embed, MODELS };
