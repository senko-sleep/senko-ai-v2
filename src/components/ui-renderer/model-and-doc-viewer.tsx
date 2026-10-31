"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  ChevronLeft,
  ChevronRight,
  FileText,
  Grid,
  Pause,
  Play,
  RotateCcw,
  Search,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { UIDocumentSection } from "@/lib/ui-schema";

type Vec3 = [number, number, number];

interface Mesh3D {
  vertices: Vec3[];
  faces: number[][];
  edges?: [number, number][];
}

function buildPresetMesh(preset: string): Mesh3D {
  switch (preset) {
    case "cube": {
      const s = 1.1;
      const vertices: Vec3[] = [
        [-s, -s, -s],
        [s, -s, -s],
        [s, s, -s],
        [-s, s, -s],
        [-s, -s, s],
        [s, -s, s],
        [s, s, s],
        [-s, s, s],
      ];
      const faces = [
        [0, 1, 2, 3],
        [4, 5, 6, 7],
        [0, 1, 5, 4],
        [2, 3, 7, 6],
        [0, 3, 7, 4],
        [1, 2, 6, 5],
      ];
      return { vertices, faces };
    }

    case "pyramid": {
      const vertices: Vec3[] = [
        [0, 1.35, 0],
        [-1.1, -0.9, -1.1],
        [1.1, -0.9, -1.1],
        [1.1, -0.9, 1.1],
        [-1.1, -0.9, 1.1],
      ];
      const faces = [
        [0, 1, 2],
        [0, 2, 3],
        [0, 3, 4],
        [0, 4, 1],
        [1, 2, 3, 4],
      ];
      return { vertices, faces };
    }

    case "torus": {
      const vertices: Vec3[] = [];
      const faces: number[][] = [];
      const R = 1.15;
      const r = 0.45;
      const segU = 22;
      const segV = 12;
      for (let i = 0; i < segU; i++) {
        const u = (i / segU) * Math.PI * 2;
        for (let j = 0; j < segV; j++) {
          const v = (j / segV) * Math.PI * 2;
          const x = (R + r * Math.cos(v)) * Math.cos(u);
          const y = r * Math.sin(v);
          const z = (R + r * Math.cos(v)) * Math.sin(u);
          vertices.push([x, y, z]);
        }
      }
      for (let i = 0; i < segU; i++) {
        const ni = (i + 1) % segU;
        for (let j = 0; j < segV; j++) {
          const nj = (j + 1) % segV;
          faces.push([i * segV + j, ni * segV + j, ni * segV + nj, i * segV + nj]);
        }
      }
      return { vertices, faces };
    }

    case "sphere":
    case "atom":
    case "solar_system": {
      const vertices: Vec3[] = [];
      const faces: number[][] = [];
      const latBands = 14;
      const lonBands = 20;
      const rad = preset === "atom" ? 0.55 : 1.35;
      for (let lat = 0; lat <= latBands; lat++) {
        const theta = (lat * Math.PI) / latBands;
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);
        for (let lon = 0; lon <= lonBands; lon++) {
          const phi = (lon * 2 * Math.PI) / lonBands;
          vertices.push([rad * Math.cos(phi) * sinTheta, rad * cosTheta, rad * Math.sin(phi) * sinTheta]);
        }
      }
      for (let lat = 0; lat < latBands; lat++) {
        for (let lon = 0; lon < lonBands; lon++) {
          const first = lat * (lonBands + 1) + lon;
          const second = first + lonBands + 1;
          faces.push([first, second, second + 1, first + 1]);
        }
      }
      if (preset === "atom" || preset === "solar_system") {
        // Add orbital rings
        const ringPts = 28;
        const tilts =
          preset === "atom"
            ? [
                [1.45, 0.4, 0],
                [1.45, -0.4, 0.8],
                [1.45, 0.9, -0.5],
              ]
            : [
                [1.1, 0.1, 0],
                [1.55, 0.15, 0.2],
                [1.95, 0.08, -0.1],
              ];
        const edges: [number, number][] = [];
        for (const [orad, tx, tz] of tilts) {
          const base = vertices.length;
          for (let i = 0; i < ringPts; i++) {
            const a = (i / ringPts) * Math.PI * 2;
            const x = Math.cos(a) * orad;
            const z = Math.sin(a) * orad;
            const y = x * Math.sin(tx) + z * Math.sin(tz);
            vertices.push([x, y * 0.45, z]);
            edges.push([base + i, base + ((i + 1) % ringPts)]);
          }
        }
        return { vertices, faces, edges };
      }
      return { vertices, faces };
    }

    case "dna_helix": {
      const vertices: Vec3[] = [];
      const edges: [number, number][] = [];
      const steps = 26;
      for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        const y = (t - 0.5) * 2.8;
        const angle = t * Math.PI * 3.2;
        const r = 0.85;
        const idxA = vertices.length;
        vertices.push([Math.cos(angle) * r, y, Math.sin(angle) * r]);
        const idxB = vertices.length;
        vertices.push([Math.cos(angle + Math.PI) * r, y, Math.sin(angle + Math.PI) * r]);
        edges.push([idxA, idxB]);
        if (i > 0) {
          edges.push([idxA - 2, idxA]);
          edges.push([idxB - 2, idxB]);
        }
      }
      return { vertices, faces: [], edges };
    }

    case "cylinder": {
      const vertices: Vec3[] = [];
      const faces: number[][] = [];
      const segs = 20;
      const r = 1.0;
      const h = 1.15;
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        vertices.push([Math.cos(a) * r, -h, Math.sin(a) * r]);
        vertices.push([Math.cos(a) * r, h, Math.sin(a) * r]);
      }
      for (let i = 0; i < segs; i++) {
        const ni = (i + 1) % segs;
        faces.push([i * 2, ni * 2, ni * 2 + 1, i * 2 + 1]);
      }
      return { vertices, faces };
    }

    case "wave_surface": {
      const vertices: Vec3[] = [];
      const faces: number[][] = [];
      const grid = 13;
      for (let i = 0; i < grid; i++) {
        for (let j = 0; j < grid; j++) {
          const u = (i / (grid - 1) - 0.5) * 2.6;
          const v = (j / (grid - 1) - 0.5) * 2.6;
          const d = Math.sqrt(u * u + v * v);
          const y = Math.cos(d * 2.6) * 0.45;
          vertices.push([u, y, v]);
        }
      }
      for (let i = 0; i < grid - 1; i++) {
        for (let j = 0; j < grid - 1; j++) {
          const a = i * grid + j;
          faces.push([a, a + 1, a + grid + 1, a + grid]);
        }
      }
      return { vertices, faces };
    }

    case "icosahedron":
    default: {
      const t = (1 + Math.sqrt(5)) / 2;
      const rawV: Vec3[] = [
        [-1, t, 0],
        [1, t, 0],
        [-1, -t, 0],
        [1, -t, 0],
        [0, -1, t],
        [0, 1, t],
        [0, -1, -t],
        [0, 1, -t],
        [t, 0, -1],
        [t, 0, 1],
        [-t, 0, -1],
        [-t, 0, 1],
      ];
      const scale = 0.78;
      const vertices: Vec3[] = rawV.map(([x, y, z]) => [x * scale, y * scale, z * scale]);
      const faces = [
        [0, 11, 5],
        [0, 5, 1],
        [0, 1, 7],
        [0, 7, 10],
        [0, 10, 11],
        [1, 5, 9],
        [5, 11, 4],
        [11, 10, 2],
        [10, 7, 6],
        [7, 1, 8],
        [3, 9, 4],
        [3, 4, 2],
        [3, 2, 6],
        [3, 6, 8],
        [3, 8, 9],
        [4, 9, 5],
        [2, 4, 11],
        [6, 2, 10],
        [8, 6, 7],
        [9, 8, 1],
      ];
      return { vertices, faces };
    }
  }
}

