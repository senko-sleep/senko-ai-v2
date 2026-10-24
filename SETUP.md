# Setup

Setup, model choices, and hosting instructions are in [README.md](README.md).
All settings are listed in [.env.example](.env.example).

## Browser agent on Vercel (Vercel Sandbox)

Vercel functions can't run Chrome, so with `AGENT_HOST=sandbox` the agent runs on an
"agent computer": this same app inside a 2-vCPU Vercel Sandbox, started on demand
(~3-5 s from cold) and replaced before the Hobby plan's 45-minute limit. Agent and
live-view calls are forwarded to it by `src/proxy.ts`.

The agent computer runs a snapshot of the code, so **after changing agent/server code,
commit and rebuild the snapshot** (about 2 minutes, runs on Vercel, not your PC):

    node scripts/agent-host-snapshot.mjs

To include reviewed, uncommitted changes (including new source files), use:

    node scripts/agent-host-snapshot.mjs --working-tree

The browser computer and web UI must be deployed together when input changes.
Build the snapshot first, then deploy the Vercel gateway and Wasmer site. The
snapshot smoke test checks the browser input protocol as well as launching
Chromium; host readiness rejects an incompatible old snapshot. Ignored files,
local environment files and dependency caches are excluded from the archive.

To go back to the Render server instead, remove `AGENT_HOST` from the Vercel env vars
(`AGENT_BACKEND_URL` still points at Render) and redeploy.
