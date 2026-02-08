"use client";

import { useEffect, useRef } from "react";
import { MapPin, ExternalLink } from "lucide-react";
import type { MapEmbed as MapEmbedType } from "@/types/chat";

interface MapEmbedProps {
  map: MapEmbedType;
}

export function MapEmbed({ map }: MapEmbedProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<unknown>(null);

  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;

    // Inject Leaflet CSS via <link> tag (bundler CSS import fails on Vercel)
    if (!document.querySelector('link[href*="leaflet"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }

    const loadMap = async () => {
      const L = await import("leaflet");

      if (!mapRef.current) return;

      const m = L.map(mapRef.current, {
        center: [map.lat, map.lng],
        zoom: map.zoom || 13,
        zoomControl: true,
        attributionControl: false,
      });

      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 19,
      }).addTo(m);

      // Force a resize after tiles load to prevent white grid
      setTimeout(() => m.invalidateSize(), 200);

      const icon = L.divIcon({
        html: `<div style="background:#00d4ff;width:12px;height:12px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 8px rgba(0,212,255,0.5)"></div>`,
        className: "",
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      });

      L.marker([map.lat, map.lng], { icon }).addTo(m);

      if (map.label) {
        L.popup({ closeButton: false, className: "senko-popup" })
          .setLatLng([map.lat, map.lng])
          .setContent(`<div style="font-size:12px;color:#e4e4e7">${map.label}</div>`)
          .openOn(m);
      }

      leafletMap.current = m;
    };

    loadMap();

    return () => {
      if (leafletMap.current) {
        (leafletMap.current as { remove: () => void }).remove();
        leafletMap.current = null;
      }
    };
  }, [map.lat, map.lng, map.zoom, map.label]);

  const mapsUrl = `https://www.google.com/maps?q=${map.lat},${map.lng}`;

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-white/[0.06]">
      <div className="flex items-center justify-between bg-white/[0.03] px-3 py-1.5">
        <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
          <MapPin className="h-3 w-3" />
          <span>{map.label || `${map.lat.toFixed(4)}, ${map.lng.toFixed(4)}`}</span>
        </div>
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-[10px] text-[#00d4ff] hover:text-[#66e5ff]"
        >
          Open in Maps
          <ExternalLink className="h-2.5 w-2.5" />
        </a>
      </div>
      <div ref={mapRef} className="h-48 w-full bg-[#1a1a2e]" />
    </div>
  );
}
