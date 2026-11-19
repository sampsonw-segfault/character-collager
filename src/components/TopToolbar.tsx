import React, { useRef } from 'react';
import {
  Camera,
  Download,
  FolderUp,
  ImagePlus,
  Magnet,
  Maximize2,
  Redo2,
  Save,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { SnapshotterConnectionState } from '../services/snapshotterBridge';
import { SnapSettings } from '../types/collage';

interface TopToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  snap: SnapSettings;
  zoom: number;
  isExporting: boolean;
  snapshotterState: SnapshotterConnectionState;
  snapshotterOverlayActive: boolean;
  snapshotterPopoverOpen: boolean;
  snapshotterButtonRef: React.RefObject<HTMLButtonElement>;
  onToggleSnapshotterPopover: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onUpdateSnap: (patch: Partial<SnapSettings>) => void;
  onAddGlobalText: () => void;
  onAddExternalImages: (files: FileList) => void;
  onZoomStep: (deltaFactor: number) => void;
  onZoomReset: () => void;
  onZoomFit: () => void;
  onSaveProject: () => void;
  onLoadProjectFile: (file: File) => void;
  onExportPng: () => void;
}

export const TopToolbar: React.FC<TopToolbarProps> = ({
  canUndo,
  canRedo,
  snap,
  zoom,
  isExporting,
  snapshotterState,
  snapshotterOverlayActive,
  snapshotterPopoverOpen,
  snapshotterButtonRef,
  onToggleSnapshotterPopover,
  onUndo,
  onRedo,
  onUpdateSnap,
  onAddGlobalText,
  onAddExternalImages,
  onZoomStep,
  onZoomReset,
  onZoomFit,
  onSaveProject,
  onLoadProjectFile,
  onExportPng,
}) => {
  const projectInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <header className="top-toolbar">
      <div className="toolbar-group brand-group">
        <span className="brand-dot" />
        <span className="brand-title">Character Collager</span>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <button
          type="button"
          className="btn btn-icon"
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
        >
          <Undo2 size={15} />
        </button>
        <button
          type="button"
          className="btn btn-icon"
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (Ctrl+Y / Ctrl+Shift+Z)"
        >
          <Redo2 size={15} />
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group snap-group">
        <button
          type="button"
          className={`btn btn-toggle ${snap.enabled ? 'active' : ''}`}
          onClick={() => onUpdateSnap({ enabled: !snap.enabled })}
          title="Toggle magnetic edge/corner snapping (hold Alt while dragging to bypass)"
        >
          <Magnet size={14} />
          <span>Snap</span>
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              onAddExternalImages(e.target.files);
            }
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="btn"
          onClick={() => imageInputRef.current?.click()}
          title="Insert image(s) from anywhere on your computer onto the canvas"
        >
          <ImagePlus size={14} />
          <span>+ Image</span>
        </button>

        <button
          type="button"
          className="btn"
          onClick={onAddGlobalText}
          title="Add a collage-global title or caption text box"
        >
          <Type size={14} />
          <span>+ Text</span>
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <button
          ref={snapshotterButtonRef}
          type="button"
          className={`btn snapshotter-pill-btn ${snapshotterPopoverOpen ? 'active' : ''}`}
          onClick={onToggleSnapshotterPopover}
          title={
            snapshotterState === 'connected'
              ? 'Character Snapshotter Connected (click for controls)'
              : 'Connect to Character Snapshotter desktop helper'
          }
        >
          <span
            className={`status-dot ${
              snapshotterState === 'connected'
                ? snapshotterOverlayActive
                  ? 'capturing'
                  : 'connected'
                : snapshotterState === 'connecting'
                  ? 'connecting'
                  : 'offline'
            }`}
          />
          <Camera size={14} />
          <span>Snapshotter</span>
        </button>
      </div>

      <div className="toolbar-spacer" />

      <div className="toolbar-group">
        <button
          type="button"
          className="btn btn-icon"
          onClick={() => onZoomStep(1 / 1.2)}
          title="Zoom out"
        >
          <ZoomOut size={14} />
        </button>
        <button
          type="button"
          className="btn zoom-readout"
          onClick={onZoomReset}
          title="Reset to 100% zoom"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          className="btn btn-icon"
          onClick={() => onZoomStep(1.2)}
          title="Zoom in"
        >
          <ZoomIn size={14} />
        </button>
        <button
          type="button"
          className="btn btn-icon"
          onClick={onZoomFit}
          title="Fit collage in viewport"
        >
          <Maximize2 size={14} />
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <input
          ref={projectInputRef}
          type="file"
          accept=".json,.collage.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onLoadProjectFile(file);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="btn"
          onClick={() => projectInputRef.current?.click()}
          title="Open saved .collage.json project"
        >
          <FolderUp size={14} />
          <span>Open</span>
        </button>
        <button
          type="button"
          className="btn"
          onClick={onSaveProject}
          title="Save editable .collage.json project"
        >
          <Save size={14} />
          <span>Save</span>
        </button>
        <button
          type="button"
          className="btn btn-gold"
          onClick={onExportPng}
          disabled={isExporting}
          title="Export full-resolution 1:1 PNG"
        >
          <Download size={14} />
          <span>{isExporting ? 'Exporting...' : 'Export PNG'}</span>
        </button>
      </div>
    </header>
  );
};
