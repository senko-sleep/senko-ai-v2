# Setup

Setup, model choices, and hosting instructions are in [README.md](README.md).
All settings are listed in [.env.example](.env.example).

## Browser agent on Wasmer Edge + Browserbase

The app runs on Wasmer Edge. Agent mode creates a Browserbase cloud browser and
connects to it with the Playwright package already used by the app. If Browserbase
cannot create or connect to a browser, it tries Browserless, then Steel. No local
Chrome or separate Render/Vercel browser service is needed.

Add the secret `BROWSERBASE_API_KEY` to the Wasmer app. The key identifies the
Browserbase project, so do not set a project ID. The app creates a cloud browser on
the first real browser task (not at app startup), keeps one live browser by default,
and lets Browserbase expire it after one hour. Browser session tabs and storage are
saved in the app database and restored when a new cloud browser is needed.

Set `BROWSERLESS_TOKEN` and `STEEL_API_KEY` as additional Wasmer secrets to enable
the failover chain. Browserless uses its Playwright CDP endpoint, so it retains full
click, typing, live-view, and page-observation support; its HTTP screenshot endpoint
is available for screenshot-only calls. Steel sessions are released when their CDP
connection ends and have a 15-minute default lifetime. The supplied Browserless
HTTP screenshot endpoint is screenshot-only, so the app uses Browserless's CDP
endpoint instead to retain full agent control. The health endpoint exposes only
booleans for provider configuration, never the keys.

After changing the app source, deploy with:

    wasmer app deploy --dir . --owner senko-sleep --app-name senko-ai --build-remote --non-interactive

The public health endpoint reports `browserbaseConfigured` without revealing the
secret. A browser task is the end-to-end check that Browserbase can create a session
and the app can attach to it.
