# Senko AI v2 - Setup Guide

## Architecture

```
Browser  -->  /api/chat    -->  Groq (primary, ~500 tok/s)
                           -->  Ollama (fallback, local)
         -->  /api/search  -->  DuckDuckGo (web search)
         -->  /api/scrape  -->  Page content extraction
```

The frontend parses AI responses for action tags (`[ACTION:OPEN_URL:...]`, `[ACTION:SEARCH:...]`, etc.) and executes them automatically.

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure AI Provider

Create `.env.local`:

```env
# Primary - Groq cloud inference (recommended, instant speed)
GROQ_API_KEY=gsk_your_key_here
GROQ_MODEL=llama-3.3-70b-versatile

# Fallback - Local Ollama (optional, offline mode)
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=mistral
```

**Groq** (recommended): Get a free key at [console.groq.com/keys](https://console.groq.com/keys). Runs at ~500 tokens/sec.

**Ollama** (optional fallback): Install from [ollama.com](https://ollama.com/download), then `ollama pull mistral`.

### 3. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## How It Works

### Action System
The AI outputs special tags in its responses that the frontend intercepts:

| Action | Tag | Example |
|--------|-----|---------|
| Open URL | `[ACTION:OPEN_URL:url]` | Opens a page in the browser |
| Web Search | `[ACTION:SEARCH:query]` | Searches DuckDuckGo, shows source pills |
| Open Result | `[ACTION:OPEN_RESULT:N]` | Opens the Nth search result |
| Show Image | `[ACTION:IMAGE:url\|alt]` | Displays an image inline |

### Page Scraping Flow
1. AI opens a page via action tag
2. Frontend scrapes the page via `/api/scrape`
3. Ghost thinking messages show progress (*reading site...*, *summarizing...*)
4. AI streams a summary with the source pill attached

### Failover
- `GROQ_API_KEY` set: Groq first, Ollama fallback
- `GROQ_API_KEY` empty: Ollama only
- Both down: Error message in chat
