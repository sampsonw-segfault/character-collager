export const DEFAULT_BRIDGE_BASE_URL = 'http://127.0.0.1:47821';

export type SnapshotterConnectionState = 'disconnected' | 'connecting' | 'connected';

export interface SnapshotterConfig {
  hotkey: string;
  output_dir: string;
  filename_prefix: string;
  default_width: number;
  default_height: number;
  box_width: number;
  box_height: number;
  square_lock: boolean;
  scale: number;
  overlay_opacity: number;
  play_chime: boolean;
  capture_mode: string;
  bridge_enabled: boolean;
  bridge_port: number;
}

export interface CapturedSnapshotMeta {
  id: string;
  file_name: string;
  folder_name: string;
  width: number;
  height: number;
  captured_at: string;
}

export interface SnapshotterStatus {
  app: string;
  version: string;
  port: number;
  overlay_active: boolean;
  config: SnapshotterConfig;
  recent_captures: CapturedSnapshotMeta[];
}

export interface SnapshotterEventHandlers {
  onStatus: (status: SnapshotterStatus) => void;
  onConfigUpdated: (status: SnapshotterStatus) => void;
  onOverlayState: (overlayActive: boolean) => void;
  onSnapshotCaptured: (meta: CapturedSnapshotMeta) => void;
  onError: () => void;
}

export function computeScaledOutput(
  capW: number,
  capH: number,
  scale: number
): { width: number; height: number } {
  const safeW = Math.max(1, Math.round(capW));
  const safeH = Math.max(1, Math.round(capH));
  const safeScale = Number.isFinite(scale) ? Math.max(0.05, Math.min(10.0, scale)) : 1.0;
  if (Math.abs(safeScale - 1.0) < 1e-6) {
    return { width: safeW, height: safeH };
  }
  return {
    width: Math.max(1, Math.round(safeW * safeScale)),
    height: Math.max(1, Math.round(safeH * safeScale)),
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 1500,
  externalSignal?: AbortSignal
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

export async function fetchSnapshotterStatus(
  baseUrl = DEFAULT_BRIDGE_BASE_URL,
  signal?: AbortSignal
): Promise<SnapshotterStatus> {
  const resp = await fetchWithTimeout(`${baseUrl}/api/status`, { method: 'GET' }, 1500, signal);
  if (!resp.ok) {
    throw new Error(`Snapshotter status failed (${resp.status})`);
  }
  const data = (await resp.json()) as SnapshotterStatus;
  if (data.app !== 'character-snapshotter') {
    throw new Error('Unexpected service on bridge port.');
  }
  return data;
}

export async function patchSnapshotterConfig(
  patch: Partial<SnapshotterConfig>,
  baseUrl = DEFAULT_BRIDGE_BASE_URL
): Promise<{ ok: boolean; status?: SnapshotterStatus; error?: string }> {
  const resp = await fetchWithTimeout(
    `${baseUrl}/api/config`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
    3000
  );
  const data = (await resp.json()) as {
    ok: boolean;
    status?: SnapshotterStatus;
    error?: string;
  };
  return data;
}

export async function triggerSnapshotter(
  action: 'toggle' | 'show' | 'capture' | 'cancel' | 'reset_size',
  baseUrl = DEFAULT_BRIDGE_BASE_URL
): Promise<{ ok: boolean; overlayActive?: boolean; status?: SnapshotterStatus; error?: string }> {
  const resp = await fetchWithTimeout(
    `${baseUrl}/api/trigger`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    },
    3000
  );
  const data = (await resp.json()) as {
    ok: boolean;
    overlay_active?: boolean;
    status?: SnapshotterStatus;
    error?: string;
  };
  return {
    ok: Boolean(data.ok),
    overlayActive: data.overlay_active,
    status: data.status,
    error: data.error,
  };
}

export async function browseSnapshotterFolder(baseUrl = DEFAULT_BRIDGE_BASE_URL): Promise<void> {
  const resp = await fetchWithTimeout(`${baseUrl}/api/browse-folder`, { method: 'POST' }, 2500);
  if (!resp.ok) {
    throw new Error('Could not open desktop folder picker.');
  }
}

export async function openSnapshotterFolder(baseUrl = DEFAULT_BRIDGE_BASE_URL): Promise<void> {
  const resp = await fetchWithTimeout(`${baseUrl}/api/open-folder`, { method: 'POST' }, 2500);
  if (!resp.ok) {
    throw new Error('Could not open output folder.');
  }
}

export async function openSnapshotterSettings(baseUrl = DEFAULT_BRIDGE_BASE_URL): Promise<void> {
  const resp = await fetchWithTimeout(`${baseUrl}/api/open-settings`, { method: 'POST' }, 2500);
  if (!resp.ok) {
    throw new Error('Could not open desktop Settings.');
  }
}

export async function fetchCapturedSnapshotFile(
  meta: CapturedSnapshotMeta,
  baseUrl = DEFAULT_BRIDGE_BASE_URL
): Promise<File> {
  const resp = await fetchWithTimeout(
    `${baseUrl}/api/captures/${encodeURIComponent(meta.id)}`,
    { method: 'GET' },
    5000
  );
  if (!resp.ok) {
    throw new Error(`Could not fetch captured image ${meta.file_name}`);
  }
  const blob = await resp.blob();
  return new File([blob], meta.file_name, { type: blob.type || 'image/png' });
}

export function subscribeSnapshotterEvents(
  handlers: SnapshotterEventHandlers,
  baseUrl = DEFAULT_BRIDGE_BASE_URL
): () => void {
  const source = new EventSource(`${baseUrl}/api/events`);

  source.addEventListener('status', (evt) => {
    try {
      handlers.onStatus(JSON.parse((evt as MessageEvent<string>).data) as SnapshotterStatus);
    } catch {
      // Ignore malformed event payload
    }
  });

  source.addEventListener('config_updated', (evt) => {
    try {
      handlers.onConfigUpdated(
        JSON.parse((evt as MessageEvent<string>).data) as SnapshotterStatus
      );
    } catch {
      // Ignore malformed event payload
    }
  });

  source.addEventListener('overlay_state', (evt) => {
    try {
      const data = JSON.parse((evt as MessageEvent<string>).data) as { overlay_active: boolean };
      handlers.onOverlayState(Boolean(data.overlay_active));
    } catch {
      // Ignore malformed event payload
    }
  });

  source.addEventListener('snapshot_captured', (evt) => {
    try {
      handlers.onSnapshotCaptured(
        JSON.parse((evt as MessageEvent<string>).data) as CapturedSnapshotMeta
      );
    } catch {
      // Ignore malformed event payload
    }
  });

  source.onerror = () => {
    handlers.onError();
  };

  return () => {
    source.close();
  };
}
