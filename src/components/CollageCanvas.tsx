import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CollageItem,
  CollageProject,
  CropRect,
  ImageItem,
  LoadedImageAsset,
  Rect,
  SnapGuide,
} from '../types/collage';
import {
  compareItemsByLayer,
  computeExportBounds,
  getTextBoundingBox,
  getTextWorldAnchor,
  renderCollageScene,
} from '../utils/canvasRenderer';
import { computeSnap, getImageOuterBounds } from '../utils/snapEngine';

type HandleKey = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

interface DragMoveState {
  kind: 'move';
  startWorldX: number;
  startWorldY: number;
  initialItems: CollageItem[];
  movingIds: Set<string>;
}

interface DragResizeState {
  kind: 'resize';
  handle: HandleKey;
  itemId: string;
  startWorldX: number;
  startWorldY: number;
  initialItem: ImageItem;
  initialItems: CollageItem[];
}

interface DragCropState {
  kind: 'crop-handle' | 'crop-pan';
  handle?: HandleKey;
  itemId: string;
  startWorldX: number;
  startWorldY: number;
  initialItem: ImageItem;
  initialCrop: CropRect;
  initialItems: CollageItem[];
}

interface DragMarqueeState {
  kind: 'marquee';
  startWorldX: number;
  startWorldY: number;
  currentWorldX: number;
  currentWorldY: number;
  additive: boolean;
  priorSelection: string[];
}

interface DragPanState {
  kind: 'pan';
  startClientX: number;
  startClientY: number;
  startPanX: number;
  startPanY: number;
}

type InteractionState =
  | DragMoveState
  | DragResizeState
  | DragCropState
  | DragMarqueeState
  | DragPanState
  | null;

interface CollageCanvasProps {
  project: CollageProject;
  assetMap: Map<string, LoadedImageAsset>;
  selectedIds: string[];
  croppingImageId: string | null;
  zoom: number;
  panX: number;
  panY: number;
  onCameraChange: (panX: number, panY: number, zoom: number) => void;
  onSelectIds: (ids: string[]) => void;
  onUpdateItems: (items: CollageItem[], commitHistory: boolean) => void;
  onDropAsset: (relativePath: string, worldX: number, worldY: number) => void;
  onExitCropMode: () => void;
  onViewportSizeChange: (width: number, height: number) => void;
  onDoubleClickText: (textId: string) => void;
}

const HANDLE_SIZE = 9;

function getHandlePositions(rect: Rect): Array<{ key: HandleKey; x: number; y: number; cursor: string }> {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const r = rect.x + rect.width;
  const b = rect.y + rect.height;
  return [
    { key: 'nw', x: rect.x, y: rect.y, cursor: 'nwse-resize' },
    { key: 'n', x: cx, y: rect.y, cursor: 'ns-resize' },
    { key: 'ne', x: r, y: rect.y, cursor: 'nesw-resize' },
    { key: 'e', x: r, y: cy, cursor: 'ew-resize' },
    { key: 'se', x: r, y: b, cursor: 'nwse-resize' },
    { key: 's', x: cx, y: b, cursor: 'ns-resize' },
    { key: 'sw', x: rect.x, y: b, cursor: 'nesw-resize' },
    { key: 'w', x: rect.x, y: cy, cursor: 'ew-resize' },
  ];
}

function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function pointInRect(px: number, py: number, rect: Rect): boolean {
  return px >= rect.x && px <= rect.x + rect.width && py >= rect.y && py <= rect.y + rect.height;
}

