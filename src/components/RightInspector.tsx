import React, { useMemo, useRef } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Crop,
  Image as ImageIcon,
  Layers,
  Lock,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  Type,
  Unlock,
  Upload,
} from 'lucide-react';
import {
  BUILTIN_FONTS,
  CK3_BACKGROUND_SWATCHES,
  CK3_BORDER_SWATCHES,
} from '../presets/ck3Presets';
import {
  BorderStyle,
  CanvasSettings,
  CollageItem,
  CustomFontRecord,
  ImageItem,
  LoadedImageAsset,
  TextItem,
} from '../types/collage';
import { computeExportBounds } from '../utils/canvasRenderer';

interface RightInspectorProps {
  canvasSettings: CanvasSettings;
  items: CollageItem[];
  selectedIds: string[];
  assets: LoadedImageAsset[];
  assetMap: Map<string, LoadedImageAsset>;
  missingImages: ImageItem[];
  customFonts: CustomFontRecord[];
  detectedCk3Fonts: Array<{ family: string; label: string }>;
  croppingImageId: string | null;
  textInputRef: React.RefObject<HTMLTextAreaElement>;
  onUpdateCanvas: (patch: Partial<CanvasSettings>) => void;
  onSelectIds: (ids: string[]) => void;
  onUpdateSelectedImages: (updater: (item: ImageItem) => ImageItem, commit?: boolean) => void;
  onUpdateSelectedTexts: (updater: (item: TextItem) => TextItem, commit?: boolean) => void;
  onDeleteIds: (ids: string[]) => void;
  onMoveZOrder: (ids: string[], mode: 'front' | 'back' | 'forward' | 'backward') => void;
  onToggleCropMode: (imageId: string) => void;
  onReplaceImageSource: (imageId: string, newRelativePath: string) => void;
  onAutoRelinkMissing: () => void;
  onAddAttachedText: (parentImageId: string) => void;
  onImportFontFile: (file: File) => void;
}

