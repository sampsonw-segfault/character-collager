import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  FolderOpen,
  Lock,
  RefreshCw,
  RotateCcw,
  Settings,
  Square,
} from 'lucide-react';
import {
  computeProportionalOutput,
  SnapshotterConfig,
  SnapshotterConnectionState,
  SnapshotterStatus,
} from '../services/snapshotterBridge';

interface SnapshotterPopoverProps {
  open: boolean;
  anchorRef: React.RefObject<HTMLButtonElement>;
  connectionState: SnapshotterConnectionState;
  status: SnapshotterStatus | null;
  autoImport: boolean;
  autoPlace: boolean;
  onClose: () => void;
  onConnect: () => void;
  onPatchConfig: (patch: Partial<SnapshotterConfig>) => Promise<string | null>;
  onTrigger: (action: 'toggle' | 'show' | 'capture' | 'cancel' | 'reset_size') => Promise<string | null>;
  onBrowseFolder: () => Promise<void>;
  onOpenFolder: () => Promise<void>;
  onOpenSettings: () => Promise<void>;
  onChangeAutoImport: (next: boolean) => void;
  onChangeAutoPlace: (next: boolean) => void;
}

function clampDim(val: number, fallback: number): number {
  if (!Number.isFinite(val)) return fallback;
  return Math.max(16, Math.min(9999, Math.round(val)));
}