export const CollageCanvas: React.FC<CollageCanvasProps> = ({
  project,
  assetMap,
  selectedIds,
  croppingImageId,
  zoom,
  panX,
  panY,
  onCameraChange,
  onSelectIds,
  onUpdateItems,
  onDropAsset,
  onExitCropMode,
  onViewportSizeChange,
  onDoubleClickText,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 800, height: 600 });
  const [spaceDown, setSpaceDown] = useState(false);
  const [cursorStyle, setCursorStyle] = useState('default');
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  const interactionRef = useRef<InteractionState>(null);
  const latestItemsRef = useRef<CollageItem[]>(project.items);
  latestItemsRef.current = project.items;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(100, Math.floor(entry.contentRect.width));
        const h = Math.max(100, Math.floor(entry.contentRect.height));
        setViewportSize({ width: w, height: h });
        onViewportSizeChange(w, h);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [onViewportSizeChange]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.code === 'Space' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        setSpaceDown(true);
      }
      if (e.key === 'Escape' && croppingImageId) {
        onExitCropMode();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpaceDown(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [croppingImageId, onExitCropMode]);

  const screenToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - panX) / zoom,
        y: (clientY - rect.top - panY) / zoom,
      };
    },
    [panX, panY, zoom]
  );

  // Draw canvas frame
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(viewportSize.width * dpr);
    canvas.height = Math.round(viewportSize.height * dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);

    // Outer workbench background
    ctx.fillStyle = '#0e0c0a';
    ctx.fillRect(0, 0, viewportSize.width, viewportSize.height);

    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    // Subtle workbench dot grid
    const exportBounds = computeExportBounds(project);

    // Export frame fill
    if (project.canvas.transparentBackground) {
      const tileSize = Math.max(12, Math.round(20 / Math.max(0.25, zoom)));
      ctx.save();
      ctx.beginPath();
      ctx.rect(exportBounds.x, exportBounds.y, exportBounds.width, exportBounds.height);
      ctx.clip();
      ctx.fillStyle = '#262421';
      ctx.fillRect(exportBounds.x, exportBounds.y, exportBounds.width, exportBounds.height);
      ctx.fillStyle = '#312e2a';
      for (let gx = exportBounds.x; gx < exportBounds.x + exportBounds.width; gx += tileSize * 2) {
        for (let gy = exportBounds.y; gy < exportBounds.y + exportBounds.height; gy += tileSize * 2) {
          ctx.fillRect(gx, gy, tileSize, tileSize);
          ctx.fillRect(gx + tileSize, gy + tileSize, tileSize, tileSize);
        }
      }
      ctx.restore();
    } else {
      ctx.fillStyle = project.canvas.backgroundColor;
      ctx.fillRect(exportBounds.x, exportBounds.y, exportBounds.width, exportBounds.height);
    }

    // Export boundary outline
    ctx.save();
    ctx.strokeStyle = 'rgba(218, 165, 32, 0.45)';
    ctx.lineWidth = 1.5 / zoom;
    ctx.setLineDash([8 / zoom, 6 / zoom]);
    ctx.strokeRect(exportBounds.x, exportBounds.y, exportBounds.width, exportBounds.height);
    ctx.restore();

    // Export dimensions pill above top-left corner of export bounds
    ctx.save();
    const labelText = `${project.canvas.boundsMode === 'auto' ? 'Auto-Fit' : 'Fixed'}: ${exportBounds.width} × ${exportBounds.height} px`;
    ctx.font = `600 ${11 / zoom}px sans-serif`;
    const labelPadX = 8 / zoom;
    const labelW = ctx.measureText(labelText).width + labelPadX * 2;
    const labelH = 20 / zoom;
    ctx.fillStyle = 'rgba(24, 20, 16, 0.88)';
    ctx.fillRect(exportBounds.x, exportBounds.y - labelH - 4 / zoom, labelW, labelH);
    ctx.strokeStyle = 'rgba(218, 165, 32, 0.45)';
    ctx.lineWidth = 1 / zoom;
    ctx.strokeRect(exportBounds.x, exportBounds.y - labelH - 4 / zoom, labelW, labelH);
    ctx.fillStyle = '#DAA520';
    ctx.textBaseline = 'middle';
    ctx.fillText(labelText, exportBounds.x + labelPadX, exportBounds.y - labelH / 2 - 4 / zoom);
    ctx.restore();

    // Main collage scene
    renderCollageScene(ctx, project, assetMap);

    // If cropping a specific image, show ghosted full uncropped source behind frame
    if (croppingImageId) {
      const cropItem = project.items.find(
        (it): it is ImageItem => it.id === croppingImageId && it.type === 'image'
      );
      if (cropItem) {
        const asset = assetMap.get(cropItem.sourcePath);
        const crop = cropItem.crop ?? {
          x: 0,
          y: 0,
          width: cropItem.naturalWidth,
          height: cropItem.naturalHeight,
        };
        if (asset && crop.width > 0 && crop.height > 0) {
          const sx = cropItem.width / crop.width;
          const sy = cropItem.height / crop.height;
          const fullX = cropItem.x - crop.x * sx;
          const fullY = cropItem.y - crop.y * sy;
          const fullW = cropItem.naturalWidth * sx;
          const fullH = cropItem.naturalHeight * sy;

          ctx.save();
          ctx.globalAlpha = 0.28;
          ctx.drawImage(asset.element, fullX, fullY, fullW, fullH);
          ctx.globalAlpha = 0.85;
          ctx.strokeStyle = '#F59E0B';
          ctx.lineWidth = 1.5 / zoom;
          ctx.setLineDash([4 / zoom, 4 / zoom]);
          ctx.strokeRect(fullX, fullY, fullW, fullH);
          ctx.restore();
        }
      }
    }

    // Selection highlights & handles
    const imageById = new Map<string, ImageItem>();
    for (const it of project.items) {
      if (it.type === 'image') imageById.set(it.id, it);
    }

    const selectedSet = new Set(selectedIds);
    for (const it of project.items) {
      if (!selectedSet.has(it.id)) continue;

      if (it.type === 'image') {
        const isCropping = croppingImageId === it.id;
        const rect = isCropping ? { x: it.x, y: it.y, width: it.width, height: it.height } : getImageOuterBounds(it);
        ctx.save();
        ctx.strokeStyle = isCropping ? '#F59E0B' : '#38BDF8';
        ctx.lineWidth = 2 / zoom;
        ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
        ctx.restore();
      } else {
        const box = getTextBoundingBox(it, imageById, ctx);
        ctx.save();
        ctx.strokeStyle = '#38BDF8';
        ctx.lineWidth = 1.5 / zoom;
        ctx.setLineDash([4 / zoom, 3 / zoom]);
        ctx.strokeRect(box.x - 3 / zoom, box.y - 3 / zoom, box.width + 6 / zoom, box.height + 6 / zoom);

        if (it.parentImageId) {
          const parent = imageById.get(it.parentImageId);
          if (parent) {
            const anchorPos = getTextWorldAnchor(it, imageById);
            ctx.strokeStyle = 'rgba(218, 165, 32, 0.7)';
            ctx.beginPath();
            ctx.moveTo(anchorPos.x, anchorPos.y);
            ctx.lineTo(parent.x + parent.width / 2, parent.y + parent.height / 2);
            ctx.stroke();
          }
        }
        ctx.restore();
      }
    }

    // Single selected image resize/crop handles
    if (selectedIds.length === 1) {
      const only = project.items.find((it) => it.id === selectedIds[0]);
      if (only && only.type === 'image') {
        const isCropping = croppingImageId === only.id;
        const handleRect = { x: only.x, y: only.y, width: only.width, height: only.height };
        const handles = getHandlePositions(handleRect);
        const hs = HANDLE_SIZE / zoom;
        ctx.save();
        for (const h of handles) {
          ctx.fillStyle = isCropping ? '#F59E0B' : '#FFFFFF';
          ctx.strokeStyle = isCropping ? '#181410' : '#0284C7';
          ctx.lineWidth = 1.5 / zoom;
          ctx.fillRect(h.x - hs / 2, h.y - hs / 2, hs, hs);
          ctx.strokeRect(h.x - hs / 2, h.y - hs / 2, hs, hs);
        }
        ctx.restore();
      }
    }

    // Snap alignment & gap guide lines
    if (snapGuides.length > 0) {
      ctx.save();
      for (const guide of snapGuides) {
        ctx.strokeStyle = guide.kind === 'gap' ? '#F59E0B' : '#EC4899';
        ctx.lineWidth = 1.25 / zoom;
        ctx.setLineDash(guide.kind === 'gap' ? [] : [5 / zoom, 4 / zoom]);
        ctx.beginPath();
        if (guide.axis === 'x') {
          ctx.moveTo(guide.position, guide.start);
          ctx.lineTo(guide.position, guide.end);
        } else {
          ctx.moveTo(guide.start, guide.position);
          ctx.lineTo(guide.end, guide.position);
        }
        ctx.stroke();

        if (guide.kind === 'gap' && guide.gapLabelPos && guide.gapPx !== undefined) {
          const text = `${guide.gapPx}px`;
          ctx.font = `bold ${11 / zoom}px sans-serif`;
          const tw = ctx.measureText(text).width + 10 / zoom;
          const th = 18 / zoom;
          const bx = guide.gapLabelPos.x - tw / 2;
          const by = guide.gapLabelPos.y - th / 2;
          ctx.fillStyle = '#F59E0B';
          ctx.fillRect(bx, by, tw, th);
          ctx.fillStyle = '#181410';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(text, guide.gapLabelPos.x, guide.gapLabelPos.y);
        }
      }
      ctx.restore();
    }

    // Marquee selection box
    if (interactionRef.current?.kind === 'marquee') {
      const m = interactionRef.current;
      const mx = Math.min(m.startWorldX, m.currentWorldX);
      const my = Math.min(m.startWorldY, m.currentWorldY);
      const mw = Math.abs(m.currentWorldX - m.startWorldX);
      const mh = Math.abs(m.currentWorldY - m.startWorldY);
      ctx.save();
      ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 1.5 / zoom;
      ctx.fillRect(mx, my, mw, mh);
      ctx.strokeRect(mx, my, mw, mh);
      ctx.restore();
    }

    ctx.restore();
    ctx.restore();
  }, [project, assetMap, selectedIds, croppingImageId, zoom, panX, panY, viewportSize, snapGuides]);

  const hitTestTopItem = useCallback(
    (wx: number, wy: number): CollageItem | null => {
      const ctx = canvasRef.current?.getContext('2d') ?? undefined;
      const imageById = new Map<string, ImageItem>();
      for (const it of project.items) {
        if (it.type === 'image') imageById.set(it.id, it);
      }
      const sortedDesc = [...project.items].sort(
        (a, b) => -compareItemsByLayer(a, b, imageById)
      );
      for (const item of sortedDesc) {
        if (item.type === 'text') {
          const box = getTextBoundingBox(item, imageById, ctx);
          if (pointInRect(wx, wy, box)) return item;
        } else {
          const rect = getImageOuterBounds(item);
          if (pointInRect(wx, wy, rect)) return item;
        }
      }
      return null;
    },
    [project.items]
  );

  const hitTestHandle = useCallback(
    (wx: number, wy: number): { item: ImageItem; handle: HandleKey; cursor: string } | null => {
      if (selectedIds.length !== 1) return null;
      const item = project.items.find(
        (it): it is ImageItem => it.id === selectedIds[0] && it.type === 'image'
      );
      if (!item) return null;
      const handles = getHandlePositions({ x: item.x, y: item.y, width: item.width, height: item.height });
      const hitRadius = (HANDLE_SIZE + 5) / zoom;
      for (const h of handles) {
        if (Math.abs(wx - h.x) <= hitRadius && Math.abs(wy - h.y) <= hitRadius) {
          return { item, handle: h.key, cursor: h.cursor };
        }
      }
      return null;
    },
    [project.items, selectedIds, zoom]
  );

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Pan with Middle Mouse, Right Mouse, or Space+Left
    if (e.button === 1 || e.button === 2 || (e.button === 0 && spaceDown)) {
      e.preventDefault();
      interactionRef.current = {
        kind: 'pan',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPanX: panX,
        startPanY: panY,
      };
      setCursorStyle('grabbing');
      return;
    }

    if (e.button !== 0) return;

    const world = screenToWorld(e.clientX, e.clientY);

    // 1. Check handle hit on single selected image
    const handleHit = hitTestHandle(world.x, world.y);
    if (handleHit) {
      if (croppingImageId === handleHit.item.id) {
        const initCrop: CropRect = handleHit.item.crop ?? {
          x: 0,
          y: 0,
          width: handleHit.item.naturalWidth,
          height: handleHit.item.naturalHeight,
        };
        interactionRef.current = {
          kind: 'crop-handle',
          handle: handleHit.handle,
          itemId: handleHit.item.id,
          startWorldX: world.x,
          startWorldY: world.y,
          initialItem: { ...handleHit.item },
          initialCrop: { ...initCrop },
          initialItems: project.items,
        };
      } else {
        interactionRef.current = {
          kind: 'resize',
          handle: handleHit.handle,
          itemId: handleHit.item.id,
          startWorldX: world.x,
          startWorldY: world.y,
          initialItem: { ...handleHit.item },
          initialItems: project.items,
        };
      }
      return;
    }

    // 2. If currently cropping an image, check if clicking inside it to pan crop
    if (croppingImageId) {
      const cropItem = project.items.find(
        (it): it is ImageItem => it.id === croppingImageId && it.type === 'image'
      );
      if (cropItem && pointInRect(world.x, world.y, cropItem)) {
        const initCrop: CropRect = cropItem.crop ?? {
          x: 0,
          y: 0,
          width: cropItem.naturalWidth,
          height: cropItem.naturalHeight,
        };
        interactionRef.current = {
          kind: 'crop-pan',
          itemId: cropItem.id,
          startWorldX: world.x,
          startWorldY: world.y,
          initialItem: { ...cropItem },
          initialCrop: { ...initCrop },
          initialItems: project.items,
        };
        setCursorStyle('move');
        return;
      } else {
        onExitCropMode();
      }
    }

    // 3. Hit test items
    const hit = hitTestTopItem(world.x, world.y);
    if (hit) {
      let nextSelected: string[];
      if (e.shiftKey) {
        if (selectedIds.includes(hit.id)) {
          nextSelected = selectedIds.filter((id) => id !== hit.id);
        } else {
          nextSelected = [...selectedIds, hit.id];
        }
        onSelectIds(nextSelected);
        if (!nextSelected.includes(hit.id)) {
          return;
        }
      } else if (!selectedIds.includes(hit.id)) {
        nextSelected = [hit.id];
        onSelectIds(nextSelected);
      } else {
        nextSelected = selectedIds;
      }

      interactionRef.current = {
        kind: 'move',
        startWorldX: world.x,
        startWorldY: world.y,
        initialItems: project.items,
        movingIds: new Set(nextSelected),
      };
      setCursorStyle('move');
      return;
    }

    // 4. Empty space -> Marquee selection
    if (!e.shiftKey) {
      onSelectIds([]);
    }
    interactionRef.current = {
      kind: 'marquee',
      startWorldX: world.x,
      startWorldY: world.y,
      currentWorldX: world.x,
      currentWorldY: world.y,
      additive: e.shiftKey,
      priorSelection: selectedIds,
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const inter = interactionRef.current;
    if (!inter) {
      if (spaceDown) {
        setCursorStyle('grab');
        return;
      }
      const world = screenToWorld(e.clientX, e.clientY);
      const h = hitTestHandle(world.x, world.y);
      if (h) {
        setCursorStyle(h.cursor);
      } else {
        const hit = hitTestTopItem(world.x, world.y);
        setCursorStyle(hit ? 'move' : 'default');
      }
      return;
    }

    if (inter.kind === 'pan') {
      const dx = e.clientX - inter.startClientX;
      const dy = e.clientY - inter.startClientY;
      onCameraChange(inter.startPanX + dx, inter.startPanY + dy, zoom);
      return;
    }

    const world = screenToWorld(e.clientX, e.clientY);
    const rawDx = world.x - inter.startWorldX;
    const rawDy = world.y - inter.startWorldY;

    if (inter.kind === 'marquee') {
      inter.currentWorldX = world.x;
      inter.currentWorldY = world.y;
      const box: Rect = {
        x: Math.min(inter.startWorldX, world.x),
        y: Math.min(inter.startWorldY, world.y),
        width: Math.abs(world.x - inter.startWorldX),
        height: Math.abs(world.y - inter.startWorldY),
      };
      const ctx = canvasRef.current?.getContext('2d') ?? undefined;
      const imageById = new Map<string, ImageItem>();
      for (const it of project.items) {
        if (it.type === 'image') imageById.set(it.id, it);
      }
      const hits: string[] = [];
      for (const it of project.items) {
        const r =
          it.type === 'image' ? getImageOuterBounds(it) : getTextBoundingBox(it, imageById, ctx);
        if (rectsIntersect(box, r)) hits.push(it.id);
      }
      const merged = inter.additive
        ? Array.from(new Set([...inter.priorSelection, ...hits]))
        : hits;
      onSelectIds(merged);
      return;
    }

    if (inter.kind === 'move') {
      const movingImages = inter.initialItems.filter(
        (it): it is ImageItem => it.type === 'image' && inter.movingIds.has(it.id)
      );

      let dx = Math.round(rawDx);
      let dy = Math.round(rawDy);

      // Magnetic snap for moving images unless Alt is held
      if (movingImages.length > 0 && !e.altKey && project.canvas.snap.enabled) {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const img of movingImages) {
          const b = getImageOuterBounds(img);
          minX = Math.min(minX, b.x + dx);
          minY = Math.min(minY, b.y + dy);
          maxX = Math.max(maxX, b.x + b.width + dx);
          maxY = Math.max(maxY, b.y + b.height + dy);
        }
        const movingRect: Rect = {
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
        };
        const targetRects = inter.initialItems
          .filter((it): it is ImageItem => it.type === 'image' && !inter.movingIds.has(it.id))
          .map(getImageOuterBounds);

        if (project.canvas.boundsMode === 'fixed') {
          targetRects.push({
            x: 0,
            y: 0,
            width: project.canvas.width,
            height: project.canvas.height,
          });
        }

        const snapResult = computeSnap(movingRect, targetRects, project.canvas.snap, zoom);
        dx = Math.round(dx + snapResult.dx);
        dy = Math.round(dy + snapResult.dy);
        setSnapGuides(snapResult.guides);
      } else {
        setSnapGuides([]);
      }

      const nextItems = inter.initialItems.map((it) => {
        if (!inter.movingIds.has(it.id)) return it;
        if (it.type === 'image') {
          return { ...it, x: it.x + dx, y: it.y + dy };
        }
        // Only offset text directly if its parent image isn't also moving
        if (it.parentImageId && inter.movingIds.has(it.parentImageId)) {
          return it;
        }
        return { ...it, offsetX: it.offsetX + dx, offsetY: it.offsetY + dy };
      });
      onUpdateItems(nextItems, false);
      return;
    }

    if (inter.kind === 'resize') {
      const init = inter.initialItem;
      const keepAspect = init.aspectLocked ? !e.shiftKey : e.shiftKey;
      const aspect = Math.max(0.01, init.width / Math.max(1, init.height));

      let x = init.x;
      let y = init.y;
      let w = init.width;
      let h = init.height;

      const hasW = inter.handle.includes('w');
      const hasE = inter.handle.includes('e');
      const hasN = inter.handle.includes('n');
      const hasS = inter.handle.includes('s');

      if (hasE) w = Math.max(20, Math.round(init.width + rawDx));
      if (hasS) h = Math.max(20, Math.round(init.height + rawDy));
      if (hasW) {
        w = Math.max(20, Math.round(init.width - rawDx));
        x = init.x + init.width - w;
      }
      if (hasN) {
        h = Math.max(20, Math.round(init.height - rawDy));
        y = init.y + init.height - h;
      }

      if (keepAspect) {
        if ((hasW || hasE) && (hasN || hasS)) {
          // Corner handle: lock aspect using dominant axis delta
          if (Math.abs(w - init.width) >= Math.abs(h - init.height) * aspect) {
            h = Math.max(20, Math.round(w / aspect));
            if (hasN) y = init.y + init.height - h;
          } else {
            w = Math.max(20, Math.round(h * aspect));
            if (hasW) x = init.x + init.width - w;
          }
        } else if (hasE || hasW) {
          h = Math.max(20, Math.round(w / aspect));
        } else if (hasN || hasS) {
          w = Math.max(20, Math.round(h * aspect));
        }
      }

      const nextItems = inter.initialItems.map((it) =>
        it.id === inter.itemId && it.type === 'image' ? { ...it, x, y, width: w, height: h } : it
      );
      onUpdateItems(nextItems, false);
      return;
    }

    if (inter.kind === 'crop-pan') {
      const init = inter.initialItem;
      const crop = inter.initialCrop;
      const scaleX = crop.width / Math.max(1, init.width);
      const scaleY = crop.height / Math.max(1, init.height);
      const nextCropX = Math.max(
        0,
        Math.min(init.naturalWidth - crop.width, Math.round(crop.x - rawDx * scaleX))
      );
      const nextCropY = Math.max(
        0,
        Math.min(init.naturalHeight - crop.height, Math.round(crop.y - rawDy * scaleY))
      );
      const nextItems = inter.initialItems.map((it) =>
        it.id === inter.itemId && it.type === 'image'
          ? { ...it, crop: { ...crop, x: nextCropX, y: nextCropY } }
          : it
      );
      onUpdateItems(nextItems, false);
      return;
    }

    if (inter.kind === 'crop-handle' && inter.handle) {
      const init = inter.initialItem;
      const crop = inter.initialCrop;
      const pxPerSrcX = init.width / Math.max(1, crop.width);
      const pxPerSrcY = init.height / Math.max(1, crop.height);

      let left = init.x;
      let top = init.y;
      let right = init.x + init.width;
      let bottom = init.y + init.height;

      let cx = crop.x;
      let cy = crop.y;
      let cr = crop.x + crop.width;
      let cb = crop.y + crop.height;

      const minSrc = 16;
      if (inter.handle.includes('w')) {
        const deltaSrc = rawDx / pxPerSrcX;
        const clampedCx = Math.max(0, Math.min(cr - minSrc, crop.x + deltaSrc));
        left = Math.round(init.x + (clampedCx - crop.x) * pxPerSrcX);
        cx = Math.round(clampedCx);
      }
      if (inter.handle.includes('e')) {
        const deltaSrc = rawDx / pxPerSrcX;
        const clampedCr = Math.min(init.naturalWidth, Math.max(cx + minSrc, crop.x + crop.width + deltaSrc));
        right = Math.round(init.x + init.width + (clampedCr - (crop.x + crop.width)) * pxPerSrcX);
        cr = Math.round(clampedCr);
      }
      if (inter.handle.includes('n')) {
        const deltaSrc = rawDy / pxPerSrcY;
        const clampedCy = Math.max(0, Math.min(cb - minSrc, crop.y + deltaSrc));
        top = Math.round(init.y + (clampedCy - crop.y) * pxPerSrcY);
        cy = Math.round(clampedCy);
      }
      if (inter.handle.includes('s')) {
        const deltaSrc = rawDy / pxPerSrcY;
        const clampedCb = Math.min(init.naturalHeight, Math.max(cy + minSrc, crop.y + crop.height + deltaSrc));
        bottom = Math.round(init.y + init.height + (clampedCb - (crop.y + crop.height)) * pxPerSrcY);
        cb = Math.round(clampedCb);
      }

      const nextCrop: CropRect = {
        x: cx,
        y: cy,
        width: Math.max(1, cr - cx),
        height: Math.max(1, cb - cy),
      };
      const nextItems = inter.initialItems.map((it) =>
        it.id === inter.itemId && it.type === 'image'
          ? {
              ...it,
              x: left,
              y: top,
              width: Math.max(10, right - left),
              height: Math.max(10, bottom - top),
              crop: nextCrop,
            }
          : it
      );
      onUpdateItems(nextItems, false);
    }
  };

  const finishInteraction = () => {
    const inter = interactionRef.current;
    if (!inter) return;
    interactionRef.current = null;
    setSnapGuides([]);
    setCursorStyle('default');

    if (
      inter.kind === 'move' ||
      inter.kind === 'resize' ||
      inter.kind === 'crop-pan' ||
      inter.kind === 'crop-handle'
    ) {
      if (latestItemsRef.current !== inter.initialItems) {
        onUpdateItems(latestItemsRef.current, true);
      }
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const nextZoom = Math.min(6, Math.max(0.08, zoom * factor));
    const worldX = (mouseX - panX) / zoom;
    const worldY = (mouseY - panY) / zoom;
    const nextPanX = mouseX - worldX * nextZoom;
    const nextPanY = mouseY - worldY * nextZoom;
    onCameraChange(nextPanX, nextPanY, nextZoom);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const world = screenToWorld(e.clientX, e.clientY);
    const hit = hitTestTopItem(world.x, world.y);
    if (hit && hit.type === 'text') {
      onSelectIds([hit.id]);
      onDoubleClickText(hit.id);
    }
  };

  return (
    <main
      ref={containerRef}
      className={`canvas-stage ${isDragOver ? 'is-drag-over' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-collage-asset')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setIsDragOver(true);
        }
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        const relPath = e.dataTransfer.getData('application/x-collage-asset');
        if (!relPath) return;
        const world = screenToWorld(e.clientX, e.clientY);
        onDropAsset(relPath, Math.round(world.x), Math.round(world.y));
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ cursor: cursorStyle, width: '100%', height: '100%', display: 'block' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={finishInteraction}
        onMouseLeave={finishInteraction}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      />

      {project.items.length === 0 && (
        <div className="canvas-onboarding-overlay">
          <div className="canvas-onboarding-card">
            <h3>Build Your Collage</h3>
            <p>Drag portraits from the left folder browser onto this canvas.</p>
            <ul>
              <li><strong>Drag edges near another portrait:</strong> Snaps cleanly at your pixel gap or 0px flush</li>
              <li><strong>Hold Alt while dragging:</strong> Bypass snapping for overlapping portraits</li>
              <li><strong>Mouse wheel / Middle-drag / Space+drag:</strong> Zoom and pan</li>
            </ul>
          </div>
        </div>
      )}

      {croppingImageId && (
        <div className="crop-banner">
          <span>Crop Mode — Drag handles to trim or drag inside frame to pan</span>
          <button type="button" className="btn btn-primary" onClick={onExitCropMode}>
            Done Cropping
          </button>
        </div>
      )}
    </main>
  );
};