export const RightInspector: React.FC<RightInspectorProps> = ({
  canvasSettings,
  items,
  selectedIds,
  assets,
  assetMap,
  missingImages,
  customFonts,
  detectedCk3Fonts,
  croppingImageId,
  textInputRef,
  onUpdateCanvas,
  onSelectIds,
  onUpdateSelectedImages,
  onUpdateSelectedTexts,
  onDeleteIds,
  onMoveZOrder,
  onToggleCropMode,
  onReplaceImageSource,
  onAutoRelinkMissing,
  onAddAttachedText,
  onImportFontFile,
}) => {
  const fontInputRef = useRef<HTMLInputElement | null>(null);

  const selectedItems = useMemo(() => {
    const set = new Set(selectedIds);
    return items.filter((it) => set.has(it.id));
  }, [items, selectedIds]);

  const selectedImages = useMemo(
    () => selectedItems.filter((it): it is ImageItem => it.type === 'image'),
    [selectedItems]
  );

  const selectedTexts = useMemo(
    () => selectedItems.filter((it): it is TextItem => it.type === 'text'),
    [selectedItems]
  );

  const singleImage = selectedImages.length === 1 && selectedTexts.length === 0 ? selectedImages[0] : null;
  const singleText = selectedTexts.length === 1 && selectedImages.length === 0 ? selectedTexts[0] : null;

  const attachedTextsForSingleImage = useMemo(() => {
    if (!singleImage) return [];
    return items.filter(
      (it): it is TextItem => it.type === 'text' && it.parentImageId === singleImage.id
    );
  }, [items, singleImage]);

  const sortedLayersDesc = useMemo(
    () =>
      items
        .filter((it) => it.type === 'image' || it.parentImageId === null)
        .sort((a, b) => b.zIndex - a.zIndex),
    [items]
  );

  const hasIndependentLayerSelection = useMemo(
    () => selectedItems.some((it) => it.type === 'image' || it.parentImageId === null),
    [selectedItems]
  );

  const imageNameMap = useMemo(() => {
    const m = new Map<string, ImageItem>();
    for (const it of items) {
      if (it.type === 'image') m.set(it.id, it);
    }
    return m;
  }, [items]);

  const exportBounds = useMemo(
    () =>
      computeExportBounds({
        version: '1.0',
        workspaceRootName: '',
        canvas: canvasSettings,
        items,
      }),
    [canvasSettings, items]
  );

  const updateBorder = (patch: Partial<BorderStyle>) => {
    onUpdateSelectedImages((img) => ({
      ...img,
      border: { ...img.border, ...patch },
    }));
  };

  return (
    <aside className="right-pane">
      {/* Missing resources warning */}
      {missingImages.length > 0 && (
        <div className="missing-warning-card">
          <div className="missing-warning-header">
            <AlertTriangle size={16} />
            <span>
              {missingImages.length} Missing Image Resource{missingImages.length > 1 ? 's' : ''}
            </span>
          </div>
          <p className="missing-warning-desc">
            Some images in this project were moved, renamed, or deleted from the workspace folder.
          </p>
          {assets.length > 0 && (
            <button
              type="button"
              className="btn btn-sm btn-primary w-full"
              onClick={onAutoRelinkMissing}
            >
              <RefreshCw size={13} />
              Auto-Relink Moved Files by Name
            </button>
          )}
          <div className="missing-list">
            {missingImages.map((img) => (
              <div key={img.id} className="missing-row">
                <span className="missing-path" title={img.sourcePath}>
                  {img.fileName}
                </span>
                {assets.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) onReplaceImageSource(img.id, e.target.value);
                    }}
                    title="Select replacement image from workspace"
                  >
                    <option value="">Relink to...</option>
                    {assets.map((a) => (
                      <option key={a.file.relativePath} value={a.file.relativePath}>
                        {a.file.relativePath}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="inspector-scroll">
        {/* Selection Inspector */}
        {selectedItems.length > 0 && (
          <section className="inspector-section">
            <div className="section-header">
              <span>
                {singleImage
                  ? 'Image Properties'
                  : singleText
                  ? 'Text Properties'
                  : `Selection (${selectedItems.length} items)`}
              </span>
              <button
                type="button"
                className="btn btn-icon-danger"
                title="Delete selected item(s) (Delete)"
                onClick={() => onDeleteIds(selectedIds)}
              >
                <Trash2 size={14} />
              </button>
            </div>

            {singleImage && (
              <div className="source-path-pill" title={singleImage.sourcePath}>
                <ImageIcon size={12} />
                <span>{singleImage.sourcePath}</span>
              </div>
            )}

            {/* Z-Order Row */}
            {hasIndependentLayerSelection && (
              <div className="control-row">
                <span className="control-label">Layer Order</span>
                <div className="btn-row">
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => onMoveZOrder(selectedIds, 'front')}
                    title="Bring to Front"
                  >
                    <ArrowUpToLine size={13} /> Front
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => onMoveZOrder(selectedIds, 'forward')}
                    title="Move Forward"
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => onMoveZOrder(selectedIds, 'backward')}
                    title="Move Backward"
                  >
                    <ArrowDown size={13} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => onMoveZOrder(selectedIds, 'back')}
                    title="Send to Back"
                  >
                    <ArrowDownToLine size={13} /> Back
                  </button>
                </div>
              </div>
            )}

            {/* Single Image Geometry, Crop & Attached Text */}
            {singleImage && (
              <>
                <div className="sub-section-title">Position</div>
                <div className="grid-2">
                  <label className="field">
                    <span>X (px)</span>
                    <input
                      type="number"
                      value={Math.round(singleImage.x - exportBounds.x)}
                      onChange={(e) => {
                        const relX = Number(e.target.value) || 0;
                        onUpdateSelectedImages((img) => ({
                          ...img,
                          x: relX + exportBounds.x,
                        }));
                      }}
                    />
                  </label>
                  <label className="field">
                    <span>Y (px)</span>
                    <input
                      type="number"
                      value={Math.round(singleImage.y - exportBounds.y)}
                      onChange={(e) => {
                        const relY = Number(e.target.value) || 0;
                        onUpdateSelectedImages((img) => ({
                          ...img,
                          y: relY + exportBounds.y,
                        }));
                      }}
                    />
                  </label>
                </div>

                <div className="dimensions-row">
                  <label className="field">
                    <span>Width</span>
                    <input
                      type="number"
                      min={10}
                      value={Math.round(singleImage.width)}
                      onChange={(e) => {
                        const nextW = Math.max(10, Number(e.target.value) || 10);
                        onUpdateSelectedImages((img) => {
                          if (img.aspectLocked) {
                            const ratio = img.height / Math.max(1, img.width);
                            return { ...img, width: nextW, height: Math.max(10, Math.round(nextW * ratio)) };
                          }
                          return { ...img, width: nextW };
                        });
                      }}
                    />
                  </label>
                  <label className="field">
                    <span>Height</span>
                    <input
                      type="number"
                      min={10}
                      value={Math.round(singleImage.height)}
                      onChange={(e) => {
                        const nextH = Math.max(10, Number(e.target.value) || 10);
                        onUpdateSelectedImages((img) => {
                          if (img.aspectLocked) {
                            const ratio = img.width / Math.max(1, img.height);
                            return { ...img, height: nextH, width: Math.max(10, Math.round(nextH * ratio)) };
                          }
                          return { ...img, height: nextH };
                        });
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className={`btn btn-dim-icon ${singleImage.aspectLocked ? 'active' : ''}`}
                    onClick={() =>
                      onUpdateSelectedImages((img) => ({
                        ...img,
                        aspectLocked: !img.aspectLocked,
                      }))
                    }
                    title={
                      singleImage.aspectLocked
                        ? 'Aspect ratio locked (Width & Height scale together) — click to unlock'
                        : 'Aspect ratio unlocked — click to lock Width & Height proportions'
                    }
                  >
                    {singleImage.aspectLocked ? <Lock size={13} /> : <Unlock size={13} />}
                  </button>
                  <button
                    type="button"
                    className="btn btn-dim-icon"
                    onClick={() =>
                      onUpdateSelectedImages((img) => ({
                        ...img,
                        width: img.crop ? img.crop.width : img.naturalWidth,
                        height: img.crop ? img.crop.height : img.naturalHeight,
                      }))
                    }
                    title={`Reset image to native resolution (${
                      singleImage.crop ? singleImage.crop.width : singleImage.naturalWidth
                    }×${
                      singleImage.crop ? singleImage.crop.height : singleImage.naturalHeight
                    } px)`}
                  >
                    <RotateCcw size={13} />
                  </button>
                </div>

                <div className="btn-row mt-1">
                  <button
                    type="button"
                    className={`btn btn-sm flex-1 ${
                      croppingImageId === singleImage.id ? 'btn-primary' : ''
                    }`}
                    onClick={() => onToggleCropMode(singleImage.id)}
                  >
                    <Crop size={13} />
                    {croppingImageId === singleImage.id ? 'Finish Crop' : 'Crop Image'}
                  </button>
                  {singleImage.crop && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() =>
                        onUpdateSelectedImages((img) => ({
                          ...img,
                          crop: null,
                          width: img.naturalWidth,
                          height: img.naturalHeight,
                        }))
                      }
                      title="Clear crop and restore full portrait"
                    >
                      <RotateCcw size={13} /> Reset Crop
                    </button>
                  )}
                </div>
              </>
            )}

            {/* Image Border (works on 1 or N selected images) */}
            {selectedImages.length > 0 && (
              <>
                <div className="sub-section-title">Border</div>
                {(() => {
                  const refBorder = selectedImages[0].border;
                  return (
                    <>
                      <div className="control-row-inline">
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={refBorder.enabled}
                            onChange={(e) => updateBorder({ enabled: e.target.checked })}
                          />
                          <span>Enable Border</span>
                        </label>
                        <div className="segmented">
                          <button
                            type="button"
                            className={refBorder.placement === 'inside' ? 'active' : ''}
                            onClick={() => updateBorder({ placement: 'inside' })}
                            title="Inset inside image bounds (preserves exact dimensions)"
                          >
                            Inside
                          </button>
                          <button
                            type="button"
                            className={refBorder.placement === 'outside' ? 'active' : ''}
                            onClick={() => updateBorder({ placement: 'outside' })}
                            title="Expand outward around image"
                          >
                            Outside
                          </button>
                        </div>
                      </div>

                      {refBorder.enabled && (
                        <>
                          <div className="grid-2">
                            <label className="field">
                              <span>Width (px)</span>
                              <input
                                type="number"
                                min={0}
                                max={60}
                                value={refBorder.width}
                                onChange={(e) =>
                                  updateBorder({ width: Math.max(0, Number(e.target.value) || 0) })
                                }
                              />
                            </label>
                            <label className="field">
                              <span>Border Color</span>
                              <div className="color-input-wrap">
                                <input
                                  type="color"
                                  value={refBorder.color}
                                  onChange={(e) => updateBorder({ color: e.target.value })}
                                />
                                <input
                                  type="text"
                                  value={refBorder.color}
                                  onChange={(e) => updateBorder({ color: e.target.value })}
                                />
                              </div>
                            </label>
                          </div>

                          <div className="swatch-row">
                            {CK3_BORDER_SWATCHES.map((sw) => (
                              <button
                                key={sw.hex}
                                type="button"
                                className={`swatch-btn ${
                                  refBorder.color.toLowerCase() === sw.hex.toLowerCase()
                                    ? 'active'
                                    : ''
                                }`}
                                style={{ backgroundColor: sw.hex }}
                                title={`${sw.name} (${sw.hex})`}
                                onClick={() => updateBorder({ color: sw.hex })}
                              />
                            ))}
                          </div>

                          <div className="grid-2 mt-1">
                            <label className="field">
                              <span>Keyline (px)</span>
                              <input
                                type="number"
                                min={0}
                                max={20}
                                value={refBorder.outerKeylineWidth}
                                onChange={(e) =>
                                  updateBorder({
                                    outerKeylineWidth: Math.max(0, Number(e.target.value) || 0),
                                  })
                                }
                              />
                            </label>
                            <label className="field">
                              <span>Keyline Color</span>
                              <div className="color-input-wrap">
                                <input
                                  type="color"
                                  value={refBorder.outerKeylineColor}
                                  onChange={(e) =>
                                    updateBorder({ outerKeylineColor: e.target.value })
                                  }
                                />
                                <input
                                  type="text"
                                  value={refBorder.outerKeylineColor}
                                  onChange={(e) =>
                                    updateBorder({ outerKeylineColor: e.target.value })
                                  }
                                />
                              </div>
                            </label>
                          </div>
                        </>
                      )}
                    </>
                  );
                })()}
              </>
            )}

            {/* Attached Text Controls on Single Image */}
            {singleImage && (
              <>
                <div className="sub-section-title">Attached Text</div>
                <button
                  type="button"
                  className="btn btn-sm w-full"
                  onClick={() => onAddAttachedText(singleImage.id)}
                  title="Attach a text box to this image (auto-fills character name if detected)"
                >
                  <Plus size={13} />
                  <span>Add Text</span>
                </button>

                {attachedTextsForSingleImage.length > 0 && (
                  <div className="attached-text-list">
                    {attachedTextsForSingleImage.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className="attached-text-chip"
                        onClick={() => onSelectIds([t.id])}
                      >
                        <Type size={12} />
                        <span>{t.text || '(empty)'}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Text Properties (1 or N selected TextItems) */}
            {selectedTexts.length > 0 && (() => {
              const refText = selectedTexts[0];
              const parentImg = refText.parentImageId
                ? imageNameMap.get(refText.parentImageId)
                : null;
              return (
                <>
                  {selectedTexts.length === 1 && (
                    <div className="attachment-badge-row">
                      {parentImg ? (
                        <>
                          <span className="attachment-pill">
                            Attached to: <strong>{parentImg.fileName}</strong>
                          </span>
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() => onSelectIds([parentImg.id])}
                          >
                            Select Image
                          </button>
                        </>
                      ) : (
                        <span className="attachment-pill">Collage-Global Text</span>
                      )}
                    </div>
                  )}

                  <label className="field mt-1">
                    <span>Text Content</span>
                    <textarea
                      ref={textInputRef}
                      rows={2}
                      value={refText.text}
                      onChange={(e) =>
                        onUpdateSelectedTexts((t) => ({ ...t, text: e.target.value }))
                      }
                    />
                  </label>

                  <div className="control-row">
                    <div className="section-mini-header">
                      <span>Font Family</span>
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => fontInputRef.current?.click()}
                        title="Import a local .ttf or .otf font (such as CK3 GitanLatin or Paradox_King_Script)"
                      >
                        <Upload size={11} /> Import .ttf/.otf
                      </button>
                      <input
                        ref={fontInputRef}
                        type="file"
                        accept=".ttf,.otf,.woff,.woff2"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) onImportFontFile(f);
                          e.target.value = '';
                        }}
                      />
                    </div>
                    <select
                      value={refText.fontFamily}
                      onChange={(e) =>
                        onUpdateSelectedTexts((t) => ({ ...t, fontFamily: e.target.value }))
                      }
                    >
                      {detectedCk3Fonts.length > 0 && (
                        <optgroup label="Auto-Detected Local CK3 Fonts">
                          {detectedCk3Fonts.map((df) => (
                            <option key={df.family} value={df.family}>
                              {df.label}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {customFonts.length > 0 && (
                        <optgroup label="Imported Custom Fonts">
                          {customFonts.map((cf) => (
                            <option key={cf.id} value={cf.familyName}>
                              {cf.familyName} (Imported)
                            </option>
                          ))}
                        </optgroup>
                      )}
                      <optgroup label="CK3 & Built-In Fonts">
                        {BUILTIN_FONTS.map((f) => (
                          <option key={f.family} value={f.family}>
                            {f.label}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  </div>

                  <div className="grid-2 mt-1">
                    <label className="field">
                      <span>Size (px)</span>
                      <input
                        type="number"
                        min={6}
                        max={300}
                        value={refText.fontSize}
                        onChange={(e) =>
                          onUpdateSelectedTexts((t) => ({
                            ...t,
                            fontSize: Math.max(6, Number(e.target.value) || 12),
                          }))
                        }
                      />
                    </label>
                    <div className="field">
                      <span>Style & Align</span>
                      <div className="btn-row">
                        <button
                          type="button"
                          className={`btn btn-sm ${refText.fontWeight === 'bold' ? 'active' : ''}`}
                          onClick={() =>
                            onUpdateSelectedTexts((t) => ({
                              ...t,
                              fontWeight: t.fontWeight === 'bold' ? 'normal' : 'bold',
                            }))
                          }
                        >
                          <strong>B</strong>
                        </button>
                        <button
                          type="button"
                          className={`btn btn-sm ${refText.fontStyle === 'italic' ? 'active' : ''}`}
                          onClick={() =>
                            onUpdateSelectedTexts((t) => ({
                              ...t,
                              fontStyle: t.fontStyle === 'italic' ? 'normal' : 'italic',
                            }))
                          }
                        >
                          <em>I</em>
                        </button>
                        {(['left', 'center', 'right'] as const).map((al) => (
                          <button
                            key={al}
                            type="button"
                            className={`btn btn-sm ${refText.textAlign === al ? 'active' : ''}`}
                            onClick={() =>
                              onUpdateSelectedTexts((t) => ({ ...t, textAlign: al }))
                            }
                          >
                            {al[0].toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="grid-2 mt-1">
                    <label className="field">
                      <span>Fill Color</span>
                      <div className="color-input-wrap">
                        <input
                          type="color"
                          value={refText.fillColor}
                          onChange={(e) =>
                            onUpdateSelectedTexts((t) => ({ ...t, fillColor: e.target.value }))
                          }
                        />
                        <input
                          type="text"
                          value={refText.fillColor}
                          onChange={(e) =>
                            onUpdateSelectedTexts((t) => ({ ...t, fillColor: e.target.value }))
                          }
                        />
                      </div>
                    </label>
                    <label className="field">
                      <span>Outline (px)</span>
                      <input
                        type="number"
                        min={0}
                        max={30}
                        value={refText.strokeWidth}
                        onChange={(e) =>
                          onUpdateSelectedTexts((t) => ({
                            ...t,
                            strokeWidth: Math.max(0, Number(e.target.value) || 0),
                          }))
                        }
                      />
                    </label>
                  </div>

                  <div className="grid-2 mt-1">
                    <label className="field">
                      <span>Outline Color</span>
                      <div className="color-input-wrap">
                        <input
                          type="color"
                          value={refText.strokeColor}
                          onChange={(e) =>
                            onUpdateSelectedTexts((t) => ({ ...t, strokeColor: e.target.value }))
                          }
                        />
                        <input
                          type="text"
                          value={refText.strokeColor}
                          onChange={(e) =>
                            onUpdateSelectedTexts((t) => ({ ...t, strokeColor: e.target.value }))
                          }
                        />
                      </div>
                    </label>
                    <label className="field">
                      <span>Wrap Width (px)</span>
                      <input
                        type="number"
                        min={0}
                        placeholder="No wrap"
                        value={refText.maxWidth ?? ''}
                        onChange={(e) => {
                          const raw = e.target.value;
                          onUpdateSelectedTexts((t) => ({
                            ...t,
                            maxWidth: raw === '' ? null : Math.max(20, Number(raw) || 200),
                          }));
                        }}
                      />
                    </label>
                  </div>

                  {parentImg && selectedTexts.length === 1 && (
                    <>
                      <div className="sub-section-title">Quick Position Relative to Image</div>
                      <div className="presets-grid">
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() =>
                            onUpdateSelectedTexts((t) => ({
                              ...t,
                              offsetX: Math.round(parentImg.width / 2),
                              offsetY: Math.round(parentImg.height - 13),
                              textAlign: 'center',
                              anchor: 'bottom-center',
                            }))
                          }
                        >
                          Bottom Inside
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() =>
                            onUpdateSelectedTexts((t) => ({
                              ...t,
                              offsetX: Math.round(parentImg.width / 2),
                              offsetY: Math.round(parentImg.height + 10),
                              textAlign: 'center',
                              anchor: 'top-center',
                            }))
                          }
                        >
                          Below Image
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() =>
                            onUpdateSelectedTexts((t) => ({
                              ...t,
                              offsetX: Math.round(parentImg.width / 2),
                              offsetY: 12,
                              textAlign: 'center',
                              anchor: 'top-center',
                            }))
                          }
                        >
                          Top Inside
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() =>
                            onUpdateSelectedTexts((t) => ({
                              ...t,
                              offsetX: Math.round(parentImg.width / 2),
                              offsetY: -10,
                              textAlign: 'center',
                              anchor: 'bottom-center',
                            }))
                          }
                        >
                          Above Image
                        </button>
                      </div>
                    </>
                  )}

                  {selectedTexts.length === 1 && (
                    <div className="grid-2 mt-1">
                      <label className="field">
                        <span>{parentImg ? 'Offset X' : 'X (px)'}</span>
                        <input
                          type="number"
                          value={Math.round(
                            parentImg ? refText.offsetX : refText.offsetX - exportBounds.x
                          )}
                          onChange={(e) => {
                            const val = Number(e.target.value) || 0;
                            onUpdateSelectedTexts((t) => ({
                              ...t,
                              offsetX: parentImg ? val : val + exportBounds.x,
                            }));
                          }}
                        />
                      </label>
                      <label className="field">
                        <span>{parentImg ? 'Offset Y' : 'Y (px)'}</span>
                        <input
                          type="number"
                          value={Math.round(
                            parentImg ? refText.offsetY : refText.offsetY - exportBounds.y
                          )}
                          onChange={(e) => {
                            const val = Number(e.target.value) || 0;
                            onUpdateSelectedTexts((t) => ({
                              ...t,
                              offsetY: parentImg ? val : val + exportBounds.y,
                            }));
                          }}
                        />
                      </label>
                    </div>
                  )}
                </>
              );
            })()}
          </section>
        )}

        {/* Canvas Settings Section (only when background is selected / nothing selected) */}
        {selectedItems.length === 0 && (
          <section className="inspector-section">
            <div className="section-header">
              <span>Canvas & Export Bounds</span>
            </div>

            <div className="control-row-inline">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={canvasSettings.transparentBackground}
                  onChange={(e) =>
                    onUpdateCanvas({ transparentBackground: e.target.checked })
                  }
                />
                <span>Transparent Background</span>
              </label>
            </div>

            {!canvasSettings.transparentBackground && (
              <>
                <label className="field">
                  <span>Background Color</span>
                  <div className="color-input-wrap">
                    <input
                      type="color"
                      value={canvasSettings.backgroundColor}
                      onChange={(e) => onUpdateCanvas({ backgroundColor: e.target.value })}
                    />
                    <input
                      type="text"
                      value={canvasSettings.backgroundColor}
                      onChange={(e) => onUpdateCanvas({ backgroundColor: e.target.value })}
                    />
                  </div>
                </label>

                <div className="swatch-row">
                  {CK3_BACKGROUND_SWATCHES.map((sw) => (
                    <button
                      key={sw.hex}
                      type="button"
                      className={`swatch-btn ${
                        canvasSettings.backgroundColor.toLowerCase() === sw.hex.toLowerCase()
                          ? 'active'
                          : ''
                      }`}
                      style={{ backgroundColor: sw.hex }}
                      title={`${sw.name} (${sw.hex})`}
                      onClick={() => onUpdateCanvas({ backgroundColor: sw.hex })}
                    />
                  ))}
                </div>
              </>
            )}

            <div className="control-row mt-1">
              <span className="control-label">Bounds Mode</span>
              <div className="segmented w-full">
                <button
                  type="button"
                  className={canvasSettings.boundsMode === 'auto' ? 'active' : ''}
                  onClick={() => onUpdateCanvas({ boundsMode: 'auto' })}
                >
                  Auto-Fit Content
                </button>
                <button
                  type="button"
                  className={canvasSettings.boundsMode === 'fixed' ? 'active' : ''}
                  onClick={() => onUpdateCanvas({ boundsMode: 'fixed' })}
                >
                  Fixed Size
                </button>
              </div>
            </div>

            {canvasSettings.boundsMode === 'auto' ? (
              <label className="field mt-1">
                <span>Outer Margin Padding (px)</span>
                <input
                  type="number"
                  min={0}
                  max={400}
                  value={canvasSettings.outerMargin}
                  onChange={(e) =>
                    onUpdateCanvas({ outerMargin: Math.max(0, Number(e.target.value) || 0) })
                  }
                />
              </label>
            ) : (
              <div className="grid-2 mt-1">
                <label className="field">
                  <span>Canvas Width (px)</span>
                  <input
                    type="number"
                    min={64}
                    max={16384}
                    value={canvasSettings.width}
                    onChange={(e) =>
                      onUpdateCanvas({ width: Math.max(64, Number(e.target.value) || 1080) })
                    }
                  />
                </label>
                <label className="field">
                  <span>Canvas Height (px)</span>
                  <input
                    type="number"
                    min={64}
                    max={16384}
                    value={canvasSettings.height}
                    onChange={(e) =>
                      onUpdateCanvas({ height: Math.max(64, Number(e.target.value) || 1080) })
                    }
                  />
                </label>
              </div>
            )}
          </section>
        )}

        {/* Layer Stack Inspector */}
        <section className="inspector-section">
          <div className="section-header">
            <span>
              <Layers size={13} style={{ display: 'inline', marginRight: 5 }} />
              Layers ({sortedLayersDesc.length})
            </span>
          </div>

          {sortedLayersDesc.length === 0 ? (
            <p className="muted-hint">No items on canvas yet.</p>
          ) : (
            <div className="layer-list">
              {sortedLayersDesc.map((item) => {
                const isSelected = selectedIds.includes(item.id);
                const isMissing = item.type === 'image' && !assetMap.has(item.sourcePath);
                const label =
                  item.type === 'image'
                    ? item.fileName
                    : item.text.split('\n')[0] || '(Text)';
                const sub =
                  item.type === 'image'
                    ? `${Math.round(item.width)}×${Math.round(item.height)}`
                    : item.parentImageId
                    ? 'Attached Text'
                    : 'Global Text';
                return (
                  <div
                    key={item.id}
                    className={`layer-row ${isSelected ? 'selected' : ''} ${
                      isMissing ? 'is-missing' : ''
                    }`}
                    onClick={(e) => {
                      if (e.shiftKey) {
                        onSelectIds(
                          isSelected
                            ? selectedIds.filter((id) => id !== item.id)
                            : [...selectedIds, item.id]
                        );
                      } else {
                        onSelectIds([item.id]);
                      }
                    }}
                  >
                    <span className="layer-icon">
                      {item.type === 'image' ? (
                        isMissing ? (
                          <AlertTriangle size={13} color="#F87171" />
                        ) : (
                          <ImageIcon size={13} />
                        )
                      ) : (
                        <Type size={13} />
                      )}
                    </span>
                    <div className="layer-meta">
                      <div className="layer-name" title={label}>
                        {label}
                      </div>
                      <div className="layer-sub">{sub}</div>
                    </div>
                    <div className="layer-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="layer-mini-btn"
                        title="Move Forward"
                        onClick={() => onMoveZOrder([item.id], 'forward')}
                      >
                        <ArrowUp size={12} />
                      </button>
                      <button
                        type="button"
                        className="layer-mini-btn"
                        title="Move Backward"
                        onClick={() => onMoveZOrder([item.id], 'backward')}
                      >
                        <ArrowDown size={12} />
                      </button>
                      <button
                        type="button"
                        className="layer-mini-btn danger"
                        title="Delete layer"
                        onClick={() => onDeleteIds([item.id])}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
};
