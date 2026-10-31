// Client & server compatible document and 3D model reader for uploaded files (.pdf, .txt, .md, .csv, .json, .obj, etc.)
import type { UIDocumentSection } from "./ui-schema";

export interface ExtractedDocument {
  fileName: string;
  fileType: string;
  pageCount: number;
  summary: string;
  sections: UIDocumentSection[];
  rawText: string;
  is3DModel?: boolean;
  objData?: string;
}

/**
 * Extracts readable text and page sections from a PDF ArrayBuffer without requiring external native binaries.
 */
function extractPdfPages(buffer: ArrayBuffer): { pages: string[]; rawText: string } {
  const bytes = new Uint8Array(buffer);
  const latin1 = new TextDecoder("latin1").decode(bytes);

  const pageChunks = latin1.split(/\/Type\s*\/Page\b/g);
  const pages: string[] = [];

  const decodePdfString = (s: string): string =>
    s
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, " ")
      .replace(/\\t/g, " ")
      .replace(/\\\(/g, "(")
      .replace(/\\\)/g, ")")
      .replace(/\\\\/g, "\\");

  const extractFromChunk = (chunk: string): string => {
    const pieces: string[] = [];
    // Match BT ... ET text blocks or (...) Tj / [...] TJ operators
    const tjRe = /\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*Tj/g;
    let m: RegExpExecArray | null;
    while ((m = tjRe.exec(chunk)) !== null) {
      const t = decodePdfString(m[1]).trim();
      if (t) pieces.push(t);
    }

    const tjArrRe = /\[([^\]]+)\]\s*TJ/g;
    while ((m = tjArrRe.exec(chunk)) !== null) {
      const inner = m[1];
      const strRe = /\(([^()\\]*(?:\\.[^()\\]*)*)\)/g;
      let sm: RegExpExecArray | null;
      const lineParts: string[] = [];
      while ((sm = strRe.exec(inner)) !== null) {
        lineParts.push(decodePdfString(sm[1]));
      }
      if (lineParts.length) pieces.push(lineParts.join(""));
    }

    return pieces.join(" ").replace(/\s+/g, " ").trim();
  };

  for (let i = 1; i < pageChunks.length; i++) {
    const text = extractFromChunk(pageChunks[i]);
    if (text) pages.push(text);
  }

  if (!pages.length) {
    const whole = extractFromChunk(latin1);
    if (whole) pages.push(whole);
  }

  // Fallback: extract printable ASCII runs if PDF streams were compressed
  if (!pages.length) {
    const ascii =
      latin1
        .match(/[A-Za-z0-9 ,.;:'"?!()-]{18,}/g)
        ?.filter((line) => !/\/Filter|\/Length|\/Resources|\/Font|\/Type|\/Parent|\/MediaBox|obj|endobj|stream/i.test(line))
        .slice(0, 60)
        .join("\n") || "PDF document attached.";
    pages.push(ascii);
  }

  return {
    pages,
    rawText: pages.join("\n\n"),
  };
}

export async function extractDocumentFromFile(file: File): Promise<ExtractedDocument> {
  const name = file.name || "Document";
  const ext = name.split(".").pop()?.toLowerCase() || "";

  if (ext === "obj") {
    const text = await file.text();
    const vCount = (text.match(/^v\s+/gm) || []).length;
    const fCount = (text.match(/^f\s+/gm) || []).length;
    return {
      fileName: name,
      fileType: "3D Model (OBJ)",
      pageCount: 1,
      summary: `3D Wavefront OBJ mesh (${vCount} vertices, ${fCount} faces).`,
      sections: [
        {
          id: "sec_0",
          title: "Mesh Geometry",
          page: 1,
          content: text.slice(0, 2000),
        },
      ],
      rawText: `3D OBJ file "${name}" (${vCount} vertices, ${fCount} faces).`,
      is3DModel: true,
      objData: text.slice(0, 120_000),
    };
  }

  if (ext === "pdf" || file.type === "application/pdf") {
    const buf = await file.arrayBuffer();
    const { pages, rawText } = extractPdfPages(buf);
    const sections: UIDocumentSection[] = pages.slice(0, 20).map((p, idx) => ({
      id: `page_${idx + 1}`,
      title: `Page ${idx + 1}`,
      page: idx + 1,
      content: p.slice(0, 3000),
    }));
    return {
      fileName: name,
      fileType: "PDF Document",
      pageCount: Math.max(1, pages.length),
      summary: rawText.slice(0, 280) + (rawText.length > 280 ? "…" : ""),
      sections,
      rawText: rawText.slice(0, 24_000),
    };
  }

  const text = await file.text();
  const lines = text.split(/\r?\n/);

  // Split markdown or long text into logical sections
  const sections: UIDocumentSection[] = [];
  let currentTitle = "Section 1";
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = /^#{1,3}\s+(.+)$/.exec(line.trim());
    if (headingMatch && currentLines.length > 0) {
      sections.push({
        id: `sec_${sections.length + 1}`,
        title: currentTitle,
        page: sections.length + 1,
        content: currentLines.join("\n").trim().slice(0, 3500),
      });
      currentTitle = headingMatch[1].trim();
      currentLines = [];
    } else {
      currentLines.push(line);
      if (currentLines.length >= 80 && sections.length < 15) {
        sections.push({
          id: `sec_${sections.length + 1}`,
          title: currentTitle,
          page: sections.length + 1,
          content: currentLines.join("\n").trim().slice(0, 3500),
        });
        currentTitle = `Part ${sections.length + 1}`;
        currentLines = [];
      }
    }
  }

  if (currentLines.length > 0 || !sections.length) {
    sections.push({
      id: `sec_${sections.length + 1}`,
      title: currentTitle,
      page: sections.length + 1,
      content: currentLines.join("\n").trim().slice(0, 3500) || "(Empty document)",
    });
  }

  return {
    fileName: name,
    fileType: ext ? `${ext.toUpperCase()} File` : "Document",
    pageCount: sections.length,
    summary: text.slice(0, 280).replace(/\s+/g, " ").trim(),
    sections,
    rawText: text.slice(0, 24_000),
  };
}