export const SnapshotterPopover: React.FC<SnapshotterPopoverProps> = ({
  open,
  anchorRef,
  connectionState,
  status,
  autoImport,
  autoPlace,
  onClose,
  onConnect,
  onPatchConfig,
  onTrigger,
  onBrowseFolder,
  onOpenFolder,
  onOpenSettings,
  onChangeAutoImport,
  onChangeAutoPlace,
}) => {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [anchorPos, setAnchorPos] = useState<{ top: number; left: number }>({ top: 54, left: 340 });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [capWInput, setCapWInput] = useState('500');
  const [capHInput, setCapHInput] = useState('500');
  const [outWInput, setOutWInput] = useState('500');
  const [outHInput, setOutHInput] = useState('500');

  const cfg = status?.config ?? null;

  useEffect(() => {
    if (!cfg) return;
    setCapWInput(String(cfg.box_width));
    setCapHInput(String(cfg.box_height));
    const out = computeProportionalOutput(
      cfg.box_width,
      cfg.box_height,
      cfg.scale_enabled,
      cfg.scale_anchor_axis,
      cfg.scale_target_px
    );
    setOutWInput(String(out.width));
    setOutHInput(String(out.height));
  }, [
    cfg?.box_width,
    cfg?.box_height,
    cfg?.scale_enabled,
    cfg?.scale_anchor_axis,
    cfg?.scale_target_px,
  ]);

  useEffect(() => {
    if (!open) return;
    const updateAnchor = () => {
      const btn = anchorRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const left = Math.max(12, Math.min(Math.round(r.left), window.innerWidth - 358));
      const top = Math.round(r.bottom + 6);
      setAnchorPos({ top, left });
    };
    updateAnchor();
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('resize', updateAnchor);
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('resize', updateAnchor);
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, anchorRef, onClose]);

  if (!open) return null;

  const handlePatch = async (patch: Partial<SnapshotterConfig>) => {
    setErrorMsg(null);
    const err = await onPatchConfig(patch);
    if (err) setErrorMsg(err);
  };

  const handleTrigger = async (
    action: 'toggle' | 'show' | 'capture' | 'cancel' | 'reset_size'
  ) => {
    setErrorMsg(null);
    const err = await onTrigger(action);
    if (err) setErrorMsg(err);
  };

  const commitCaptureWidth = () => {
    if (!cfg) return;
    const w = clampDim(Number(capWInput), cfg.box_width);
    setCapWInput(String(w));
    if (cfg.square_lock) {
      setCapHInput(String(w));
      void handlePatch({ box_width: w, box_height: w });
    } else {
      void handlePatch({ box_width: w });
    }
  };

  const commitCaptureHeight = () => {
    if (!cfg) return;
    const h = clampDim(Number(capHInput), cfg.box_height);
    setCapHInput(String(h));
    if (cfg.square_lock) {
      setCapWInput(String(h));
      void handlePatch({ box_width: h, box_height: h });
    } else {
      void handlePatch({ box_height: h });
    }
  };

  const commitOutputWidth = () => {
    if (!cfg) return;
    const w = clampDim(Number(outWInput), cfg.scale_target_px);
    const out = computeProportionalOutput(cfg.box_width, cfg.box_height, true, 'width', w);
    setOutWInput(String(out.width));
    setOutHInput(String(out.height));
    void handlePatch({ scale_anchor_axis: 'width', scale_target_px: w });
  };

  const commitOutputHeight = () => {
    if (!cfg) return;
    const h = clampDim(Number(outHInput), cfg.scale_target_px);
    const out = computeProportionalOutput(cfg.box_width, cfg.box_height, true, 'height', h);
    setOutWInput(String(out.width));
    setOutHInput(String(out.height));
    void handlePatch({ scale_anchor_axis: 'height', scale_target_px: h });
  };

  return (
    <div
      ref={popoverRef}
      className="snapshotter-popover"
      style={{ top: anchorPos.top, left: anchorPos.left }}
      role="dialog"
      aria-label="Character Snapshotter Bridge"
    >
      {connectionState !== 'connected' || !status || !cfg ? (
        <div className="snapshotter-offline-body">
          <div className="snapshotter-header-row">
            <div className="snapshotter-status-label">
              <span className={`status-dot ${connectionState === 'connecting' ? 'connecting' : 'offline'}`} />
              <span>
                {connectionState === 'connecting'
                  ? 'Connecting to Helper…'
                  : 'Helper Offline (127.0.0.1:47821)'}
              </span>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => {
                setErrorMsg(null);
                onConnect();
              }}
              disabled={connectionState === 'connecting'}
            >
              <RefreshCw size={12} className={connectionState === 'connecting' ? 'spin' : ''} />
              <span>{connectionState === 'connecting' ? 'Connecting' : 'Connect'}</span>
            </button>
          </div>

          <p className="snapshotter-help-text">
            Launch <code>start_snapshotter.bat</code> from{' '}
            <a
              href="https://github.com/sampsonw-segfault/character-snapshotter"
              target="_blank"
              rel="noreferrer"
            >
              character-snapshotter
            </a>{' '}
            to control framing here and stream new snapshots straight into the Portrait Browser.
          </p>
          <p className="snapshotter-muted-note">
            Chrome/Edge may ask once to allow local network access from GitHub Pages.
          </p>
        </div>
      ) : (
        <div className="snapshotter-connected-body">
          <div className="snapshotter-header-row">
            <div className="snapshotter-status-label">
              <span className={`status-dot ${status.overlay_active ? 'capturing' : 'connected'}`} />
              <span>{status.overlay_active ? 'Overlay Active' : 'Connected'}</span>
              <span className="snapshotter-hotkey-badge" title="Configured global hotkey">
                {cfg.hotkey}
              </span>
            </div>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void onOpenSettings()}
              title="Open native Character Snapshotter settings dialog (hotkey, opacity, chime)"
            >
              <Settings size={12} />
              <span>Tray Settings…</span>
            </button>
          </div>

          <div className="snapshotter-action-row">
            <button
              type="button"
              className={`btn flex-1 ${status.overlay_active ? 'btn-gold' : 'btn-primary'}`}
              onClick={() => void handleTrigger(status.overlay_active ? 'capture' : 'show')}
            >
              <Camera size={14} />
              <span>{status.overlay_active ? 'Capture Now' : 'Trigger Overlay'}</span>
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void handleTrigger('reset_size')}
              title={`Reset capture frame to ${cfg.default_width}×${cfg.default_height}`}
            >
              <RotateCcw size={13} />
              <span>
                {cfg.default_width === cfg.default_height
                  ? `${cfg.default_width}`
                  : `${cfg.default_width}×${cfg.default_height}`}
              </span>
            </button>
          </div>

          <div className="snapshotter-section">
            <div className="snapshotter-label">Save Folder</div>
            <div className="snapshotter-folder-row">
              <div className="snapshotter-path-box" title={cfg.output_dir}>
                {cfg.output_dir}
              </div>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void onBrowseFolder()}
                title="Choose output folder on desktop"
              >
                Browse…
              </button>
              <button
                type="button"
                className="btn btn-sm btn-icon"
                onClick={() => void onOpenFolder()}
                title="Open output folder in Explorer"
              >
                <FolderOpen size={13} />
              </button>
            </div>
          </div>

          <div className="snapshotter-section">
            <div className="snapshotter-label">Capture Frame</div>
            <div className="snapshotter-inline-inputs">
              <input
                type="number"
                min={16}
                max={9999}
                value={capWInput}
                onChange={(e) => setCapWInput(e.target.value)}
                onBlur={commitCaptureWidth}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitCaptureWidth();
                }}
                aria-label="Capture width"
              />
              <span className="snapshotter-mul">×</span>
              <input
                type="number"
                min={16}
                max={9999}
                value={capHInput}
                onChange={(e) => setCapHInput(e.target.value)}
                onBlur={commitCaptureHeight}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitCaptureHeight();
                }}
                aria-label="Capture height"
              />
              <button
                type="button"
                className={`btn btn-sm btn-toggle ${cfg.square_lock ? 'active' : ''}`}
                onClick={() => void handlePatch({ square_lock: !cfg.square_lock })}
                title="Toggle 1:1 square lock vs free rectangle"
              >
                {cfg.square_lock ? <Lock size={12} /> : <Square size={12} />}
                <span>{cfg.square_lock ? '1:1' : 'Rect'}</span>
              </button>
            </div>
          </div>

          <div className="snapshotter-section">
            <div className="snapshotter-label-row">
              <label className="snapshotter-checkbox">
                <input
                  type="checkbox"
                  checked={cfg.scale_enabled}
                  onChange={(e) => void handlePatch({ scale_enabled: e.target.checked })}
                />
                <span>Proportional Output Scale</span>
              </label>
              <span className="snapshotter-muted-tag">
                {cfg.scale_enabled ? 'Lanczos' : 'Native'}
              </span>
            </div>
            <div className="snapshotter-inline-inputs">
              <input
                type="number"
                min={16}
                max={9999}
                disabled={!cfg.scale_enabled}
                value={outWInput}
                onChange={(e) => setOutWInput(e.target.value)}
                onBlur={commitOutputWidth}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitOutputWidth();
                }}
                aria-label="Output width"
              />
              <span className="snapshotter-mul">×</span>
              <input
                type="number"
                min={16}
                max={9999}
                disabled={!cfg.scale_enabled}
                value={outHInput}
                onChange={(e) => setOutHInput(e.target.value)}
                onBlur={commitOutputHeight}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitOutputHeight();
                }}
                aria-label="Output height"
              />
              <span className="snapshotter-prop-badge" title="Output aspect ratio always matches capture frame">
                Proportional
              </span>
            </div>
          </div>

          <div className="snapshotter-section snapshotter-toggles">
            <label className="snapshotter-checkbox">
              <input
                type="checkbox"
                checked={autoImport}
                onChange={(e) => onChangeAutoImport(e.target.checked)}
              />
              <span>Auto-import captures into browser</span>
            </label>
            <label className="snapshotter-checkbox">
              <input
                type="checkbox"
                checked={autoPlace}
                disabled={!autoImport}
                onChange={(e) => onChangeAutoPlace(e.target.checked)}
              />
              <span>Also drop captures onto canvas</span>
            </label>
          </div>

          {errorMsg && <div className="snapshotter-error">{errorMsg}</div>}
        </div>
      )}
    </div>
  );
};
