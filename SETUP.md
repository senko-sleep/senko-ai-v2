# Senko AI - Setup

## Architecture

One single API endpoint handles everything: `/api/chat`

```
Browser  -->  /api/chat  -->  Groq (primary, ~500 tok/s, instant)
                         -->  Ollama (fallback, local, offline)
```

No separate services to manage. No secondary components. One route does it all.

## Quick Start

```bash
npm run dev
```

Open http://localhost:3000

## AI Providers

### Option A: Groq (Recommended - Fastest)

Groq runs LLMs on custom hardware at ~500 tokens/sec. Responses feel instant.

1. Get a free API key at https://console.groq.com/keys
2. Add it to `.env.local`:

```
GROQ_API_KEY=gsk_your_key_here
GROQ_MODEL=llama-3.3-70b-versatile
```

3. Restart the dev server. Done.

### Option B: Ollama (Offline Fallback)

If Groq is unavailable or you want offline mode, Ollama runs locally.

1. Install from https://ollama.com/download
2. Pull a model: `ollama pull mistral`
3. It auto-starts. The API will use it as fallback.

### Automatic Failover

- If `GROQ_API_KEY` is set: Groq first, Ollama fallback
- If `GROQ_API_KEY` is empty: Ollama only
- If both are down: Error message

## Config (.env.local)

```
# Primary - Groq cloud inference (instant speed)
GROQ_API_KEY=
GROQ_MODEL=llama-3.3-70b-versatile

# Fallback - Local Ollama
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=mistral
```
