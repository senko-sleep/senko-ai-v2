// Senko AI config - runtime env access
// Uses dynamic property access to prevent Next.js from inlining process.env at build time

function env(key: string, fallback: string): string {
  return (process.env[key] || fallback).trim();
}

export const config = {
  get groqApiKey() { return env("GROQ_API_KEY", ""); },
  get groqModel() { return env("GROQ_MODEL", "llama-3.3-70b-versatile"); },
  groqUrl: "https://api.groq.com/openai/v1/chat/completions",
  get ollamaUrl() { return env("OLLAMA_URL", "http://localhost:11434"); },
  get ollamaModel() { return env("OLLAMA_MODEL", "mistral"); },
  
  // Render.com search API (primary — runs Puppeteer + multi-engine scraping)
  get searchApiUrl() { return env("SEARCH_API_URL", ""); },
  
  // Search API keys (optional fallbacks if Render API is down)
  get serperApiKey() { return env("SERPER_API_KEY", ""); },
  get scraperApiKey() { return env("SCRAPER_API_KEY", ""); },
  
  // Puppeteer config (for browser-based scraping fallback)
  get puppeteerUrl() { return env("PUPPETEER_URL", ""); },
  get puppeteerWsEndpoint() { return env("PUPPETEER_WS_ENDPOINT", ""); },
  get puppeteerExecutablePath() { return env("PUPPETEER_EXECUTABLE_PATH", ""); },
  
  // Search cascade settings
  get searchTimeout() { return parseInt(env("SEARCH_TIMEOUT", "10000")); },
  get searchMaxResults() { return parseInt(env("SEARCH_MAX_RESULTS", "10")); },
  get searchMaxRetries() { return parseInt(env("SEARCH_MAX_RETRIES", "3")); },
  get searchBackoffBase() { return parseInt(env("SEARCH_BACKOFF_BASE", "1000")); },
  get searchBackoffMax() { return parseInt(env("SEARCH_BACKOFF_MAX", "15000")); },
};
