# Senko: personal AI assistant

Chat with an AI, open sites with plain-English commands, and hand multi-step browsing jobs to an **agent** you can watch live in a real browser.

- **Chat mode**: normal conversation. Simple browser commands ("Open YouTube in a new tab and search MrBeast", "play Spy x Family on Crunchyroll") open a new tab instantly.
- **Agent mode**: the assistant plans the task, drives a headless browser step by step, streams the screen to you, and logs each step. Press **Stop** at any time. It only uses legal, official sources.
- **Any AI backend**: a local model through Ollama (free, no usage caps) or a cloud key (Groq has a free tier). The model menu in the header switches between them.
- The previous interface is still available at **`/classic`**.

## Run it on your PC

Requirements: Node.js 20+, plus [Ollama](https://ollama.com) if you want the local model.

```bash
npm install
npx playwright install chromium   # optional: the agent also works with your installed Edge/Chrome
ollama pull qwen3:4b-instruct     # local model (about 2.5 GB)
cp .env.example .env.local        # then fill in any keys you have
npm run dev:next                  # http://localhost:3000
```

`npm run dev` also starts the old search API that `/classic` uses.

### Which model?

| Option | Cost | Limits | Notes |
| --- | --- | --- | --- |
| Ollama, `qwen3:4b-instruct` | Free | None | Runs on your PC. Fine for chat; slow on CPU-only machines and weaker at Agent mode. Bigger models (e.g. `qwen3:8b`) need more RAM. |
| Groq (`GROQ_API_KEY`) | Free tier | Tokens per minute and per day | Fast and strong. Best choice for Agent mode on a hosted site. The app waits and retries automatically when it hits a short rate limit. |
| SambaNova (`SAMBANOVA_API_KEY`) | Provider plan | Automatically discovers available models; optionally pin one with `SAMBANOVA_MODEL`. |
| Cloudflare Workers AI (`CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`) | Workers AI plan | Uses Cloudflare's OpenAI-compatible endpoint; select a model with `CLOUDFLARE_MODEL`. |
| OpenRouter / DeepSeek / any OpenAI-compatible API | Pay as you go | Your budget | Set the matching key in `.env.local`. |

With `LLM_PROVIDER=auto` (default) the app tries Ollama first, then each cloud key you've set. It looks up each provider's current model list, so retired model names don't break chat.

## Host it online (works from any device)

The app can run on Wasmer Edge with Browserbase providing the cloud Chromium used by Agent mode. The `Dockerfile` remains available for other Node hosts and local container use.

1. Push this repo to GitHub.
2. Deploy the app to Wasmer Edge using `app.yaml`.
3. Set these secrets on the Wasmer app:
   - `APP_PASSWORD`: **always set this.** The site then asks for it (any username), so strangers can't use your keys or your agent.
   - `GROQ_API_KEY`: free at https://console.groq.com/keys. A hosted server can't run Ollama, so it needs a cloud key.
   - `BROWSERBASE_API_KEY`: runs Agent mode in Browserbase's cloud Chrome. The API key identifies the project; no project ID is needed.
   - Optional browser failovers: `BROWSERLESS_TOKEN` then `STEEL_API_KEY`. Agent mode tries those in order if Browserbase cannot start a browser.
   - Optional: `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, or `OLLAMA_URL` pointing to an Ollama server that is reachable from the internet.
   - Optional: `LLM7_API_KEY` adds LLM7 to the AI provider options, using its `default` model unless `LLM7_MODEL` is set.
4. For SambaNova, also set `SAMBANOVA_API_KEY`. For Cloudflare Workers AI, set both `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` with Workers AI access. Open the URL the host gives you on any device.

## How it works

```
Browser UI ──/api/chat────► LLM layer (src/lib/llm) ──► Ollama | Groq | OpenRouter | ...
           ──/api/agent───► Agent loop (src/lib/agent) ──► Playwright Chromium
                              ▲  plan → observe page → choose 1 action → act → repeat
                              └─ streams screenshots + steps back as server-sent events
           ──/api/agent/stop  aborts the run
```

| Path | What it is |
| --- | --- |
| `src/components/assistant/` | New UI: chat, mode toggle, live browser panel |
| `src/lib/browser-commands.ts` | Instant parser for "open X and search Y" style commands |
| `src/lib/llm/index.ts` | Provider selection, streaming, retries |
| `src/lib/agent/runner.ts` | Agent loop and prompts |
| `src/lib/agent/safety.ts` | Blocks known piracy/torrent sites and private network addresses |
| `src/proxy.ts` | Optional password gate (`APP_PASSWORD`) |
| `src/app/classic/` | The previous interface |

## Known limits

- Some video sites use DRM, which headless browsers can't play. The agent gets to the right episode page and gives you an **Open on my device** button to watch there.
- Sites can change their layout or show bot checks; the agent reports what blocked it instead of guessing.
- Agent mode needs a capable model. Small local models often lose track on complex pages.

## Tests

```bash
npm test
```
