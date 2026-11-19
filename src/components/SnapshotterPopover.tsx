import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  FolderOpen,
  RefreshCw,
  Settings,
} from 'lucide-react';
import {
  computeScaledOutput,
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

function clampScale(val: number, fallback: number): number {
  if (!Number.isFinite(val)) return fallback;
  const clamped = Math.max(0.05, Math.min(10.0, val));
  return Math.round(clamped * 10000) / 10000;
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
  const [scaleInput, setScaleInput] = useState('1');

  const cfg = status?.config ?? null;

  useEffect(() => {
    if (!cfg) return;
    setCapWInput(String(cfg.box_width));
    setCapHInput(String(cfg.box_height));
    setScaleInput(String(cfg.scale ?? 1));
  }, [cfg?.box_width, cfg?.box_height, cfg?.scale]);

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
    void handlePatch({ box_width: w });
  };

  const commitCaptureHeight = () => {
    if (!cfg) return;
    const h = clampDim(Number(capHInput), cfg.box_height);
    setCapHInput(String(h));
    void handlePatch({ box_height: h });
  };

  const commitScale = () => {
    if (!cfg) return;
    const nextScale = clampScale(Number(scaleInput), cfg.scale ?? 1);
    setScaleInput(String(nextScale));
    void handlePatch({ scale: nextScale });
  };

  const outputPreview = cfg
    ? computeScaledOutput(
        clampDim(Number(capWInput), cfg.box_width),
        clampDim(Number(capHInput), cfg.box_height),
        clampScale(Number(scaleInput), cfg.scale ?? 1)
      )
    : { width: 500, height: 500 };

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
            <div className="snapshotter-label">Capture Dimensions</div>
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
              <span className="snapshotter-prop-badge">px</span>
            </div>
          </div>

          <div className="snapshotter-section">
            <div className="snapshotter-label-row">
              <span className="snapshotter-label">Scale</span>
              <span className="snapshotter-muted-tag">Lanczos</span>
            </div>
            <div className="snapshotter-inline-inputs">
              <input
                type="number"
                min={0.05}
                max={10}
                step={0.1}
                value={scaleInput}
                onChange={(e) => setScaleInput(e.target.value)}
                onBlur={commitScale}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitScale();
                }}
                aria-label="Output scale multiplier"
              />
              <span className="snapshotter-mul">×</span>
              <span
                className="snapshotter-prop-badge"
                title="Resulting PNG output resolution"
              >
                → {outputPreview.width}×{outputPreview.height} px
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
