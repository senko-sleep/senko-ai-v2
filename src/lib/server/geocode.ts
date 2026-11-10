// Real coordinates for map cards. The model names places; OpenStreetMap says where they are.
// Photon (komoot) is the primary geocoder, Nominatim the fallback. Both are free and keyless.

type Obj = Record<string, unknown>;

export interface GeoHit {
  lat: number;
  lng: number;
  name: string;
  address?: string;
  kind?: string;
}

const UA = "Mozilla/5.0 (compatible; SenkoMaps/1.0)";
const cache = new Map<string, Promise<GeoHit | null>>();
const MAP_TYPES = new Set(["map", "geo_map", "location_map", "locations", "places"]);

const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN);

/** Great-circle distance in km. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json", "Accept-Language": "en" }, signal });
  if (!res.ok) throw new Error(`geocoder ${res.status}`);
  return res.json();
}

async function photon(query: string, near: { lat: number; lng: number } | undefined, signal: AbortSignal): Promise<GeoHit | null> {
  const bias = near ? `&lat=${near.lat.toFixed(4)}&lon=${near.lng.toFixed(4)}` : "";
  const data = (await getJson(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1&lang=en${bias}`, signal)) as { features?: Obj[] };
  const f = data.features?.[0];
  if (!f || !isObj(f.geometry) || !isObj(f.properties)) return null;
  const [lng, lat] = (f.geometry.coordinates as number[]) || [];
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const p = f.properties;
  const street = [str(p.housenumber), str(p.street)].filter(Boolean).join(" ");
  const address = [street, str(p.city) || str(p.district), str(p.state), str(p.country)].filter(Boolean);
  return { lat, lng, name: str(p.name) || query, address: [...new Set(address)].join(", ") || undefined, kind: str(p.osm_value) || undefined };
}

async function nominatim(query: string, signal: AbortSignal): Promise<GeoHit | null> {
  const data = (await getJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`, signal)) as Obj[];
  const r = Array.isArray(data) ? data[0] : null;
  if (!isObj(r)) return null;
  const lat = num(r.lat);
  const lng = num(r.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, name: str(r.name) || query, address: str(r.display_name) || undefined, kind: str(r.type) || undefined };
}

/** One place → coordinates, or null. Results are cached for the life of the server. */
export function geocode(query: string, opts: { near?: { lat: number; lng: number }; signal?: AbortSignal } = {}): Promise<GeoHit | null> {
  const q = query.replace(/\s+/g, " ").trim().slice(0, 200);
  if (q.length < 2) return Promise.resolve(null);
  const key = `${q.toLowerCase()}|${opts.near ? `${opts.near.lat.toFixed(1)},${opts.near.lng.toFixed(1)}` : ""}`;
  if (!cache.has(key)) {
    if (cache.size > 800) cache.delete(cache.keys().next().value as string);
    const timeout = AbortSignal.timeout(6_000);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    const job = photon(q, opts.near, signal)
      .catch(() => null)
      .then((hit) => hit ?? nominatim(q, signal).catch(() => null));
    // Don't remember failures (they are often timeouts).
    job.then((hit) => { if (!hit) cache.delete(key); });
    cache.set(key, job);
  }
  return cache.get(key)!;
}

function mapNodes(root: unknown): Obj[] {
  const found: Obj[] = [];
  const visit = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(visit);
    if (!isObj(v)) return;
    if (MAP_TYPES.has(str(v.type))) found.push(v);
    for (const child of Object.values(v)) if (typeof child === "object") visit(child);
  };
  visit(root);
  return found;
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

/**
 * Give every map marker real coordinates. Markers may arrive with only a name and address
 * (the prompt allows that); guessed coordinates are replaced when the geocoder agrees
 * on roughly the same spot, and kept when the geocoder finds a different, same-named place.
 * Works on the raw model JSON, before schema validation drops markers without coordinates.
 */
export async function geocodeMapMarkers(root: unknown, signal?: AbortSignal, budgetMs = 9_000): Promise<number> {
  const maps = mapNodes(root);
  if (!maps.length) return 0;
  const deadline = AbortSignal.timeout(budgetMs);
  const sig = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let fixed = 0;
  for (const map of maps) {
    const key = ["markers", "locations", "places", "points", "items"].find((k) => Array.isArray(map[k]));
    if (!key) continue;
    const markers = (map[key] as unknown[]).filter(isObj).slice(0, 30);
    const region = str(map.region) || str(map.scope);
    const center = region ? await geocode(region, { signal: sig }) : null;
    await pool(markers, 4, async (m) => {
      if (sig.aborted) return;
      const label = str(m.label) || str(m.name) || str(m.title) || str(m.place);
      if (!label) return;
      const address = str(m.address) || str(m.location);
      const context = address || [str(m.city), str(m.subtitle) || str(m.country)].filter(Boolean).join(", ") || region;
      const guess = { lat: num(m.lat ?? m.latitude), lng: num(m.lng ?? m.lon ?? m.longitude) };
      const hasGuess = Number.isFinite(guess.lat) && Number.isFinite(guess.lng) && !(guess.lat === 0 && guess.lng === 0);
      const near = hasGuess ? guess : center ?? undefined;
      const queries = [str(m.query), context && !label.toLowerCase().includes(context.toLowerCase()) ? `${label}, ${context}` : label, address].filter(Boolean);
      let hit: GeoHit | null = null;
      for (const q of [...new Set(queries)]) {
        hit = await geocode(q, { near, signal: sig });
        if (hit) break;
      }
      // A city-scoped map should not jump to a same-named place on another continent.
      if (hit && !hasGuess && center && distanceKm(center, hit) > 1500) hit = null;
      if (hit && (!hasGuess || distanceKm(guess, hit) < 40)) {
        m.lat = Number(hit.lat.toFixed(6));
        m.lng = Number(hit.lng.toFixed(6));
        delete m.latitude; delete m.longitude; delete m.lon;
        if (!address && hit.address) m.address = hit.address;
        fixed++;
      }
    });
  }
  return fixed;
}

