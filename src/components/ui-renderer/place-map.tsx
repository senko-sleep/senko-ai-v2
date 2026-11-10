"use client";

// Senko's map card: a real Leaflet map themed to the app (warm dark tiles, light tiles in
// light mode, satellite on demand), numbered pins, a synced place list with photos,
// directions links, optional route line and fullscreen.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Map as LeafletMap, Marker, TileLayer, Polyline } from "leaflet";
import "leaflet/dist/leaflet.css";
import "./place-map.css";
import { Clock, Expand, ExternalLink, Globe, Layers, LocateFixed, MapPin, Minimize2, Navigation, Route, Star } from "lucide-react";
import type { UINode, UIMapMarker } from "@/lib/ui-schema";
import { SmartImage } from "./smart-image";

type MapNode = Extract<UINode, { type: "map" }>;
type Basemap = "map" | "satellite";

// Keyless Esri tiles: a base layer plus a separate label layer so labels stay crisp under the tint.
const esri = (service: string) => `https://server.arcgisonline.com/ArcGIS/rest/services/${service}/MapServer/tile/{z}/{y}/{x}`;
const TILES = {
  dark: [esri("Canvas/World_Dark_Gray_Base"), esri("Canvas/World_Dark_Gray_Reference")],
  light: [esri("Canvas/World_Light_Gray_Base"), esri("Canvas/World_Light_Gray_Reference")],
  satellite: [esri("World_Imagery"), esri("Reference/World_Boundaries_and_Places")],
};
const ATTRIBUTION = 'Tiles &copy; <a href="https://www.esri.com" target="_blank" rel="noreferrer">Esri</a>, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

function km(a: UIMapMarker, b: UIMapMarker) {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function formatKm(d: number) {
  if (d < 1) return `${Math.round(d * 1000)} m`;
  return d < 20 ? `${d.toFixed(1)} km` : `${Math.round(d).toLocaleString()} km`;
}

/** Follows <html data-theme="light|dark|system"> and the OS setting. */
function useAppTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const read = () => {
      const t = document.documentElement.dataset.theme;
      setTheme(t === "light" || (t === "system" && media.matches) ? "light" : "dark");
    };
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    media.addEventListener("change", read);
    return () => { obs.disconnect(); media.removeEventListener("change", read); };
  }, []);
  return theme;
}

const directionsUrl = (m: UIMapMarker) => `https://www.google.com/maps/dir/?api=1&destination=${m.lat},${m.lng}`;
const placeUrl = (m: UIMapMarker) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${m.label} ${m.address || ""}`.trim())}`;

