import {
  CollageItem,
  CollageProject,
  ImageItem,
  LoadedImageAsset,
  Rect,
  TextItem,
} from '../types/collage';
import { getImageOuterBounds } from './snapEngine';

let measureCanvas: HTMLCanvasElement | null = null;
function getMeasureContext(): CanvasRenderingContext2D | null {
  if (!measureCanvas) {
    measureCanvas = document.createElement('canvas');
  }
  return measureCanvas.getContext('2d');
}

function buildFontString(item: TextItem): string {
  const style = item.fontStyle === 'italic' ? 'italic' : 'normal';
  const weight = item.fontWeight === 'bold' ? 'bold' : 'normal';
  const safeFamily = item.fontFamily.includes(' ')
    ? `"${item.fontFamily}"`
    : item.fontFamily;
  return `${style} ${weight} ${item.fontSize}px ${safeFamily}, sans-serif`;
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number | null
): string[] {
  const paragraphs = text.split(/\r?\n/);
  if (!maxWidth || maxWidth <= 0) {
    return paragraphs.length > 0 ? paragraphs : [''];
  }
  const lines: string[] = [];
  for (const para of paragraphs) {
    if (!para) {
      lines.push('');
      continue;
    }
    const words = para.split(/\s+/);
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth || !current) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) {
      lines.push(current);
    }
  }
  return lines.length > 0 ? lines : [''];
}

export function getTextWorldAnchor(
  item: TextItem,
  imageById: Map<string, ImageItem>
): { x: number; y: number } {
  if (item.parentImageId) {
    const parent = imageById.get(item.parentImageId);
    if (parent) {
      return {
        x: parent.x + item.offsetX,
        y: parent.y + item.offsetY,
      };
    }
  }
  return { x: item.offsetX, y: item.offsetY };
}

export function getTextBoundingBox(
  item: TextItem,
  imageById: Map<string, ImageItem>,
  providedCtx?: CanvasRenderingContext2D
): Rect {
  const ctx = providedCtx ?? getMeasureContext();
  const anchorPos = getTextWorldAnchor(item, imageById);
  const lineHeight = Math.max(12, Math.round(item.fontSize * 1.18));

  if (!ctx) {
    return {
      x: anchorPos.x - 40,
      y: anchorPos.y - lineHeight,
      width: 80,
      height: lineHeight,
    };
  }

  ctx.save();
  ctx.font = buildFontString(item);
  const lines = wrapTextLines(ctx, item.text || 'Text', item.maxWidth);
  let maxLineWidth = 12;
  for (const line of lines) {
    maxLineWidth = Math.max(maxLineWidth, ctx.measureText(line).width);
  }
  ctx.restore();

  const totalWidth = maxLineWidth + item.strokeWidth * 2;
  const totalHeight = lines.length * lineHeight + item.strokeWidth * 2;

  let left = anchorPos.x;
  if (item.textAlign === 'center') {
    left = anchorPos.x - totalWidth / 2;
  } else if (item.textAlign === 'right') {
    left = anchorPos.x - totalWidth + item.strokeWidth;
  } else {
    left = anchorPos.x - item.strokeWidth;
  }

  let top = anchorPos.y;
  if (item.anchor === 'bottom-center') {
    top = anchorPos.y - totalHeight + item.strokeWidth;
  } else if (item.anchor === 'center') {
    top = anchorPos.y - totalHeight / 2;
  } else {
    top = anchorPos.y - item.strokeWidth;
  }

  return {
    x: left,
    y: top,
    width: totalWidth,
    height: totalHeight,
  };
}

export interface ExportBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function computeExportBounds(project: CollageProject): ExportBounds {
  const { canvas, items } = project;
  if (canvas.boundsMode === 'fixed') {
    return {
      x: 0,
      y: 0,
      width: Math.max(1, Math.round(canvas.width)),
      height: Math.max(1, Math.round(canvas.height)),
    };
  }

  if (items.length === 0) {
    return {
      x: 0,
      y: 0,
      width: 1080,
      height: 1080,
    };
  }

