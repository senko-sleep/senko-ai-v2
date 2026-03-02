import { NextRequest } from "next/server";
import { config } from "@/lib/config";

export const runtime = "nodejs";

// Developer passphrase — must match core.txt
const DEV_PASSPHRASE = "333senko";

function auth(req: NextRequest): boolean {
  const passphrase = req.headers.get("x-dev-passphrase");
  return passphrase === DEV_PASSPHRASE;
}

// Helper: proxy to search-api /dev-memory endpoint
async function proxyToSearchApi(
  method: string,
  query: string,
  body?: unknown
): Promise<Response> {
  const searchApiUrl = config.searchApiUrl;
  if (!searchApiUrl) {
    return Response.json({ error: "Search API not configured" }, { status: 503 });
  }

  const url = `${searchApiUrl}/dev-memory${query}`;
  const options: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-dev-passphrase": DEV_PASSPHRASE,
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(url, options);
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch (err) {
    console.error("[dev-memory proxy] Error:", err);
    return Response.json({ error: "Proxy failed" }, { status: 500 });
  }
}

// GET — read memories or conversation logs
export async function GET(req: NextRequest) {
  if (!auth(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const type = req.nextUrl.searchParams.get("type") || "memories";
  const id = req.nextUrl.searchParams.get("id");
  const query = id ? `?type=${type}&id=${id}` : `?type=${type}`;

  return proxyToSearchApi("GET", query);
}

// POST — save memories or conversation summaries
export async function POST(req: NextRequest) {
  if (!auth(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  return proxyToSearchApi("POST", "", body);
}

// DELETE — remove a memory by key
export async function DELETE(req: NextRequest) {
  if (!auth(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const key = req.nextUrl.searchParams.get("key");
  if (!key) {
    return Response.json({ error: "key required" }, { status: 400 });
  }

  return proxyToSearchApi("DELETE", `?key=${encodeURIComponent(key)}`);
}
