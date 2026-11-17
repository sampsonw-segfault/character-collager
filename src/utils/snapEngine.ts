import { ImageItem, Rect, SnapGuide, SnapSettings } from '../types/collage';

export function getImageOuterBounds(item: ImageItem): Rect {
  if (!item.border.enabled || item.border.placement === 'inside') {
    return {
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
    };
  }
  const pad = Math.max(0, item.border.width) + Math.max(0, item.border.outerKeylineWidth);
  return {
    x: item.x - pad,
    y: item.y - pad,
    width: item.width + pad * 2,
    height: item.height + pad * 2,
  };
}

interface SnapCandidate {
  delta: number;
  absDelta: number;
  guide: SnapGuide;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

export function computeSnap(
  movingRect: Rect,
  targetRects: Rect[],
  snapSettings: SnapSettings,
  zoom: number
): SnapResult {
  if (!snapSettings.enabled || targetRects.length === 0) {
    return { dx: 0, dy: 0, guides: [] };
  }

  const threshold = Math.max(2, snapSettings.thresholdPx / Math.max(0.15, zoom));
  const gapX = Math.max(0, snapSettings.gapX);
  const gapY = Math.max(0, snapSettings.gapY);

  const mLeft = movingRect.x;
  const mRight = movingRect.x + movingRect.width;
  const mCenterX = movingRect.x + movingRect.width / 2;

  const mTop = movingRect.y;
  const mBottom = movingRect.y + movingRect.height;
  const mCenterY = movingRect.y + movingRect.height / 2;

  let bestX: SnapCandidate | null = null;
  let bestY: SnapCandidate | null = null;

  const considerX = (candidate: SnapCandidate) => {
    if (candidate.absDelta <= threshold && (!bestX || candidate.absDelta < bestX.absDelta)) {
      bestX = candidate;
    }
  };

  const considerY = (candidate: SnapCandidate) => {
    if (candidate.absDelta <= threshold && (!bestY || candidate.absDelta < bestY.absDelta)) {
      bestY = candidate;
    }
  };

  for (const t of targetRects) {
    const tLeft = t.x;
    const tRight = t.x + t.width;
    const tCenterX = t.x + t.width / 2;

    const tTop = t.y;
    const tBottom = t.y + t.height;
    const tCenterY = t.y + t.height / 2;

    const spanStartY = Math.min(mTop, tTop) - 24;
    const spanEndY = Math.max(mBottom, tBottom) + 24;
    const spanStartX = Math.min(mLeft, tLeft) - 24;
    const spanEndX = Math.max(mRight, tRight) + 24;
    const midY = (Math.max(mTop, tTop) + Math.min(mBottom, tBottom)) / 2 || (mCenterY + tCenterY) / 2;
    const midX = (Math.max(mLeft, tLeft) + Math.min(mRight, tRight)) / 2 || (mCenterX + tCenterX) / 2;

    // X alignment stops
    considerX({
      delta: tLeft - mLeft,
      absDelta: Math.abs(tLeft - mLeft),
      guide: { axis: 'x', position: tLeft, start: spanStartY, end: spanEndY, kind: 'align' },
    });
    considerX({
      delta: tRight - mRight,
      absDelta: Math.abs(tRight - mRight),
      guide: { axis: 'x', position: tRight, start: spanStartY, end: spanEndY, kind: 'align' },
    });
    considerX({
      delta: tCenterX - mCenterX,
      absDelta: Math.abs(tCenterX - mCenterX),
      guide: { axis: 'x', position: tCenterX, start: spanStartY, end: spanEndY, kind: 'align' },
    });
    // Flush edge-to-edge (0px)
    considerX({
      delta: tRight - mLeft,
      absDelta: Math.abs(tRight - mLeft),
      guide: {
        axis: 'x',
        position: tRight,
        start: spanStartY,
        end: spanEndY,
        kind: 'gap',
        gapPx: 0,
        gapLabelPos: { x: tRight, y: midY },
      },
    });
    considerX({
      delta: tLeft - mRight,
      absDelta: Math.abs(tLeft - mRight),
      guide: {
        axis: 'x',
        position: tLeft,
        start: spanStartY,
        end: spanEndY,
        kind: 'gap',
        gapPx: 0,
        gapLabelPos: { x: tLeft, y: midY },
      },
    });
    // Margin gap stops (gapX)
    if (gapX > 0) {
      considerX({
        delta: tRight + gapX - mLeft,
        absDelta: Math.abs(tRight + gapX - mLeft),
        guide: {
          axis: 'x',
          position: tRight + gapX,
          start: spanStartY,
          end: spanEndY,
          kind: 'gap',
          gapPx: gapX,
          gapLabelPos: { x: tRight + gapX / 2, y: midY },
        },
      });
      considerX({
        delta: tLeft - gapX - mRight,
        absDelta: Math.abs(tLeft - gapX - mRight),
        guide: {
          axis: 'x',
          position: tLeft - gapX,
          start: spanStartY,
          end: spanEndY,
          kind: 'gap',
          gapPx: gapX,
          gapLabelPos: { x: tLeft - gapX / 2, y: midY },
        },
      });
    }

    // Y alignment stops
    considerY({
      delta: tTop - mTop,
      absDelta: Math.abs(tTop - mTop),
      guide: { axis: 'y', position: tTop, start: spanStartX, end: spanEndX, kind: 'align' },
    });
    considerY({
      delta: tBottom - mBottom,
      absDelta: Math.abs(tBottom - mBottom),
      guide: { axis: 'y', position: tBottom, start: spanStartX, end: spanEndX, kind: 'align' },
    });
    considerY({
      delta: tCenterY - mCenterY,
      absDelta: Math.abs(tCenterY - mCenterY),
      guide: { axis: 'y', position: tCenterY, start: spanStartX, end: spanEndX, kind: 'align' },
    });
    // Flush edge-to-edge (0px)
    considerY({
      delta: tBottom - mTop,
      absDelta: Math.abs(tBottom - mTop),
      guide: {
        axis: 'y',
        position: tBottom,
        start: spanStartX,
        end: spanEndX,
        kind: 'gap',
        gapPx: 0,
        gapLabelPos: { x: midX, y: tBottom },
      },
    });
    considerY({
      delta: tTop - mBottom,
      absDelta: Math.abs(tTop - mBottom),
      guide: {
        axis: 'y',
        position: tTop,
        start: spanStartX,
        end: spanEndX,
        kind: 'gap',
        gapPx: 0,
        gapLabelPos: { x: midX, y: tTop },
      },
    });
    // Margin gap stops (gapY)
    if (gapY > 0) {
      considerY({
        delta: tBottom + gapY - mTop,
        absDelta: Math.abs(tBottom + gapY - mTop),
        guide: {
          axis: 'y',
          position: tBottom + gapY,
          start: spanStartX,
          end: spanEndX,
          kind: 'gap',
          gapPx: gapY,
          gapLabelPos: { x: midX, y: tBottom + gapY / 2 },
        },
      });
      considerY({
        delta: tTop - gapY - mBottom,
        absDelta: Math.abs(tTop - gapY - mBottom),
        guide: {
          axis: 'y',
          position: tTop - gapY,
          start: spanStartX,
          end: spanEndX,
          kind: 'gap',
          gapPx: gapY,
          gapLabelPos: { x: midX, y: tTop - gapY / 2 },
        },
      });
    }
  }

  const guides: SnapGuide[] = [];
  const dx = bestX ? (bestX as SnapCandidate).delta : 0;
  const dy = bestY ? (bestY as SnapCandidate).delta : 0;
  if (bestX) guides.push((bestX as SnapCandidate).guide);
  if (bestY) guides.push((bestY as SnapCandidate).guide);

  return { dx, dy, guides };
}