const PLACE_WORDS = /\b(?:where\s+(?:is|are|was|can\s+i\s+(?:find|get|buy|eat|see|go))|wheres|located|location\s+of|map\s+of|on\s+a\s+map|show\s+(?:me\s+)?(?:it\s+)?on\s+(?:a\s+|the\s+)?map|directions?\s+to|how\s+(?:do\s+i\s+get|far)\s+(?:to|is|from)|nearby|near\s+me|things\s+to\s+do|places\s+to\s+(?:visit|go|eat|see|stay)|(?:restaurants?|cafes?|coffee\s+shops?|bars?|hotels?|museums?|parks?|beaches|hikes?|trails?|attractions?|landmarks?|sights|neighbou?rhoods?|spots|stores?|shops?)\s+(?:in|near|around|at)|itinerary|road\s*trip|day\s+trip|trip\s+to|travel\s+(?:to|guide)|tourist|sightseeing|capital\s+of|cities\s+in)\b/i;

/** "where is the Eiffel Tower", "best ramen in Tokyo", "3 day itinerary for Rome"... */
export function wantsPlaces(content: string): boolean {
  if (content.length > 600) return false;
  if (/```|\b(?:code|function|component|react|css|html|regex|sql|leaflet|google maps api)\b/i.test(content)) return false;
  // "where is my phone/keys/the file" is not geography.
  if (/\bwhere\s+(?:is|are)\s+(?:my|your|the\s+(?:file|button|setting|option|bug|error|function|variable))\b/i.test(content)) return false;
  if (PLACE_WORDS.test(content)) return true;
  // "best ramen in tokyo", "cheap hotels around lisbon" — but not "best practices in react".
  const best = /\b(?:best|top|good|cheap|famous|local|hidden|cute|cozy|romantic)\s+([a-z' -]{2,32}?)\s+(?:in|near|around)\s+(?!\d)(?:the\s+)?([a-z][a-z .'-]{1,40})/i.exec(content);
  if (!best) return false;
  const nonPlace = /\b(?:way|ways|time|method|practice|practices|language|tool|tools|book|books|player|players|character|characters|game|games|song|songs|movie|movies|film|films|anime|show|shows|episode|episodes|move|moves|card|cards|team|teams|weapon|weapons|build|builds|library|libraries|framework|frameworks|feature|features|model|models|setting|settings|tip|tips|deck|decks|class|classes)\b/i;
  const nonPlaceTarget = /^(?:react|python|javascript|typescript|java|rust|go|excel|minecraft|fortnite|roblox|valorant|league|history|terms|general|order|life|school|math|english|code)\b/i;
  return !nonPlace.test(best[1]) && !nonPlaceTarget.test(best[2]);
}

/** The place in a single-place question, e.g. "where is mount fuji?" → "mount fuji". */
export function singlePlaceQuery(content: string): string | null {
  const m = /\b(?:where\s+(?:is|was)|wheres|location\s+of|map\s+of|directions?\s+to|show\s+(?:me\s+)?)\s+(?:the\s+)?(.{2,80}?)(?:\s+(?:located|on\s+(?:a|the)\s+map|at))?\s*[?.!]*$/i.exec(content.trim());
  const q = m?.[1]?.replace(/^(?:a|an)\s+/i, "").trim();
  if (!q || /\b(?:my|your|me|it|this|that)\b/i.test(q)) return null;
  return q;
}

export const PLACES_NOTE = `LOCATIONS: this question is about real places, so show them on a map without being asked. Include one \`\`\`ui map block (Senko's map card) with a marker per place: {"type":"map","title":"...","region":"<city/country the places are in>","markers":[{"label":"<exact place name>","address":"<street, city or city, country>","category":"<Cafe|Museum|Park|...>","description":"<one useful line>","rating":"<only if known>","price":"<$-$$$$ or Free, only if known>","hours":"<only if known>","imageQuery":"<place name + city photo>"}]}. Coordinates are optional: the app looks up exact coordinates, so give accurate names and addresses rather than guessed lat/lng. Add "route": true when the order matters (itinerary, road trip, walking tour). Keep the reply friendly: a short intro, the map, then a few notes in prose if useful. Never invent ratings, prices or hours.`;
