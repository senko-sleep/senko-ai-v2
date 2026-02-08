# Senko AI v2

A cute, expressive AI assistant that can actually *do things* -- open websites, search the web, read pages, and tell you what it found. Built with Next.js, Groq, and a whole lot of personality.

## Features

### Personality
- Cute and expressive -- says "owo", "ooh!", "me eepy", has genuine curiosity
- Talks like a real person, not a robot
- Stays in character across searches, summaries, and actions

### Browser Actions
- **Open URLs** -- "open youtube" actually opens YouTube
- **Web Search** -- "look up how to bake a cake" searches and shows results with source pills
- **Site-Specific Search** -- "go to youtube and search for cat videos" opens YouTube search directly
- **Google Images** -- "google images of anya" opens Google Images
- **Open Results** -- "open the first result" clicks the Nth search result
- **Sequential Commands** -- "search for X and open the first result" chains multiple actions

### Page Reading
- Automatically scrapes and summarizes pages when opened
- Shows source pill with favicon for the page it read
- Ghost thinking messages show the process: *searching...*, *reading site...*, *summarizing...*

### Chat UI
- Clean, no-glow message bubbles with subtle borders
- Content-aware sizing -- plain text is compact, rich markdown gets more room
- Image grid display (single or 2-column)
- Source pills with favicons
- Markdown rendering with code blocks, tables, lists, headings
- Inline edit for user messages
- Copy and regenerate on hover

### Technical
- Streaming responses via SSE (~500 tok/s on Groq)
- Stop and continue generation
- Token/context counter
- Map embeds via Leaflet
- Groq primary, Ollama local fallback
- Single unified API route

## Tech Stack

- **Framework** -- Next.js 16 (App Router)
- **Language** -- TypeScript
- **Styling** -- TailwindCSS v4
- **Components** -- shadcn/ui, Lucide icons
- **AI** -- Groq cloud API (primary), Ollama (fallback)
- **Markdown** -- react-markdown + remark-gfm
- **Maps** -- Leaflet + react-leaflet

## Quick Start

```bash
# Install
npm install

# Add your Groq API key
cp .env.local.example .env.local
# Edit .env.local and add your GROQ_API_KEY

# Run
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Environment Variables

Create a `.env.local` file:

```env
# Primary - Groq cloud inference (instant speed)
GROQ_API_KEY=gsk_your_key_here
GROQ_MODEL=llama-3.3-70b-versatile

# Fallback - Local Ollama
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=mistral
```

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/chat` | POST | Main AI chat with streaming SSE |
| `/api/search` | GET | Web search via DuckDuckGo |
| `/api/scrape` | GET | Page content extraction |
| `/api/health` | GET | Health check |

## Project Structure

```
src/
  app/
    page.tsx              # Main chat page + action system
    api/
      chat/route.ts       # Groq/Ollama streaming API
      search/route.ts     # DuckDuckGo search
      scrape/route.ts     # Page scraper
  components/
    chat/
      chat-area.tsx       # Message list + controls
      chat-input.tsx      # Input box
      chat-message.tsx    # Message bubbles + thinking
      markdown-renderer.tsx
      map-embed.tsx
    sidebar/
      sidebar.tsx
      history-panel.tsx
      settings-panel.tsx
  hooks/
    use-browser-info.ts   # Device detection
    use-location.ts       # Geolocation
  types/
    chat.ts               # Message, WebSource, MapEmbed types
```

## License

MIT
