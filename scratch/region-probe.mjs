import { config } from "dotenv"; config({ path: ".env.local", quiet: true });
const steel = process.env.STEEL_API_KEY, bb = process.env.BROWSERBASE_API_KEY;
if (steel) {
  const r = await fetch("https://api.steel.dev/v1/sessions", { method: "POST", headers: { "steel-api-key": steel, "content-type": "application/json" }, body: JSON.stringify({ timeout: 60000, region: "lax" }) });
  const j = await r.json().catch(() => ({}));
  console.log("steel", r.status, JSON.stringify({ region: j.region, id: !!j.id, err: j.message || j.error }));
  if (j.id) await fetch(`https://api.steel.dev/v1/sessions/${j.id}/release`, { method: "POST", headers: { "steel-api-key": steel } });
}
if (bb) {
  const r = await fetch("https://api.browserbase.com/v1/sessions", { method: "POST", headers: { "X-BB-API-Key": bb, "content-type": "application/json" }, body: JSON.stringify({ region: "us-west-2", timeout: 60 }) });
  const j = await r.json().catch(() => ({}));
  console.log("browserbase", r.status, JSON.stringify({ region: j.region, id: !!j.id, err: j.message || j.error }));
  if (j.id) await fetch(`https://api.browserbase.com/v1/sessions/${j.id}`, { method: "POST", headers: { "X-BB-API-Key": bb, "content-type": "application/json" }, body: JSON.stringify({ status: "REQUEST_RELEASE" }) });
}