function parseObjData(objText: string): Mesh3D | null {
  const vertices: Vec3[] = [];
  const faces: number[][] = [];
  for (const rawLine of objText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("v ")) {
      const parts = line.slice(2).trim().split(/\s+/).map(Number);
      if (parts.length >= 3 && parts.every(Number.isFinite)) {
        vertices.push([parts[0], parts[1], parts[2]]);
      }
    } else if (line.startsWith("f ")) {
      const idxs = line
        .slice(2)
        .trim()
        .split(/\s+/)
        .map((tok) => parseInt(tok.split("/")[0], 10) - 1)
        .filter((n) => n >= 0);
      if (idxs.length >= 3) faces.push(idxs);
    }
  }
  return vertices.length ? { vertices, faces } : null;
}

export function ModelViewer3D({
  title = "Interactive 3D Model",
  subtitle,
  preset: initialPreset = "icosahedron",
  modelUrl,
  objData,
  vertices: customVertices,
  faces: customFaces,
  color = "#f26a0e",
  wireframe: initialWire = false,
  autoRotate: initialRotate = true,
  annotations,
}: {
  title?: string;
  subtitle?: string;
  preset?: string;
  modelUrl?: string;
  objData?: string;
  vertices?: Vec3[];
  faces?: number[][];
  color?: string;
  wireframe?: boolean;
  autoRotate?: boolean;
  annotations?: { label: string; description?: string; position?: Vec3 }[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [preset, setPreset] = useState(initialPreset);
  const [wireframe, setWireframe] = useState(initialWire);
  const [autoRotate, setAutoRotate] = useState(initialRotate);
  const [zoom, setZoom] = useState(1);
  const [fetchedObj, setFetchedObj] = useState<string | null>(null);
  const rotRef = useRef({ yaw: 0.55, pitch: 0.35 });
  const dragRef = useRef<{ active: boolean; x: number; y: number }>({ active: false, x: 0, y: 0 });

  useEffect(() => {
    if (!modelUrl) return;
    let alive = true;
    fetch(modelUrl)
      .then((r) => (r.ok ? r.text() : ""))
      .then((txt) => {
        if (alive && txt.includes("\nv ")) setFetchedObj(txt);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [modelUrl]);

  const mesh = useMemo<Mesh3D>(() => {
    if (customVertices?.length) {
      return { vertices: customVertices, faces: customFaces || [] };
    }
    const rawObj = objData || fetchedObj;
    if (rawObj) {
      const parsed = parseObjData(rawObj);
      if (parsed) return parsed;
    }
    return buildPresetMesh(preset);
  }, [customVertices, customFaces, objData, fetchedObj, preset]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const render = () => {
      if (autoRotate && !dragRef.current.active) {
        rotRef.current.yaw += 0.011;
      }

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const { yaw, pitch } = rotRef.current;
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      const scale = Math.min(w, h) * 0.28 * zoom;

      const project = ([vx, vy, vz]: Vec3) => {
        const x1 = vx * cy - vz * sy;
        const z1 = vx * sy + vz * cy;
        const y2 = vy * cp - z1 * sp;
        const z2 = vy * sp + z1 * cp;
        const depth = 4.2 - z2;
        const persp = 3.4 / Math.max(1.2, depth);
        return {
          x: w / 2 + x1 * scale * persp,
          y: h / 2 - y2 * scale * persp,
          z: z2,
          rx: x1,
          ry: y2,
          rz: z2,
        };
      };

      const projected = mesh.vertices.map(project);

      // Draw faces sorted back-to-front (Painter's algorithm)
      if (mesh.faces.length > 0) {
        const sortedFaces = mesh.faces
          .map((face) => {
            const pts = face.map((idx) => projected[idx]).filter(Boolean);
            const avgZ = pts.reduce((acc, p) => acc + p.z, 0) / Math.max(1, pts.length);
            return { pts, avgZ };
          })
          .sort((a, b) => a.avgZ - b.avgZ);

        for (const { pts } of sortedFaces) {
          if (pts.length < 3) continue;
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
          ctx.closePath();

          if (!wireframe) {
            // Compute surface normal for directional shading
            const ax = pts[1].rx - pts[0].rx;
            const ay = pts[1].ry - pts[0].ry;
            const az = pts[1].rz - pts[0].rz;
            const bx = pts[2].rx - pts[0].rx;
            const by = pts[2].ry - pts[0].ry;
            const bz = pts[2].rz - pts[0].rz;
            const nx = ay * bz - az * by;
            const ny = az * bx - ax * bz;
            const nz = ax * by - ay * bx;
            const len = Math.hypot(nx, ny, nz) || 1;
            const light = Math.max(0.18, Math.min(1, (nx * 0.35 + ny * 0.55 + Math.abs(nz) * 0.75) / len));
            ctx.fillStyle = color;
            ctx.globalAlpha = 0.2 + light * 0.58;
            ctx.fill();
          }

          ctx.globalAlpha = wireframe ? 0.85 : 0.45;
          ctx.strokeStyle = wireframe ? color : "rgba(255, 220, 185, 0.5)";
          ctx.lineWidth = wireframe ? 1.35 : 0.9;
          ctx.stroke();
        }
      }

      // Draw explicit edges (e.g. DNA helix or atomic orbitals)
      if (mesh.edges?.length) {
        ctx.globalAlpha = 0.82;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.6;
        for (const [i1, i2] of mesh.edges) {
          const p1 = projected[i1];
          const p2 = projected[i2];
          if (!p1 || !p2) continue;
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
        for (const p of projected) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
          ctx.fillStyle = "#ffad42";
          ctx.fill();
        }
      }

      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(render);
    };

    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [mesh, autoRotate, wireframe, zoom, color]);

  return (
    <div className="my-3 overflow-hidden rounded-2xl border border-[var(--sk-line)] bg-[var(--sk-glass)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--sk-line)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Box size={15} className="text-[var(--sk-accent-ink)]" />
          <div>
            <h4 className="text-[13.5px] font-semibold text-[var(--sk-text)]">{title}</h4>
            {subtitle && <p className="text-[11px] text-[var(--sk-muted)]">{subtitle}</p>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {!customVertices?.length && !objData && (
            <select
              aria-label="3D geometry preset"
              value={preset}
              onChange={(e) => setPreset(e.target.value)}
              className="rounded-lg border border-[var(--sk-line)] bg-[var(--sk-solid)] px-2 py-1 text-[11px] text-[var(--sk-muted)] outline-none hover:text-[var(--sk-text)]"
            >
              <option value="icosahedron">Icosahedron</option>
              <option value="torus">Torus</option>
              <option value="sphere">Sphere</option>
              <option value="atom">Atomic Orbitals</option>
              <option value="dna_helix">DNA Double Helix</option>
              <option value="wave_surface">Wave Surface</option>
              <option value="cube">Cube</option>
              <option value="pyramid">Pyramid</option>
              <option value="cylinder">Cylinder</option>
            </select>
          )}
          <button
            type="button"
            onClick={() => setWireframe((w) => !w)}
            className={`sk-btn h-7 px-2 text-[11px] ${wireframe ? "bg-[var(--sk-accent-soft)] text-[var(--sk-accent-ink)]" : "text-[var(--sk-muted)]"}`}
            title="Toggle wireframe"
          >
            <Grid size={12} />
            <span className="hidden sm:inline">Wireframe</span>
          </button>
          <button
            type="button"
            onClick={() => setAutoRotate((r) => !r)}
            className="sk-btn h-7 w-7 text-[var(--sk-muted)] hover:text-[var(--sk-text)]"
            title={autoRotate ? "Pause rotation" : "Auto-rotate"}
            aria-label={autoRotate ? "Pause rotation" : "Auto-rotate"}
          >
            {autoRotate ? <Pause size={12} /> : <Play size={12} />}
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(2.2, z + 0.2))}
            className="sk-btn h-7 w-7 text-[var(--sk-muted)] hover:text-[var(--sk-text)]"
            title="Zoom in"
            aria-label="Zoom in"
          >
            <ZoomIn size={12} />
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.5, z - 0.2))}
            className="sk-btn h-7 w-7 text-[var(--sk-muted)] hover:text-[var(--sk-text)]"
            title="Zoom out"
            aria-label="Zoom out"
          >
            <ZoomOut size={12} />
          </button>
          <button
            type="button"
            onClick={() => {
              rotRef.current = { yaw: 0.55, pitch: 0.35 };
              setZoom(1);
            }}
            className="sk-btn h-7 w-7 text-[var(--sk-muted)] hover:text-[var(--sk-text)]"
            title="Reset camera"
            aria-label="Reset camera"
          >
            <RotateCcw size={12} />
          </button>
        </div>
      </div>

      <div className="relative bg-black/35">
        <canvas
          ref={canvasRef}
          width={560}
          height={280}
          onPointerDown={(e) => {
            dragRef.current = { active: true, x: e.clientX, y: e.clientY };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!dragRef.current.active) return;
            const dx = e.clientX - dragRef.current.x;
            const dy = e.clientY - dragRef.current.y;
            dragRef.current = { active: true, x: e.clientX, y: e.clientY };
            rotRef.current.yaw += dx * 0.01;
            rotRef.current.pitch = Math.max(-1.4, Math.min(1.4, rotRef.current.pitch + dy * 0.01));
          }}
          onPointerUp={() => {
            dragRef.current.active = false;
          }}
          className="mx-auto block h-[240px] w-full cursor-grab active:cursor-grabbing"
        />
        <span className="pointer-events-none absolute bottom-2 left-3 text-[10.5px] text-[var(--sk-faint)]">
          Drag to orbit · Scroll or use controls to zoom
        </span>
      </div>

      {annotations && annotations.length > 0 && (
        <div className="grid grid-cols-1 gap-2 border-t border-[var(--sk-line)] p-3 sm:grid-cols-2">
          {annotations.map((a, i) => (
            <div key={i} className="rounded-xl border border-[var(--sk-line)] bg-[var(--sk-raised)] px-3 py-2">
              <div className="text-[12px] font-semibold text-[var(--sk-text)]">{a.label}</div>
              {a.description && <div className="mt-0.5 text-[11px] text-[var(--sk-muted)]">{a.description}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DocumentPreviewCard({
  title,
  fileName,
  fileType = "PDF / Document",
  pageCount,
  summary,
  keyPoints,
  metadata,
  sections,
  onAskSection,
}: {
  title: string;
  fileName?: string;
  fileType?: string;
  pageCount?: number;
  summary?: string;
  keyPoints?: string[];
  metadata?: { label: string; value: string }[];
  sections: UIDocumentSection[];
  onAskSection?: (prompt: string) => void;
}) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [search, setSearch] = useState("");

  const filteredSections = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sections;
    return sections.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.content.toLowerCase().includes(q) ||
        (s.summary && s.summary.toLowerCase().includes(q))
    );
  }, [sections, search]);

  const currentSection = filteredSections[activeIdx] || filteredSections[0];

  return (
    <div className="my-3 overflow-hidden rounded-2xl border border-[var(--sk-line)] bg-[var(--sk-glass)]">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--sk-line)] bg-white/[0.02] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--sk-accent-soft)] text-[var(--sk-accent-ink)]">
            <FileText size={16} />
          </div>
          <div>
            <h4 className="text-[14px] font-semibold text-[var(--sk-text)]">{title}</h4>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--sk-muted)]">
              {fileName && <span>{fileName}</span>}
              <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] uppercase">{fileType}</span>
              {pageCount && <span>{pageCount} {pageCount === 1 ? "page" : "pages"}</span>}
            </div>
          </div>
        </div>

        {sections.length > 1 && (
          <label className="flex items-center gap-1.5 rounded-lg border border-[var(--sk-line)] bg-[var(--sk-solid)] px-2.5 py-1 text-[11.5px] text-[var(--sk-muted)]">
            <Search size={12} />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setActiveIdx(0);
              }}
              placeholder="Search sections…"
              className="w-28 bg-transparent text-[11.5px] text-[var(--sk-text)] outline-none placeholder:text-[var(--sk-faint)] sm:w-36"
            />
          </label>
        )}
      </div>

      {/* Metadata & Executive Summary */}
      {(metadata?.length || summary || keyPoints?.length) && (
        <div className="space-y-2.5 border-b border-[var(--sk-line)] px-4 py-3">
          {metadata && metadata.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {metadata.map((m, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded-lg border border-[var(--sk-line)] bg-[var(--sk-raised)] px-2.5 py-1 text-[11px]"
                >
                  <span className="text-[var(--sk-muted)]">{m.label}:</span>
                  <span className="font-medium text-[var(--sk-text)]">{m.value}</span>
                </span>
              ))}
            </div>
          )}
          {summary && <p className="text-[12.5px] leading-relaxed text-[var(--sk-text)]">{summary}</p>}
          {keyPoints && keyPoints.length > 0 && (
            <ul className="space-y-1 pl-4 text-[12px] text-[var(--sk-muted)] list-disc">
              {keyPoints.map((kp, i) => (
                <li key={i}>{kp}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Section Explorer */}
      {filteredSections.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-[190px_1fr]">
          {filteredSections.length > 1 && (
            <div className="flex gap-1 overflow-x-auto border-b border-[var(--sk-line)] p-2 md:flex-col md:border-b-0 md:border-r">
              {filteredSections.map((sec, idx) => {
                const active = idx === activeIdx;
                return (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => setActiveIdx(idx)}
                    className={`flex shrink-0 items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] transition ${
                      active
                        ? "bg-[var(--sk-accent-soft)] font-medium text-[var(--sk-accent-ink)]"
                        : "text-[var(--sk-muted)] hover:bg-[var(--sk-hover)] hover:text-[var(--sk-text)]"
                    }`}
                  >
                    <span className="truncate">{sec.title}</span>
                    {sec.page !== undefined && <span className="text-[10px] opacity-70">p.{sec.page}</span>}
                  </button>
                );
              })}
            </div>
          )}

          {currentSection && (
            <div className="flex flex-col justify-between p-4">
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h5 className="text-[13.5px] font-semibold text-[var(--sk-text)]">{currentSection.title}</h5>
                  {currentSection.page !== undefined && (
                    <span className="rounded-md bg-white/[0.05] px-2 py-0.5 text-[10.5px] text-[var(--sk-muted)]">
                      Page {currentSection.page}
                    </span>
                  )}
                </div>
                {currentSection.summary && (
                  <p className="mb-2 rounded-lg border-l-2 border-[var(--sk-accent)] bg-[var(--sk-accent-soft)] px-2.5 py-1.5 text-[12px] text-[var(--sk-text)]">
                    {currentSection.summary}
                  </p>
                )}
                <div className="max-h-[260px] overflow-y-auto whitespace-pre-wrap text-[12.5px] leading-relaxed text-[var(--sk-muted)] sk-scroll">
                  {currentSection.content}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--sk-line)] pt-2.5">
                {filteredSections.length > 1 ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={activeIdx <= 0}
                      onClick={() => setActiveIdx((i) => Math.max(0, i - 1))}
                      className="sk-btn h-6.5 w-6.5 border border-[var(--sk-line)]"
                      aria-label="Previous section"
                    >
                      <ChevronLeft size={12} />
                    </button>
                    <span className="px-1.5 text-[11px] text-[var(--sk-muted)]">
                      {activeIdx + 1} / {filteredSections.length}
                    </span>
                    <button
                      type="button"
                      disabled={activeIdx >= filteredSections.length - 1}
                      onClick={() => setActiveIdx((i) => Math.min(filteredSections.length - 1, i + 1))}
                      className="sk-btn h-6.5 w-6.5 border border-[var(--sk-line)]"
                      aria-label="Next section"
                    >
                      <ChevronRight size={12} />
                    </button>
                  </div>
                ) : (
                  <span />
                )}

                {onAskSection && (
                  <button
                    type="button"
                    onClick={() =>
                      onAskSection(
                        `Analyze section "${currentSection.title}" from ${title} in more detail:\n\n${currentSection.content.slice(0, 600)}`
                      )
                    }
                    className="sk-btn h-7 border border-[var(--sk-accent-line)] bg-[var(--sk-accent-soft)] px-2.5 text-[11.5px] text-[var(--sk-accent-ink)] hover:bg-[var(--sk-accent)] hover:text-white"
                  >
                    <Sparkles size={11.5} /> Explore section with Senko
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="p-4 text-center text-[12px] text-[var(--sk-muted)]">No matching document sections found.</div>
      )}
    </div>
  );
}
