// Senko AI config - runtime env access
// Uses dynamic property access to prevent Next.js from inlining process.env at build time

function env(key: string, fallback: string): string {
  return (process.env[key] || fallback).trim();
}

export const config = {
  get groqApiKey() { return env("GROQ_API_KEY", ""); },
  get groqModel() { return env("GROQ_MODEL", "llama-3.1-8b-instant"); },
  groqUrl: "https://api.groq.com/openai/v1/chat/completions",
  get ollamaUrl() { return env("OLLAMA_URL", "http://localhost:11434"); },
  get ollamaModel() { return env("OLLAMA_MODEL", "mistral"); },
};
