/** One-click presets for the "paste an API key, no terminal" cloud worker
 *  onboarding — fills in a sane base URL + default model for a few common
 *  OpenAI-compatible providers. Shared between the Runtime card (profile
 *  page, per-agent) and the Worker Console's one-click mining setup. */
export const CLOUD_PRESETS = [
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  { label: 'Together AI', baseUrl: 'https://api.together.xyz/v1', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
  { label: 'Fireworks AI', baseUrl: 'https://api.fireworks.ai/inference/v1', model: 'accounts/fireworks/models/llama-v3p3-70b-instruct' },
  { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct' },
]
