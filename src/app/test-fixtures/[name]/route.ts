import { FIXTURES } from "@/lib/testing/fixtures";

export const dynamic = "force-static";

// Static pages used by the test suite (pop-up/redirect test etc.). Harmless and public.
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const html = FIXTURES[(await params).name];
  if (!html) return new Response("Not found", { status: 404 });
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export function generateStaticParams() {
  return Object.keys(FIXTURES).map((name) => ({ name }));
}