export function PlaceMap({ node }: { node: MapNode }) {
  // The renderer re-validates nodes on each render; only rebuild the map when the places change.
  const markersKey = JSON.stringify(node.markers);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const markers = useMemo(() => node.markers, [markersKey]);
  const theme = useAppTheme();
  const [active, setActive] = useState(0);
  const [basemap, setBasemap] = useState<Basemap>("map");
  const [fullMode, setFullMode] = useState<false | "native" | "overlay">(false);
  const full = fullMode !== false;
  const [ready, setReady] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const LRef = useRef<typeof import("leaflet") | null>(null);
  const pinsRef = useRef<Marker[]>([]);
  const tilesRef = useRef<TileLayer[]>([]);
  const routeRef = useRef<Polyline | null>(null);

  // Spread decides whether picking a place zooms to street level or just pans.
  const spreadKm = useMemo(() => {
    let max = 0;
    for (let i = 0; i < markers.length; i++) for (let j = i + 1; j < markers.length; j++) max = Math.max(max, km(markers[i], markers[j]));
    return max;
  }, [markers]);
  const routeKm = useMemo(() => (node.route ? markers.slice(1).reduce((sum, m, i) => sum + km(markers[i], m), 0) : 0), [markers, node.route]);
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const pinIcon = useCallback((index: number, isActive: boolean) => {
    const L = LRef.current!;
    const m = markers[index];
    const label = m.badge && m.badge.length <= 3 ? m.badge : String(index + 1);
    return L.divIcon({
      className: "sk-pin-wrap",
      html: `<div class="sk-pin${isActive ? " is-active" : ""}"><span>${label.replace(/[<>&"]/g, "")}</span></div>`,
      iconSize: [34, 42],
      iconAnchor: [17, 40],
      tooltipAnchor: [0, -38],
    });
  }, [markers]);

  const fitAll = useCallback((animate = true) => {
    const map = mapRef.current;
    const L = LRef.current;
    if (!map || !L) return;
    if (markers.length === 1) {
      map.setView([markers[0].lat, markers[0].lng], node.zoom ?? 13, { animate });
      return;
    }
    map.fitBounds(L.latLngBounds(markers.map((m) => [m.lat, m.lng] as [number, number])), { padding: [44, 44], maxZoom: node.zoom ?? 15, animate });
  }, [markers, node.zoom]);

  // Create the map once.
  useEffect(() => {
    let disposed = false;
    (async () => {
      const L = await import("leaflet");
      if (disposed || !canvasRef.current) return;
      LRef.current = L;
      const map = L.map(canvasRef.current, {
        zoomControl: false,
        attributionControl: true,
        scrollWheelZoom: false,
        worldCopyJump: true,
        zoomSnap: 0.5,
      });
      map.attributionControl.setPrefix(false);
      L.control.zoom({ position: "bottomright" }).addTo(map);
      mapRef.current = map;

      pinsRef.current = markers.map((m, i) => {
        const pin = L.marker([m.lat, m.lng], { icon: pinIcon(i, i === 0), keyboard: true, title: m.label, riseOnHover: true })
          .addTo(map)
          .bindTooltip(m.label, { direction: "top", className: "sk-map-tip", offset: [0, 0] });
        pin.on("click", () => setActive(i));
        return pin;
      });

      // Scroll-zoom only after the user engages the map, so the chat keeps scrolling normally.
      map.on("click focus", () => map.scrollWheelZoom.enable());
      map.on("mouseout blur", () => map.scrollWheelZoom.disable());

      fitAll(false);
      setReady(true);
      // The card may still be laying out (streaming replies, tabs).
      setTimeout(() => !disposed && map.invalidateSize(), 250);
    })();
    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      pinsRef.current = [];
      tilesRef.current = [];
      routeRef.current = null;
    };
  }, [markers, pinIcon, fitAll]);

  // Basemap follows the app theme and the Map / Satellite toggle.
  useEffect(() => {
    const map = mapRef.current;
    const L = LRef.current;
    if (!ready || !map || !L) return;
    tilesRef.current.forEach((t) => t.remove());
    const [base, labels] = basemap === "satellite" ? TILES.satellite : theme === "light" ? TILES.light : TILES.dark;
    // Canvas tiles stop at z16; Leaflet upscales beyond that.
    const maxNativeZoom = basemap === "satellite" ? 19 : 16;
    const layers = [
      L.tileLayer(base, { maxZoom: 19, maxNativeZoom, attribution: ATTRIBUTION }),
      L.tileLayer(labels, { maxZoom: 19, maxNativeZoom, pane: "overlayPane", className: "sk-map-labels" }),
    ];
    layers.forEach((l) => l.addTo(map));
    tilesRef.current = layers;
  }, [ready, theme, basemap]);

  // Route line in the accent color.
  useEffect(() => {
    const map = mapRef.current;
    const L = LRef.current;
    if (!ready || !map || !L || !node.route || markers.length < 2) return;
    routeRef.current?.remove();
    const accent = getComputedStyle(rootRef.current || document.body).getPropertyValue("--sk-accent").trim() || "#f26a0e";
    routeRef.current = L.polyline(markers.map((m) => [m.lat, m.lng] as [number, number]), {
      color: accent, weight: 3.5, opacity: 0.9, dashArray: "2 9", lineCap: "round", className: "sk-map-route",
    }).addTo(map);
  }, [ready, node.route, markers, theme]);

  // Highlight the active pin and keep its card in view (without scrolling the chat).
  useEffect(() => {
    if (!ready) return;
    pinsRef.current.forEach((pin, i) => {
      pin.setIcon(pinIcon(i, i === active));
      pin.setZIndexOffset(i === active ? 1000 : 0);
    });
    const list = listRef.current;
    const card = list?.children[active] as HTMLElement | undefined;
    if (list && card) {
      const horizontal = list.scrollWidth > list.clientWidth + 4;
      if (horizontal) list.scrollTo({ left: card.offsetLeft - 12, behavior: reduced ? "auto" : "smooth" });
      else if (card.offsetTop < list.scrollTop || card.offsetTop + card.offsetHeight > list.scrollTop + list.clientHeight)
        list.scrollTo({ top: card.offsetTop - 8, behavior: reduced ? "auto" : "smooth" });
    }
  }, [active, ready, pinIcon, reduced]);

  const focusPlace = (i: number) => {
    setActive(i);
    const map = mapRef.current;
    const m = markers[i];
    if (!map || !m) return;
    const zoom = spreadKm > 400 ? Math.max(map.getZoom(), 5) : Math.max(map.getZoom(), node.zoom ?? 15);
    map.flyTo([m.lat, m.lng], zoom, { duration: reduced ? 0 : 0.8 });
    pinsRef.current[i]?.openTooltip();
  };

  // Real fullscreen when the browser allows it; a fixed overlay otherwise.
  const toggleFull = () => {
    const el = rootRef.current;
    if (document.fullscreenElement) { void document.exitFullscreen().catch(() => setFullMode(false)); return; }
    if (fullMode) { setFullMode(false); return; }
    if (el?.requestFullscreen) el.requestFullscreen().catch(() => setFullMode("overlay"));
    else setFullMode("overlay");
  };
  useEffect(() => {
    const sync = () => setFullMode(document.fullscreenElement === rootRef.current ? "native" : false);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  // Resize the map after entering or leaving fullscreen; Escape closes the overlay.
  useEffect(() => {
    const map = mapRef.current;
    const t = setTimeout(() => { map?.invalidateSize(); fitAll(false); }, 220);
    if (fullMode !== "overlay") return () => clearTimeout(t);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFullMode(false);
    window.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); window.removeEventListener("keydown", onKey); };
  }, [fullMode, fitAll]);

  const single = markers.length === 1;

  return (
    <>
      {fullMode === "overlay" && <div className="sk-map-backdrop" onClick={() => setFullMode(false)} aria-hidden />}
      <section ref={rootRef} className="sk-map" data-full={fullMode || undefined} data-single={single || undefined} aria-label={node.title || "Map"}>
        <header className="sk-map-head">
          <span className="sk-map-badge" aria-hidden><MapPin size={16} strokeWidth={2.4} /></span>
          <div className="sk-map-heading">
            <h4>{node.title || (single ? markers[0].label : "Places")}</h4>
            {(node.subtitle || node.region) && <p>{node.subtitle || node.region}</p>}
          </div>
          <div className="sk-map-chips">
            {node.region && node.subtitle && <span className="sk-map-chip"><Globe size={11} /> {node.region}</span>}
            {!single && <span className="sk-map-chip">{markers.length} places</span>}
            {node.route && routeKm > 0 && <span className="sk-map-chip is-accent"><Route size={11} /> {formatKm(routeKm)}</span>}
          </div>
        </header>

        <div className="sk-map-body">
          <div className="sk-map-stage">
            <div ref={canvasRef} className="sk-map-canvas" data-basemap={basemap} data-theme={theme} />
            {!ready && <div className="sk-map-loading" aria-hidden><span /></div>}
            <div className="sk-map-tools">
              <div className="sk-map-seg" role="group" aria-label="Map style">
                <button type="button" aria-pressed={basemap === "map"} onClick={() => setBasemap("map")}><Layers size={13} /> Map</button>
                <button type="button" aria-pressed={basemap === "satellite"} onClick={() => setBasemap("satellite")}><Globe size={13} /> Satellite</button>
              </div>
              {!single && (
                <button type="button" className="sk-map-tool" onClick={() => fitAll()} title="Show all places" aria-label="Show all places"><LocateFixed size={15} /></button>
              )}
              <button type="button" className="sk-map-tool" onClick={toggleFull} title={full ? "Exit full screen" : "Full screen"} aria-label={full ? "Exit full screen" : "Full screen"}>
                {full ? <Minimize2 size={15} /> : <Expand size={15} />}
              </button>
            </div>
          </div>

          <ol ref={listRef} className="sk-map-list">
            {markers.map((m, i) => {
              const meta = [m.category, m.subtitle].filter(Boolean).join(" · ");
              const hasImage = Boolean(m.imageUrl || m.imageQuery);
              return (
                <li key={m.id} className="sk-place" data-active={i === active || undefined}>
                  {hasImage && (
                    <div className="sk-place-art">
                      <SmartImage imageUrl={m.imageUrl} imageQuery={m.imageQuery} alt={m.label} aspect="square" showBookmark={false} quietActions />
                    </div>
                  )}
                  <button type="button" className="sk-place-main" onClick={() => focusPlace(i)} aria-current={i === active || undefined}>
                    <span className="sk-place-num" aria-hidden>{m.badge && m.badge.length <= 3 ? m.badge : i + 1}</span>
                    <span className="sk-place-text">
                      <span className="sk-place-name">{m.label}</span>
                      {(meta || m.rating || m.price) && (
                        <span className="sk-place-meta">
                          {m.rating && <span className="sk-place-rating"><Star size={11} fill="currentColor" /> {m.rating}</span>}
                          {meta && <span>{meta}</span>}
                          {m.price && <span>{m.price}</span>}
                        </span>
                      )}
                      {m.address && <span className="sk-place-addr">{m.address}</span>}
                      {m.description && <span className="sk-place-desc">{m.description}</span>}
                      {(m.hours || m.elevation) && (
                        <span className="sk-place-meta">
                          {m.hours && <span><Clock size={11} /> {m.hours}</span>}
                          {m.elevation && <span>{m.elevation}</span>}
                        </span>
                      )}
                    </span>
                  </button>
                  <div className="sk-place-actions">
                    <a href={directionsUrl(m)} target="_blank" rel="noreferrer" className="is-primary"><Navigation size={12} /> Directions</a>
                    <a href={m.url || placeUrl(m)} target="_blank" rel="noreferrer"><ExternalLink size={12} /> {m.url ? "Website" : "Open"}</a>
                    {node.route && i < markers.length - 1 && <span className="sk-place-leg">{formatKm(km(m, markers[i + 1]))} to next</span>}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </section>
    </>
  );
}