  const imageById = new Map<string, ImageItem>();
  for (const item of items) {
    if (item.type === 'image') {
      imageById.set(item.id, item);
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const item of items) {
    const rect =
      item.type === 'image'
        ? getImageOuterBounds(item)
        : getTextBoundingBox(item, imageById);
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }

  const margin = Math.max(0, canvas.outerMargin);
  return {
    x: Math.floor(minX - margin),
    y: Math.floor(minY - margin),
    width: Math.max(1, Math.ceil(maxX - minX + margin * 2)),
    height: Math.max(1, Math.ceil(maxY - minY + margin * 2)),
  };
}

function drawBorder(ctx: CanvasRenderingContext2D, item: ImageItem) {
  const { border, x, y, width, height } = item;
  if (!border.enabled) return;

  const bw = Math.max(0, border.width);
  const kw = Math.max(0, border.outerKeylineWidth);
  if (bw === 0 && kw === 0) return;

  ctx.save();
  if (border.placement === 'inside') {
    // Keyline runs right along the inner perimeter edge; main border sits inside keyline
    if (kw > 0 && width > kw * 2 && height > kw * 2) {
      ctx.strokeStyle = border.outerKeylineColor;
      ctx.lineWidth = kw;
      const kHalf = kw / 2;
      ctx.strokeRect(x + kHalf, y + kHalf, width - kw, height - kw);
    }
    if (bw > 0 && width > (kw + bw) * 2 && height > (kw + bw) * 2) {
      ctx.strokeStyle = border.color;
      ctx.lineWidth = bw;
      const inset = kw + bw / 2;
      ctx.strokeRect(x + inset, y + inset, width - inset * 2, height - inset * 2);
    }
  } else {
    // Outside placement: main border wraps outside image, keyline wraps outside main border
    if (bw > 0) {
      ctx.strokeStyle = border.color;
      ctx.lineWidth = bw;
      const out = bw / 2;
      ctx.strokeRect(x - out, y - out, width + bw, height + bw);
    }
    if (kw > 0) {
      ctx.strokeStyle = border.outerKeylineColor;
      ctx.lineWidth = kw;
      const kOut = bw + kw / 2;
      ctx.strokeRect(x - kOut, y - kOut, width + kOut * 2, height + kOut * 2);
    }
  }
  ctx.restore();
}

function drawMissingPlaceholder(ctx: CanvasRenderingContext2D, item: ImageItem) {
  ctx.save();
  ctx.fillStyle = '#2A1B1B';
  ctx.fillRect(item.x, item.y, item.width, item.height);

  // Diagonal warning stripe pattern
  ctx.beginPath();
  ctx.rect(item.x, item.y, item.width, item.height);
  ctx.clip();
  ctx.strokeStyle = 'rgba(220, 80, 80, 0.25)';
  ctx.lineWidth = 8;
  const maxSpan = item.width + item.height;
  for (let d = -item.height; d < maxSpan; d += 28) {
    ctx.beginPath();
    ctx.moveTo(item.x + d, item.y);
    ctx.lineTo(item.x + d + item.height, item.y + item.height);
    ctx.stroke();
  }

  ctx.fillStyle = '#F87171';
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cx = item.x + item.width / 2;
  const cy = item.y + item.height / 2;
  ctx.fillText('MISSING IMAGE', cx, cy - 14);
  ctx.fillStyle = '#E5E7EB';
  ctx.font = '13px monospace';
  ctx.fillText(item.fileName, cx, cy + 12);
  ctx.restore();
}

function drawImageItem(
  ctx: CanvasRenderingContext2D,
  item: ImageItem,
  assetMap: Map<string, LoadedImageAsset>
) {
  const asset = assetMap.get(item.sourcePath);
  if (!asset) {
    drawMissingPlaceholder(ctx, item);
    drawBorder(ctx, item);
    return;
  }

  const img = asset.element;
  if (item.crop) {
    const sx = Math.max(0, Math.min(img.naturalWidth - 1, item.crop.x));
    const sy = Math.max(0, Math.min(img.naturalHeight - 1, item.crop.y));
    const sw = Math.max(1, Math.min(img.naturalWidth - sx, item.crop.width));
    const sh = Math.max(1, Math.min(img.naturalHeight - sy, item.crop.height));
    ctx.drawImage(img, sx, sy, sw, sh, item.x, item.y, item.width, item.height);
  } else {
    ctx.drawImage(img, item.x, item.y, item.width, item.height);
  }

  drawBorder(ctx, item);
}

function drawTextItem(
  ctx: CanvasRenderingContext2D,
  item: TextItem,
  imageById: Map<string, ImageItem>
) {
  const anchorPos = getTextWorldAnchor(item, imageById);
  const lineHeight = Math.max(12, Math.round(item.fontSize * 1.18));

  ctx.save();
  ctx.font = buildFontString(item);
  ctx.textAlign = item.textAlign;
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  const lines = wrapTextLines(ctx, item.text, item.maxWidth);
  const count = lines.length;

  let startY = anchorPos.y;
  if (item.anchor === 'bottom-center') {
    ctx.textBaseline = 'bottom';
    startY = anchorPos.y - (count - 1) * lineHeight;
  } else if (item.anchor === 'center') {
    ctx.textBaseline = 'middle';
    startY = anchorPos.y - ((count - 1) * lineHeight) / 2;
  } else {
    ctx.textBaseline = 'top';
    startY = anchorPos.y;
  }

  for (let i = 0; i < count; i++) {
    const line = lines[i];
    const lineY = startY + i * lineHeight;

    if (item.strokeWidth > 0) {
      ctx.globalAlpha = item.fillOpacity;
      ctx.strokeStyle = item.strokeColor;
      ctx.lineWidth = item.strokeWidth * 2;
      ctx.strokeText(line, anchorPos.x, lineY);
    }

    ctx.globalAlpha = item.fillOpacity;
    ctx.fillStyle = item.fillColor;
    ctx.fillText(line, anchorPos.x, lineY);
  }

  ctx.restore();
}

function getEffectiveLayerOrder(
  item: CollageItem,
  imageById: Map<string, ImageItem>
): { layerZ: number; subOrder: number } {
  if (item.type === 'text' && item.parentImageId) {
    const parent = imageById.get(item.parentImageId);
    if (parent) {
      return { layerZ: parent.zIndex, subOrder: 1 };
    }
  }
  return { layerZ: item.zIndex, subOrder: 0 };
}

export function compareItemsByLayer(
  a: CollageItem,
  b: CollageItem,
  imageById: Map<string, ImageItem>
): number {
  const oa = getEffectiveLayerOrder(a, imageById);
  const ob = getEffectiveLayerOrder(b, imageById);
  if (oa.layerZ !== ob.layerZ) {
    return oa.layerZ - ob.layerZ;
  }
  if (oa.subOrder !== ob.subOrder) {
    return oa.subOrder - ob.subOrder;
  }
  return a.zIndex - b.zIndex;
}

export function renderCollageScene(
  ctx: CanvasRenderingContext2D,
  project: CollageProject,
  assetMap: Map<string, LoadedImageAsset>,
  exportBounds?: ExportBounds
) {
  const imageById = new Map<string, ImageItem>();
  for (const item of project.items) {
    if (item.type === 'image') {
      imageById.set(item.id, item);
    }
  }

  if (exportBounds) {
    ctx.save();
    if (!project.canvas.transparentBackground) {
      ctx.fillStyle = project.canvas.backgroundColor;
      ctx.fillRect(0, 0, exportBounds.width, exportBounds.height);
    }
    ctx.translate(-exportBounds.x, -exportBounds.y);
  }

  const sortedItems: CollageItem[] = [...project.items].sort((a, b) =>
    compareItemsByLayer(a, b, imageById)
  );

  for (const item of sortedItems) {
    if (item.type === 'image') {
      drawImageItem(ctx, item, assetMap);
    } else {
      drawTextItem(ctx, item, imageById);
    }
  }

  if (exportBounds) {
    ctx.restore();
  }
}

export async function exportCollageToPng(
  project: CollageProject,
  assetMap: Map<string, LoadedImageAsset>,
  suggestedFileName = 'collage.png'
): Promise<boolean> {
  await document.fonts.ready;
  const bounds = computeExportBounds(project);
  const offscreen = document.createElement('canvas');
  offscreen.width = bounds.width;
  offscreen.height = bounds.height;

  const ctx = offscreen.getContext('2d');
  if (!ctx) {
    throw new Error('Could not initialize 2D canvas context for PNG export.');
  }

  renderCollageScene(ctx, project, assetMap, bounds);

  const blob = await new Promise<Blob | null>((resolve) =>
    offscreen.toBlob((b) => resolve(b), 'image/png')
  );
  if (!blob) {
    throw new Error('Failed to encode collage canvas to PNG.');
  }

  if (window.showSaveFilePicker) {
    try {
      const fileHandle = await window.showSaveFilePicker({
        suggestedName: suggestedFileName,
        types: [
          {
            description: 'PNG Image',
            accept: { 'image/png': ['.png'] },
          },
        ],
      });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') {
        return false;
      }
      // Fall through to browser download fallback
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedFileName.endsWith('.png') ? suggestedFileName : `${suggestedFileName}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return true;
}
