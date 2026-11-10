# Setup

Setup, model choices, and hosting instructions are in [README.md](README.md).
All settings are listed in [.env.example](.env.example).

## Browser agent on Wasmer Edge

The Wasmer EdgeJS build connects to real Chromium over CDP. By default it tries
Browserbase, Steel, then Browserless when `BROWSERBASE_API_KEY`, `STEEL_API_KEY`,
and `BROWSERLESS_TOKEN` are configured. `BROWSER_PROVIDERS` can specify a
different order. The Wasmer deployment puts Steel first for new sessions.

Each chat has its own browser context. Open tabs, cookies, local storage, and
IndexedDB are saved in the app database so the chat can restore after a disconnect.
A site can still expire its own login or require verification again. Complete
third-party checks in the live browser.

Managed browser lifetime, egress IP, and the CDP round trip depend on the
provider. The live view uses Chromium's change-driven JPEG screencast and sends
the compressed images as binary. It targets up to 60 FPS by default and caps
encoded frames at 1280×800. Use the `LIVE_*` settings in `.env.example` to adjust
detail and bandwidth.

### Use installed Chromium on a native agent host

Run the Senko Node server or its Docker image on the host with Chromium installed.
Set `BROWSER_PATH` to that executable. On Wasmer, set `AGENT_BACKEND_URL` to the
native server's HTTPS origin. Configure both servers with the same application
database, access key, and session secret. On the agent server, set
`AGENT_COMPUTER=1` and `AGENT_PUBLIC_URL` to its public HTTPS origin to enable
signed direct live links. Keep Chromium's debugging port private.

For native UHD capture, set `SCREEN_WIDTH=3840`, `SCREEN_HEIGHT=2160`,
`LIVE_MAX_WIDTH=3840`, and `LIVE_MAX_HEIGHT=2160` on a host with
`LOW_MEMORY_MODE=0`. This keeps a fixed 3840×2160 Chromium desktop and fits it
to the viewer. UHD increases capture and decode cost. Measure the frame rate
on the target hardware before enabling it by default.

After changing the app source, deploy with:

    wasmer app deploy --dir . --owner senko-sleep --app-name senko-ai --build-remote --non-interactive

The public health endpoint reports which providers are configured. Open the
browser panel to verify that a provider can start Chromium and stream frames.
