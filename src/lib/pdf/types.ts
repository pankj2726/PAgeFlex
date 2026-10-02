import type { Box } from "../model/coords";
import type { PdfObject } from "../model/objects";

/** Everything below is plain data so it can cross the worker boundary via structured clone. */
export interface ExportSource {
  id: string;
  bytes: Uint8Array;
  password?: string;
}

export interface ExportPage {
  id: string;
  sourceId: string | null;
  srcIndex: number;
  rotation: number;
  cropBox: Box;
}

export interface KeepRun {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  size: number;
  baseline: number;
}

export interface Raster {
  bytes: Uint8Array;
  mime: string;
  width: number;
  height: number;
}

export interface ExportPayload {
  sources: ExportSource[];
  primaryId: string;
  pages: ExportPage[];
  objects: PdfObject[];
  /** raster fallback for text containing glyphs outside WinAnsi, keyed by object id */
  rasters: Record<string, Raster>;
  /** per-page redaction raster (black boxes burned in) + the text runs that may stay as an invisible layer */
  redactions: Record<string, { raster: Raster; keepRuns: KeepRun[] }>;
}

export type Progress = (value: number, label?: string) => void;

export interface Metadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
}
