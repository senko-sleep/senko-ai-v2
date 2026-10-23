import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, accessKey, verifyDeviceToken } from "@/lib/auth-token";

// Gate for every API call: when APP_ACCESS_KEY is set, the device must have
// entered it once (signed cookie). Pages themselves load freely; the app shows
// the access-key screen when the API says 401.
const PUBLIC_API = new Set(["/api/health", "/api/access", "/api/link/claim", "/api/me"]);

export async function proxy(req: NextRequest) {
  if (!accessKey()) return NextResponse.next();
  const path = req.nextUrl.pathname;
  if (!path.startsWith("/api/") || PUBLIC_API.has(path)) return NextResponse.next();

  const deviceId = await verifyDeviceToken(req.cookies.get(AUTH_COOKIE)?.value);
  if (deviceId) return NextResponse.next();
  return NextResponse.json({ error: "Enter your access key on this device first.", needsKey: true }, { status: 401 });
}

export const config = {
  matcher: ["/api/:path*"],
};
