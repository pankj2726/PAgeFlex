/** Main-thread image helpers: normalise any browser-decodable image to PNG/JPEG (EXIF applied) for embedding. */
export interface LoadedImage {
  dataUrl: string;
  width: number;
  height: number;
}

export async function fileToImage(file: Blob, maxDim = 3000): Promise<LoadedImage> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * s));
  const h = Math.max(1, Math.round(bmp.height * s));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  const jpeg = file.type === "image/jpeg";
  if (jpeg) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const dataUrl = jpeg ? c.toDataURL("image/jpeg", 0.92) : c.toDataURL("image/png");
  c.width = c.height = 0;
  return { dataUrl, width: w, height: h };
}

/** Crop transparent margins from a canvas and return a PNG data URL. */
export function trimCanvas(src: HTMLCanvasElement): LoadedImage | null {
  const ctx = src.getContext("2d")!;
  const { width, height } = src;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const pad = 4;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  const out = document.createElement("canvas");
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext("2d")!.drawImage(src, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return { dataUrl: out.toDataURL("image/png"), width: out.width, height: out.height };
}
