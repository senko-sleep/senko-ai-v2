import { afterEach, describe, expect, it, vi } from "vitest";
import { extractUIImageQueries, validateUINode } from "@/lib/ui-schema";
import { compileGeneratedUI } from "@/lib/ui-generation";
import { geocodeMapMarkers, singlePlaceQuery, wantsPlaces } from "@/lib/server/geocode";
import { geocodeUIText } from "@/lib/server/ui-response";

const fence = (o: unknown) => "```ui\n" + JSON.stringify(o) + "\n```";

describe("map card schema", () => {
  it("keeps place details, route and zoom", () => {
    const m = validateUINode({
      type: "map",
      title: "Coffee in Lisbon",
      region: "Lisbon, Portugal",
      route: true,
      zoom: 40,
      markers: [{ name: "Fábrica Coffee Roasters", address: "R. das Portas de Santo Antão 136", category: "Cafe", rating: "4.6", price: "$$", hours: "8am-6pm", lat: 38.716, lng: -9.14, imageQuery: "Fabrica coffee Lisbon" }],
    });
    expect(m?.type).toBe("map");
    if (m?.type !== "map") return;
    expect(m.route).toBe(true);
    expect(m.zoom).toBe(18);
    expect(m.markers[0]).toMatchObject({ label: "Fábrica Coffee Roasters", category: "Cafe", rating: "4.6", price: "$$", hours: "8am-6pm" });
  });

  it("collects marker photo queries for pre-resolution", () => {
    const qs = extractUIImageQueries(fence({ type: "map", markers: [{ label: "Louvre", lat: 48.86, lng: 2.33, imageQuery: "Louvre pyramid" }] }));
    expect(qs).toContain("Louvre pyramid");
  });
});

describe("figure block", () => {
  it("validates a paragraph with a picture beside it", () => {
    const f = validateUINode({ type: "image_text", title: "Axolotls", text: "Axolotls keep their gills for life.", imageQuery: "axolotl", side: "left" });
    expect(f).toMatchObject({ type: "figure", heading: "Axolotls", side: "left", imageQuery: "axolotl" });
  });

  it("falls back to plain text without a picture", () => {
    expect(validateUINode({ type: "figure", content: "Just words." })?.type).toBe("text");
  });

  it("is accepted by the UI compiler", () => {
    expect(compileGeneratedUI(fence({ type: "figure", content: "Hi", imageQuery: "red panda" })).ok).toBe(true);
  });
});

describe("location intent", () => {
  it.each([
    "where is mount fuji?",
    "best ramen in tokyo",
    "things to do in Rome this weekend",
    "plan a 3 day itinerary for Kyoto",
    "coffee shops near me",
    "how far is Boston from New York",
  ])("detects %s", (q) => expect(wantsPlaces(q)).toBe(true));

  it.each([
    "where is my phone",
    "where is the bug in this function",
    "how do I center a div in css",
    "best practices in react",
    "top players in the nba",
    "tell me a joke",
    "write a react component with a leaflet map",
  ])("ignores %s", (q) => expect(wantsPlaces(q)).toBe(false));

  it("extracts the single place", () => {
    expect(singlePlaceQuery("Where is the Eiffel Tower?")).toBe("Eiffel Tower");
    expect(singlePlaceQuery("where is machu picchu located")).toBe("machu picchu");
    expect(singlePlaceQuery("where is my phone")).toBeNull();
  });
});

describe("geocoding", () => {
  afterEach(() => vi.unstubAllGlobals());

  const photon = (lat: number, lng: number, name: string) =>
    new Response(JSON.stringify({ features: [{ geometry: { coordinates: [lng, lat] }, properties: { name, city: "Paris", country: "France" } }] }), { status: 200 });

  it("fills missing coordinates and addresses", async () => {
    const fetchMock = vi.fn(async (url: string) => (String(url).includes("Louvre") ? photon(48.8606, 2.3376, "Louvre") : photon(48.8566, 2.3522, "Paris")));
    vi.stubGlobal("fetch", fetchMock);
    const root = { type: "map", region: "Paris unique-test-1", markers: [{ label: "Louvre unique-test-1" }] };
    expect(await geocodeMapMarkers(root)).toBe(1);
    expect(root.markers[0]).toMatchObject({ lat: 48.8606, lng: 2.3376, address: "Paris, France" });
  });

  it("keeps a guess when the geocoder finds a far-away namesake", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => photon(33.66, -95.55, "Paris, Texas")));
    const root = { type: "map", markers: [{ label: "Paris unique-test-2", lat: 48.8566, lng: 2.3522 }] };
    await geocodeMapMarkers(root);
    expect(root.markers[0]).toMatchObject({ lat: 48.8566, lng: 2.3522 });
  });

  it("rewrites ui text so markers without coordinates survive validation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => photon(35.0116, 135.7681, "Kyoto")));
    const text = "Here you go!\n\n" + fence({ type: "map", markers: [{ label: "Fushimi Inari unique-test-3", address: "Kyoto" }] });
    const out = await geocodeUIText(text);
    expect(out.startsWith("Here you go!")).toBe(true);
    const compiled = compileGeneratedUI(out);
    expect(compiled.ok).toBe(true);
    const node = compiled.nodes[0];
    if (node.type === "map") expect(node.markers[0].lat).toBeCloseTo(35.0116);
  });
});
