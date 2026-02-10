import { NextRequest } from "next/server";

const TENOR_API_KEY = "AIzaSyBNCNpIH26nsO_umj1LHMSMCo1jzmgkuaI";
const TENOR_BASE_URL = "https://tenor.googleapis.com/v2";

export const runtime = "edge";

// Tenor v2 API uses media_formats object — parsed dynamically below

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const query = searchParams.get("q");
  const limit = Math.min(parseInt(searchParams.get("limit") || "8"), 20); // Max 20 GIFs
  const random = searchParams.get("random") === "true";

  if (!query) {
    return Response.json({ error: "Query parameter 'q' is required" }, { status: 400 });
  }

  try {
    // Build Tenor API URL
    const url = new URL(`${TENOR_BASE_URL}/search`);
    url.searchParams.set("q", query);
    url.searchParams.set("key", TENOR_API_KEY);
    url.searchParams.set("limit", limit.toString());
    url.searchParams.set("media_filter", "gif,webp,mp4");
    url.searchParams.set("contentfilter", "medium"); // Filter out explicit content
    
    if (random) {
      url.searchParams.set("random", "true");
    }

    const response = await fetch(url.toString());
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Tenor API error:", response.status, errorText);
      return Response.json(
        { error: `Tenor API error: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();

    // Transform the Tenor v2 response (uses media_formats object) to our format
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gifs = (data.results || []).map((gif: any) => ({
      id: gif.id || "",
      title: gif.title || gif.content_description || "",
      url: gif.url || gif.itemurl || "",
      preview: gif.media_formats?.tinygif?.url || gif.media_formats?.nanogif?.url || "",
      webp: gif.media_formats?.webp?.url || gif.media_formats?.tinywebp?.url || "",
      webp_preview: gif.media_formats?.nanowebp?.url || gif.media_formats?.tinywebp?.url || gif.media_formats?.tinygif?.url || "",
      gif: gif.media_formats?.gif?.url || gif.media_formats?.mediumgif?.url || gif.media_formats?.tinygif?.url || "",
      mp4: gif.media_formats?.mp4?.url || gif.media_formats?.loopedmp4?.url || gif.media_formats?.tinymp4?.url || "",
      tags: gif.tags || [],
      duration: gif.media_formats?.mp4?.duration || gif.media_formats?.gif?.duration || 0,
      created: gif.created || 0,
    }));

    return Response.json({
      gifs,
      query,
      total: gifs.length,
      next: data.next,
    });
  } catch (error) {
    console.error("Error fetching from Tenor:", error);
    return Response.json(
      { error: "Failed to fetch GIFs from Tenor" },
      { status: 500 }
    );
  }
}
