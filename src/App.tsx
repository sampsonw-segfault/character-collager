import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CollageCanvas } from './components/CollageCanvas';
import { LeftFileBrowser } from './components/LeftFileBrowser';
import { RightInspector } from './components/RightInspector';
import { SnapshotterPopover } from './components/SnapshotterPopover';
import { TopToolbar } from './components/TopToolbar';
import {
  createInitialProject,
  DEFAULT_BORDER_STYLE,
  DEFAULT_NAMEPLATE_TEXT_STYLE,
} from './presets/ck3Presets';
import {
  hydrateWorkspaceFiles,
  pickWorkspaceDirectory,
  RawWorkspaceFileEntry,
  reconnectDirectoryHandle,
  scanFileList,
  tryAutoReconnectDirectoryHandle,
  WorkspaceScanResult,
} from './services/fileSystemAdapter';
import {
  CachedFolderSource,
  loadAutosaveProject,
  loadCustomFonts,
  loadDirectoryHandle,
  loadExternalFilesCache,
  loadFolderSourcesCache,
  loadWorkspaceCache,
  registerCustomFontFace,
  saveAutosaveProject,
  saveCustomFonts,
  saveExternalFilesCache,
  saveFolderSourcesCache,
} from './services/idbStorage';
import {
  browseSnapshotterFolder,
  CapturedSnapshotMeta,
  DEFAULT_BRIDGE_BASE_URL,
  fetchCapturedSnapshotFile,
  fetchSnapshotterStatus,
  openSnapshotterFolder,
  openSnapshotterSettings,
  patchSnapshotterConfig,
  SnapshotterConnectionState,
  SnapshotterStatus,
  subscribeSnapshotterEvents,
  triggerSnapshotter,
} from './services/snapshotterBridge';
import {
  CanvasSettings,
  CollageItem,
  CollageProject,
  CustomFontRecord,
  ImageItem,
  LoadedImageAsset,
  SnapSettings,
  TextItem,
} from './types/collage';
import { computeExportBounds, exportCollageToPng } from './utils/canvasRenderer';
import { parseCharacterNameFromFilename } from './utils/ck3FilenameParser';
import { computeSnap, getImageOuterBounds } from './utils/snapEngine';

interface FolderSourceState {
  id: string;
  rootName: string;
  handle: FileSystemDirectoryHandle | null;
  assets: LoadedImageAsset[];
  rawFiles: RawWorkspaceFileEntry[];
}

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function prefixLegacyEntries(
  rootName: string,
  files: RawWorkspaceFileEntry[]
): RawWorkspaceFileEntry[] {
  const prefix = `${rootName}/`;
  return files.map((f) => {
    if (f.relativePath.startsWith(prefix)) return f;
    return {
      ...f,
      relativePath: `${rootName}/${f.relativePath}`,
      folderPath: f.folderPath ? `${rootName}/${f.folderPath}` : rootName,
    };
  });
}

function upgradeLegacyProjectPaths(
  draft: CollageProject,
  rootName: string,
  allAssets: LoadedImageAsset[]
): CollageProject {
  if (!rootName) return draft;
  const validSet = new Set(allAssets.map((a) => a.file.relativePath));
  let changed = false;
  const items = draft.items.map((it) => {
    if (it.type !== 'image' || validSet.has(it.sourcePath)) return it;
    const candidate = `${rootName}/${it.sourcePath}`;
    if (validSet.has(candidate)) {
      changed = true;
      return { ...it, sourcePath: candidate };
    }
    return it;
  });
  return changed ? { ...draft, items } : draft;
}

export const App: React.FC = () => {
  const [project, setProject] = useState<CollageProject>(() => createInitialProject());
  const [past, setPast] = useState<CollageProject[]>([]);
  const [future, setFuture] = useState<CollageProject[]>([]);

  const [folderSources, setFolderSources] = useState<FolderSourceState[]>([]);
  const [externalAssets, setExternalAssets] = useState<LoadedImageAsset[]>([]);
  const [isScanning, setIsScanning] = useState(false);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [croppingImageId, setCroppingImageId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const [customFonts, setCustomFonts] = useState<CustomFontRecord[]>([]);
  const [detectedCk3Fonts, setDetectedCk3Fonts] = useState<Array<{ family: string; label: string }>>([]);

  const [camera, setCamera] = useState({ panX: 120, panY: 80, zoom: 0.45 });
  const viewportSizeRef = useRef({ width: 900, height: 700 });
  const dragBaseProjectRef = useRef<CollageProject | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement | null>(null);
  const hasHydratedRef = useRef(false);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const [snapshotterState, setSnapshotterState] =
    useState<SnapshotterConnectionState>('disconnected');
  const [snapshotterStatus, setSnapshotterStatus] = useState<SnapshotterStatus | null>(null);
  const [snapshotterPopoverOpen, setSnapshotterPopoverOpen] = useState(false);
  const [autoImportSnapshots, setAutoImportSnapshots] = useState(true);
  const [autoPlaceSnapshots, setAutoPlaceSnapshots] = useState(false);
  const snapshotterBtnRef = useRef<HTMLButtonElement | null>(null);
  const snapshotterStateRef = useRef<SnapshotterConnectionState>('disconnected');
  snapshotterStateRef.current = snapshotterState;
  const unsubscribeSseRef = useRef<(() => void) | null>(null);
  const probeInFlightRef = useRef(false);
  const seenCaptureIdsRef = useRef<Set<string>>(new Set());
  const autoImportSnapshotsRef = useRef(true);
  autoImportSnapshotsRef.current = autoImportSnapshots;
  const autoPlaceSnapshotsRef = useRef(false);
  autoPlaceSnapshotsRef.current = autoPlaceSnapshots;
  const ingestCapturedSnapshotRef = useRef<(meta: CapturedSnapshotMeta) => Promise<void>>(
    async () => {}
  );

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3400);
  }, []);

  const folderSourcesRef = useRef<FolderSourceState[]>([]);
  folderSourcesRef.current = folderSources;
  const externalAssetsRef = useRef<LoadedImageAsset[]>([]);
  externalAssetsRef.current = externalAssets;

  // Revoke remaining blob URLs only on unmount
  useEffect(() => {
    return () => {
      for (const src of folderSourcesRef.current) {
        for (const a of src.assets) {
          URL.revokeObjectURL(a.file.objectUrl);
        }
      }
      for (const a of externalAssetsRef.current) {
        URL.revokeObjectURL(a.file.objectUrl);
      }
    };
  }, []);

  // Initial load from IndexedDB (folder sources, legacy workspace cache, external files, draft, custom fonts)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [
          savedSources,
          legacyHandle,
          legacyWorkspaceCache,
          draft,
          fonts,
          cachedExternal,
        ] = await Promise.all([
          loadFolderSourcesCache(),
          loadDirectoryHandle(),
          loadWorkspaceCache(),
          loadAutosaveProject(),
          loadCustomFonts(),
          loadExternalFilesCache(),
        ]);
        if (cancelled) return;

        if (cachedExternal.length > 0) {
          const hydratedExt = await hydrateWorkspaceFiles(cachedExternal);
          if (cancelled) {
            hydratedExt.forEach((a) => URL.revokeObjectURL(a.file.objectUrl));
            return;
          }
          setExternalAssets(hydratedExt);
        }

        if (fonts.length > 0) {
          for (const f of fonts) {
            try {
              await registerCustomFontFace(f);
            } catch {
              // Skip invalid cached font
            }
          }
          if (!cancelled) setCustomFonts(fonts);
        }

        let initialDraft = draft && draft.canvas && Array.isArray(draft.items) ? draft : null;

        // In local dev mode, auto-detect installed CK3 fonts from Steam directories
        if (import.meta.env.DEV) {
          try {
            const resp = await fetch('/__ck3_local_fonts/manifest.json');
            if (resp.ok) {
              const manifest = (await resp.json()) as {
                found: boolean;
                families: Array<{ family: string; label: string }>;
                faces: Array<{ family: string; weight: string; style: string; rel: string }>;
              };
              if (!cancelled && manifest.found && manifest.faces.length > 0) {
                for (const face of manifest.faces) {
                  try {
                    const url = `/__ck3_local_fonts/file?rel=${encodeURIComponent(face.rel)}`;
                    const ff = new FontFace(face.family, `url(${url})`, {
                      weight: face.weight,
                      style: face.style,
                    });
                    const loaded = await ff.load();
                    if (!cancelled) document.fonts.add(loaded);
                  } catch {
                    // Ignore unreadable local font face
                  }
                }
                if (!cancelled) {
                  setDetectedCk3Fonts(manifest.families);
                }
              }
            }
          } catch {
            // Local font auto-detect endpoint unavailable (e.g., static hosting)
          }
        }

        const restoredSources: FolderSourceState[] = [];
        if (savedSources.length > 0) {
          setIsScanning(true);
          for (const src of savedSources) {
            if (cancelled) break;
            if (src.handle) {
              const reconnected = await tryAutoReconnectDirectoryHandle(src.handle, src.rootName);
              if (cancelled) {
                reconnected?.assets.forEach((a) => URL.revokeObjectURL(a.file.objectUrl));
                break;
              }
              if (reconnected) {
                restoredSources.push({
                  id: src.id,
                  rootName: reconnected.rootName,
                  handle: reconnected.handle,
                  assets: reconnected.assets,
                  rawFiles: reconnected.rawFiles,
                });
                continue;
              }
            }
            if (src.files.length > 0) {
              const hydrated = await hydrateWorkspaceFiles(src.files);
              if (cancelled) {
                hydrated.forEach((a) => URL.revokeObjectURL(a.file.objectUrl));
                break;
              }
              restoredSources.push({
                id: src.id,
                rootName: src.rootName,
                handle: src.handle,
                assets: hydrated,
                rawFiles: src.files,
              });
            }
          }
        } else if (legacyHandle || (legacyWorkspaceCache && legacyWorkspaceCache.files.length > 0)) {
          setIsScanning(true);
          if (legacyHandle) {
            const reconnected = await tryAutoReconnectDirectoryHandle(legacyHandle);
            if (!cancelled && reconnected) {
              restoredSources.push({
                id: createId('src'),
                rootName: reconnected.rootName,
                handle: reconnected.handle,
                assets: reconnected.assets,
                rawFiles: reconnected.rawFiles,
              });
            } else if (cancelled && reconnected) {
              reconnected.assets.forEach((a) => URL.revokeObjectURL(a.file.objectUrl));
            }
          }
          if (
            !cancelled &&
            restoredSources.length === 0 &&
            legacyWorkspaceCache &&
            legacyWorkspaceCache.files.length > 0
          ) {
            const prefixedFiles = prefixLegacyEntries(
              legacyWorkspaceCache.rootName,
              legacyWorkspaceCache.files
            );
            const hydrated = await hydrateWorkspaceFiles(prefixedFiles);
            if (cancelled) {
              hydrated.forEach((a) => URL.revokeObjectURL(a.file.objectUrl));
              return;
            }
            restoredSources.push({
              id: createId('src'),
              rootName: legacyWorkspaceCache.rootName,
              handle: legacyHandle,
              assets: hydrated,
              rawFiles: prefixedFiles,
            });
          }
          if (!cancelled && restoredSources.length > 0) {
            void saveFolderSourcesCache(
              restoredSources.map((s) => ({
                id: s.id,
                rootName: s.rootName,
                handle: s.handle,
                files: s.rawFiles,
              }))
            );
          }
        }

        if (!cancelled && restoredSources.length > 0) {
          setFolderSources(restoredSources);
          const allRestoredAssets = restoredSources.flatMap((s) => s.assets);
          if (initialDraft) {
            initialDraft = upgradeLegacyProjectPaths(
              initialDraft,
              restoredSources[0].rootName,
              allRestoredAssets
            );
          }
          const totalCount = allRestoredAssets.length;
          showToast(
            `Restored ${totalCount} portrait${totalCount === 1 ? '' : 's'} across ${restoredSources.length} folder${restoredSources.length === 1 ? '' : 's'}`
          );
        }

        if (!cancelled && initialDraft) {
          setProject(initialDraft);
        }
      } finally {
        if (!cancelled) {
          setIsScanning(false);
          hasHydratedRef.current = true;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  // Debounced autosave of active project
  useEffect(() => {
    if (!hasHydratedRef.current) return;
    const timer = window.setTimeout(() => {
      void saveAutosaveProject(project);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [project]);

  const allFolderAssets = useMemo(
    () => folderSources.flatMap((s) => s.assets),
    [folderSources]
  );

  const folderSourceSummaries = useMemo(
    () =>
      folderSources.map((s) => ({
        id: s.id,
        rootName: s.rootName,
        count: s.assets.length,
        hasHandle: s.handle !== null,
      })),
    [folderSources]
  );

  const assetMap = useMemo(() => {
    const map = new Map<string, LoadedImageAsset>();
    for (const a of allFolderAssets) {
      map.set(a.file.relativePath, a);
    }
    for (const a of externalAssets) {
      map.set(a.file.relativePath, a);
    }
    return map;
  }, [allFolderAssets, externalAssets]);

  const missingImages = useMemo(
    () =>
      project.items.filter(
        (it): it is ImageItem => it.type === 'image' && !assetMap.has(it.sourcePath)
      ),
    [project.items, assetMap]
  );

  const commitProject = useCallback((next: CollageProject) => {
    setProject((prev) => {
      setPast((p) => [...p.slice(-59), prev]);
      setFuture([]);
      return next;
    });
  }, []);

  const handleUndo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const previous = p[p.length - 1];
      setFuture((f) => [project, ...f]);
      setProject(previous);
      setCroppingImageId(null);
      return p.slice(0, -1);
    });
  }, [project]);

  const handleRedo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[0];
      setPast((p) => [...p.slice(-59), project]);
      setProject(next);
      setCroppingImageId(null);
      return f.slice(1);
    });
  }, [project]);

  const persistFolderSources = useCallback((sources: FolderSourceState[]) => {
    const serialized: CachedFolderSource[] = sources.map((s) => ({
      id: s.id,
      rootName: s.rootName,
      handle: s.handle,
      files: s.rawFiles,
    }));
    void saveFolderSourcesCache(serialized);
  }, []);

  const upsertFolderSource = useCallback(
    (result: WorkspaceScanResult, targetSourceId?: string) => {
      const prev = folderSourcesRef.current;
      const existingIndex = targetSourceId
        ? prev.findIndex((s) => s.id === targetSourceId)
        : prev.findIndex((s) => s.rootName === result.rootName);

      let nextSources: FolderSourceState[];
      if (existingIndex >= 0) {
        const old = prev[existingIndex];
        for (const a of old.assets) {
          URL.revokeObjectURL(a.file.objectUrl);
        }
        nextSources = prev.map((s, idx) =>
          idx === existingIndex
            ? {
                id: s.id,
                rootName: result.rootName,
                handle: result.handle,
                assets: result.assets,
                rawFiles: result.rawFiles,
              }
            : s
        );
      } else {
        nextSources = [
          ...prev,
          {
            id: createId('src'),
            rootName: result.rootName,
            handle: result.handle,
            assets: result.assets,
            rawFiles: result.rawFiles,
          },
        ];
      }

      setFolderSources(nextSources);
      persistFolderSources(nextSources);
      setProject((p) => ({
        ...p,
        workspaceRootName: p.workspaceRootName || result.rootName,
      }));
      showToast(`Loaded ${result.assets.length} portraits from "${result.rootName}"`);
    },
    [persistFolderSources, showToast]
  );

  const handleAddFolder = async () => {
    try {
      setIsScanning(true);
      const result = await pickWorkspaceDirectory();
      upsertFolderSource(result);
    } catch (err) {
      if ((err as DOMException)?.name !== 'AbortError') {
        showToast('Could not add folder.');
      }
    } finally {
      setIsScanning(false);
    }
  };

  const handleFallbackFilesSelected = async (files: FileList) => {
    try {
      setIsScanning(true);
      const result = await scanFileList(files);
      upsertFolderSource(result);
    } finally {
      setIsScanning(false);
    }
  };

  const handleRefreshSource = async (sourceId: string) => {
    const src = folderSources.find((s) => s.id === sourceId);
    if (!src?.handle) return;
    try {
      setIsScanning(true);
      const result = await reconnectDirectoryHandle(src.handle, src.rootName);
      upsertFolderSource(result, sourceId);
    } catch {
      showToast(`Could not refresh "${src.rootName}". Try adding it again.`);
    } finally {
      setIsScanning(false);
    }
  };

  const handleRemoveSource = (sourceId: string) => {
    const target = folderSources.find((s) => s.id === sourceId);
    if (!target) return;

    const usedOnCanvas = new Set(
      project.items
        .filter((it): it is ImageItem => it.type === 'image')
        .map((it) => it.sourcePath)
    );
    const existingExtPaths = new Set(externalAssets.map((a) => a.file.relativePath));

    const retained: LoadedImageAsset[] = [];
    for (const a of target.assets) {
      if (usedOnCanvas.has(a.file.relativePath) && !existingExtPaths.has(a.file.relativePath)) {
        retained.push(a);
      } else {
        URL.revokeObjectURL(a.file.objectUrl);
      }
    }

    if (retained.length > 0) {
      const nextExt = [...externalAssets, ...retained];
      setExternalAssets(nextExt);
      void saveExternalFilesCache(
        nextExt.map((a) => ({
          relativePath: a.file.relativePath,
          folderPath: a.file.folderPath,
          fileName: a.file.fileName,
          file: a.file.file,
        }))
      );
    }

    const nextSources = folderSources.filter((s) => s.id !== sourceId);
    setFolderSources(nextSources);
    persistFolderSources(nextSources);
    showToast(
      retained.length > 0
        ? `Removed "${target.rootName}" (kept ${retained.length} placed canvas image${retained.length > 1 ? 's' : ''})`
        : `Removed "${target.rootName}"`
    );
  };

  const handleUpdateItems = useCallback(
    (nextItems: CollageItem[], commitHistory: boolean) => {
      if (!commitHistory) {
        setProject((prev) => {
          if (!dragBaseProjectRef.current) {
            dragBaseProjectRef.current = prev;
          }
          return { ...prev, items: nextItems };
        });
      } else {
        const base = dragBaseProjectRef.current ?? project;
        dragBaseProjectRef.current = null;
        setPast((p) => [...p.slice(-59), base]);
        setFuture([]);
        setProject((prev) => ({ ...prev, items: nextItems }));
      }
    },
    [project]
  );

  const handleUpdateCanvas = useCallback(
    (patch: Partial<CanvasSettings>) => {
      commitProject({
        ...project,
        canvas: { ...project.canvas, ...patch },
      });
    },
    [commitProject, project]
  );

  const handleUpdateSnap = useCallback(
    (patch: Partial<SnapSettings>) => {
      setProject((prev) => ({
        ...prev,
        canvas: {
          ...prev.canvas,
          snap: { ...prev.canvas.snap, ...patch },
        },
      }));
    },
    []
  );

  const getNextZIndex = (items: CollageItem[]): number =>
    items.reduce((max, it) => Math.max(max, it.zIndex), 0) + 1;

  const placeLoadedAsset = useCallback(
    (asset: LoadedImageAsset, worldX?: number, worldY?: number) => {
      const w = asset.file.naturalWidth;
      const h = asset.file.naturalHeight;
      const existingImages = project.items.filter((it): it is ImageItem => it.type === 'image');

      let x: number;
      let y: number;
      if (worldX !== undefined && worldY !== undefined) {
        x = Math.round(worldX - w / 2);
        y = Math.round(worldY - h / 2);
        if (project.canvas.snap.enabled && existingImages.length > 0) {
          const targetRects = existingImages.map(getImageOuterBounds);
          const snapRes = computeSnap(
            { x, y, width: w, height: h },
            targetRects,
            project.canvas.snap,
            camera.zoom
          );
          x = Math.round(x + snapRes.dx);
          y = Math.round(y + snapRes.dy);
        }
      } else if (existingImages.length === 0) {
        x = 20;
        y = 20;
      } else {
        const last = existingImages[existingImages.length - 1];
        x = Math.round(last.x + last.width + project.canvas.snap.gapX);
        y = Math.round(last.y);
      }

      const z = getNextZIndex(project.items);
      const imageItem: ImageItem = {
        id: createId('img'),
        type: 'image',
        sourcePath: asset.file.relativePath,
        fileName: asset.file.fileName,
        x,
        y,
        width: w,
        height: h,
        naturalWidth: w,
        naturalHeight: h,
        aspectLocked: true,
        crop: null,
        zIndex: z,
        border: { ...DEFAULT_BORDER_STYLE },
        decorators: [],
      };

      const nextItems: CollageItem[] = [...project.items, imageItem];

      commitProject({ ...project, items: nextItems });
      setSelectedIds([imageItem.id]);
      setCroppingImageId(null);
    },
    [camera.zoom, commitProject, project]
  );

  const placeAsset = useCallback(
    (relativePath: string, worldX?: number, worldY?: number) => {
      const asset = assetMap.get(relativePath);
      if (!asset) return;
      placeLoadedAsset(asset, worldX, worldY);
    },
    [assetMap, placeLoadedAsset]
  );

  const ingestCapturedSnapshot = useCallback(
    async (meta: CapturedSnapshotMeta) => {
      if (!autoImportSnapshotsRef.current) return;
      if (seenCaptureIdsRef.current.has(meta.id)) return;
      seenCaptureIdsRef.current.add(meta.id);

      try {
        const file = await fetchCapturedSnapshotFile(meta, DEFAULT_BRIDGE_BASE_URL);
        const existingLive = folderSourcesRef.current.find((s) => s.id === 'live-snapshotter');
        const usedPaths = new Set((existingLive?.rawFiles ?? []).map((f) => f.relativePath));

        let relativePath = `Live Snapshots/${meta.file_name}`;
        if (usedPaths.has(relativePath)) {
          const dotIdx = meta.file_name.lastIndexOf('.');
          const stem = dotIdx > 0 ? meta.file_name.slice(0, dotIdx) : meta.file_name;
          const ext = dotIdx > 0 ? meta.file_name.slice(dotIdx) : '';
          let suffix = 2;
          while (usedPaths.has(`Live Snapshots/${stem}_${suffix}${ext}`)) {
            suffix++;
          }
          relativePath = `Live Snapshots/${stem}_${suffix}${ext}`;
        }

        const entry: RawWorkspaceFileEntry = {
          relativePath,
          folderPath: 'Live Snapshots',
          fileName: meta.file_name,
          file,
        };
        const hydrated = await hydrateWorkspaceFiles([entry]);
        if (hydrated.length === 0) {
          showToast(`Could not decode captured snapshot "${meta.file_name}".`);
          return;
        }
        const loadedAsset = hydrated[0];

        const prevSources = folderSourcesRef.current;
        const currentLive = prevSources.find((s) => s.id === 'live-snapshotter');
        const nextLive: FolderSourceState = currentLive
          ? {
              ...currentLive,
              assets: [loadedAsset, ...currentLive.assets],
              rawFiles: [entry, ...currentLive.rawFiles],
            }
          : {
              id: 'live-snapshotter',
              rootName: 'Live Snapshots',
              handle: null,
              assets: [loadedAsset],
              rawFiles: [entry],
            };
        const nextSources = [nextLive, ...prevSources.filter((s) => s.id !== 'live-snapshotter')];
        folderSourcesRef.current = nextSources;
        setFolderSources(nextSources);
        persistFolderSources(nextSources);

        if (autoPlaceSnapshotsRef.current) {
          placeLoadedAsset(loadedAsset);
        }

        showToast(`Captured ${meta.file_name} (${meta.width}×${meta.height})`);
      } catch {
        seenCaptureIdsRef.current.delete(meta.id);
        showToast(`Could not import captured snapshot "${meta.file_name}".`);
      }
    },
    [persistFolderSources, placeLoadedAsset, showToast]
  );

  ingestCapturedSnapshotRef.current = ingestCapturedSnapshot;

  const connectToSnapshotter = useCallback(async (manual = false) => {
    if (probeInFlightRef.current) return;
    if (snapshotterStateRef.current === 'connected' && !manual) return;

    probeInFlightRef.current = true;
    if (manual) {
      setSnapshotterState('connecting');
    }

    try {
      const initialStatus = await fetchSnapshotterStatus(DEFAULT_BRIDGE_BASE_URL);
      unsubscribeSseRef.current?.();
      setSnapshotterStatus(initialStatus);
      setSnapshotterState('connected');

      unsubscribeSseRef.current = subscribeSnapshotterEvents(
        {
          onStatus: (nextStatus) => {
            setSnapshotterStatus(nextStatus);
            setSnapshotterState('connected');
          },
          onConfigUpdated: (nextStatus) => {
            setSnapshotterStatus(nextStatus);
          },
          onOverlayState: (overlayActive) => {
            setSnapshotterStatus((prev) =>
              prev ? { ...prev, overlay_active: overlayActive } : prev
            );
          },
          onSnapshotCaptured: (meta) => {
            void ingestCapturedSnapshotRef.current(meta);
          },
          onError: () => {
            unsubscribeSseRef.current?.();
            unsubscribeSseRef.current = null;
            setSnapshotterState('disconnected');
            setSnapshotterStatus(null);
          },
        },
        DEFAULT_BRIDGE_BASE_URL
      );
    } catch {
      setSnapshotterState('disconnected');
      setSnapshotterStatus(null);
    } finally {
      probeInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    void connectToSnapshotter(false);

    const onWindowFocus = () => {
      if (snapshotterStateRef.current === 'disconnected') {
        void connectToSnapshotter(false);
      }
    };
    const onVisibilityChange = () => {
      if (!document.hidden && snapshotterStateRef.current === 'disconnected') {
        void connectToSnapshotter(false);
      }
    };

    window.addEventListener('focus', onWindowFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', onWindowFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      unsubscribeSseRef.current?.();
      unsubscribeSseRef.current = null;
    };
  }, [connectToSnapshotter]);

  const handleAddExternalImages = async (fileList: FileList) => {
    const imageFiles = Array.from(fileList).filter(
      (f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name)
    );
    if (imageFiles.length === 0) {
      showToast('No supported image files selected.');
      return;
    }

    const usedPaths = new Set<string>([
      ...allFolderAssets.map((a) => a.file.relativePath),
      ...externalAssets.map((a) => a.file.relativePath),
    ]);

    const entries: RawWorkspaceFileEntry[] = imageFiles.map((file) => {
      let rel = `external/${file.name}`;
      if (usedPaths.has(rel)) {
        const dotIdx = file.name.lastIndexOf('.');
        const stem = dotIdx > 0 ? file.name.slice(0, dotIdx) : file.name;
        const ext = dotIdx > 0 ? file.name.slice(dotIdx) : '';
        let suffix = 2;
        while (usedPaths.has(`external/${stem}_${suffix}${ext}`)) {
          suffix++;
        }
        rel = `external/${stem}_${suffix}${ext}`;
      }
      usedPaths.add(rel);
      return {
        relativePath: rel,
        folderPath: 'external',
        fileName: file.name,
        file,
      };
    });

    const loaded = await hydrateWorkspaceFiles(entries);
    if (loaded.length === 0) {
      showToast('Could not decode selected image file(s).');
      return;
    }

    const nextExternal = [...externalAssets, ...loaded];
    setExternalAssets(nextExternal);
    void saveExternalFilesCache(
      nextExternal.map((a) => ({
        relativePath: a.file.relativePath,
        folderPath: a.file.folderPath,
        fileName: a.file.fileName,
        file: a.file.file,
      }))
    );

    const existingImages = project.items.filter((it): it is ImageItem => it.type === 'image');
    let nextX: number;
    let nextY: number;
    if (existingImages.length === 0) {
      const view = viewportSizeRef.current;
      const first = loaded[0].file;
      nextX = Math.round((view.width / 2 - camera.panX) / camera.zoom - first.naturalWidth / 2);
      nextY = Math.round((view.height / 2 - camera.panY) / camera.zoom - first.naturalHeight / 2);
    } else {
      const last = existingImages[existingImages.length - 1];
      nextX = Math.round(last.x + last.width + project.canvas.snap.gapX);
      nextY = Math.round(last.y);
    }

    let zCursor = getNextZIndex(project.items);
    const addedItems: ImageItem[] = [];
    for (const asset of loaded) {
      const w = asset.file.naturalWidth;
      const h = asset.file.naturalHeight;
      addedItems.push({
        id: createId('img'),
        type: 'image',
        sourcePath: asset.file.relativePath,
        fileName: asset.file.fileName,
        x: nextX,
        y: nextY,
        width: w,
        height: h,
        naturalWidth: w,
        naturalHeight: h,
        aspectLocked: true,
        crop: null,
        zIndex: zCursor++,
        border: { ...DEFAULT_BORDER_STYLE },
        decorators: [],
      });
      nextX += w + project.canvas.snap.gapX;
    }

    commitProject({ ...project, items: [...project.items, ...addedItems] });
    setSelectedIds(addedItems.map((it) => it.id));
    setCroppingImageId(null);
    showToast(`Added ${addedItems.length} image${addedItems.length > 1 ? 's' : ''} to canvas`);
  };

  const handleAddGlobalText = () => {
    const view = viewportSizeRef.current;
    const centerWorldX = Math.round((view.width / 2 - camera.panX) / camera.zoom);
    const centerWorldY = Math.round((view.height / 2 - camera.panY) / camera.zoom);
    const textItem: TextItem = {
      id: createId('txt'),
      type: 'text',
      parentImageId: null,
      offsetX: centerWorldX,
      offsetY: centerWorldY,
      text: 'Dynasty Title',
      ...DEFAULT_NAMEPLATE_TEXT_STYLE,
      fontSize: 48,
      anchor: 'center',
      zIndex: getNextZIndex(project.items),
    };
    commitProject({ ...project, items: [...project.items, textItem] });
    setSelectedIds([textItem.id]);
  };

  const handleAddAttachedText = (parentImageId: string) => {
    const parent = project.items.find(
      (it): it is ImageItem => it.id === parentImageId && it.type === 'image'
    );
    if (!parent) return;
    const textItem: TextItem = {
      id: createId('txt'),
      type: 'text',
      parentImageId: parent.id,
      offsetX: Math.round(parent.width / 2),
      offsetY: Math.round(parent.height - 13),
      text: parseCharacterNameFromFilename(parent.fileName),
      ...DEFAULT_NAMEPLATE_TEXT_STYLE,
      zIndex: parent.zIndex,
    };
    commitProject({ ...project, items: [...project.items, textItem] });
    setSelectedIds([textItem.id]);
    window.setTimeout(() => textInputRef.current?.focus(), 20);
  };

  const handleUpdateSelectedImages = useCallback(
    (updater: (item: ImageItem) => ImageItem, commit = true) => {
      const set = new Set(selectedIds);
      const nextItems = project.items.map((it) =>
        it.type === 'image' && set.has(it.id) ? updater(it) : it
      );
      if (commit) {
        commitProject({ ...project, items: nextItems });
      } else {
        setProject((prev) => ({ ...prev, items: nextItems }));
      }
    },
    [commitProject, project, selectedIds]
  );

  const handleUpdateSelectedTexts = useCallback(
    (updater: (item: TextItem) => TextItem, commit = true) => {
      const set = new Set(selectedIds);
      const nextItems = project.items.map((it) =>
        it.type === 'text' && set.has(it.id) ? updater(it) : it
      );
      if (commit) {
        commitProject({ ...project, items: nextItems });
      } else {
        setProject((prev) => ({ ...prev, items: nextItems }));
      }
    },
    [commitProject, project, selectedIds]
  );

  const handleDeleteIds = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const delSet = new Set(ids);
      // Also delete text boxes attached to deleted images
      const nextItems = project.items.filter((it) => {
        if (delSet.has(it.id)) return false;
        if (it.type === 'text' && it.parentImageId && delSet.has(it.parentImageId)) return false;
        return true;
      });
      commitProject({ ...project, items: nextItems });
      setSelectedIds([]);
      setCroppingImageId(null);
    },
    [commitProject, project]
  );

  const handleMoveZOrder = (
    ids: string[],
    mode: 'front' | 'back' | 'forward' | 'backward'
  ) => {
    if (ids.length === 0) return;
    const sorted = project.items
      .filter((it) => it.type === 'image' || it.parentImageId === null)
      .sort((a, b) => a.zIndex - b.zIndex);
    const idSet = new Set(ids);

    let reordered: CollageItem[];
    if (mode === 'front') {
      reordered = [...sorted.filter((i) => !idSet.has(i.id)), ...sorted.filter((i) => idSet.has(i.id))];
    } else if (mode === 'back') {
      reordered = [...sorted.filter((i) => idSet.has(i.id)), ...sorted.filter((i) => !idSet.has(i.id))];
    } else if (mode === 'forward') {
      reordered = [...sorted];
      for (let i = reordered.length - 2; i >= 0; i--) {
        if (idSet.has(reordered[i].id) && !idSet.has(reordered[i + 1].id)) {
          [reordered[i], reordered[i + 1]] = [reordered[i + 1], reordered[i]];
        }
      }
    } else {
      reordered = [...sorted];
      for (let i = 1; i < reordered.length; i++) {
        if (idSet.has(reordered[i].id) && !idSet.has(reordered[i - 1].id)) {
          [reordered[i], reordered[i - 1]] = [reordered[i - 1], reordered[i]];
        }
      }
    }

    const zById = new Map<string, number>();
    reordered.forEach((it, idx) => zById.set(it.id, idx + 1));

    const nextItems = project.items.map((it) => {
      if (it.type === 'text' && it.parentImageId) {
        return {
          ...it,
          zIndex: zById.get(it.parentImageId) ?? it.zIndex,
        };
      }
      return {
        ...it,
        zIndex: zById.get(it.id) ?? it.zIndex,
      };
    });
    commitProject({ ...project, items: nextItems });
  };

  const fitProjectCamera = useCallback((targetProject: CollageProject) => {
    const bounds = computeExportBounds(targetProject);
    const vw = viewportSizeRef.current.width;
    const vh = viewportSizeRef.current.height;
    const pad = 64;
    const scaleX = (vw - pad) / Math.max(1, bounds.width);
    const scaleY = (vh - pad) / Math.max(1, bounds.height);
    const nextZoom = Math.min(1.5, Math.max(0.08, Math.min(scaleX, scaleY)));
    const nextPanX = (vw - bounds.width * nextZoom) / 2 - bounds.x * nextZoom;
    const nextPanY = (vh - bounds.height * nextZoom) / 2 - bounds.y * nextZoom;
    setCamera({ panX: nextPanX, panY: nextPanY, zoom: nextZoom });
  }, []);

  const handleZoomFit = useCallback(() => {
    fitProjectCamera(project);
  }, [fitProjectCamera, project]);

  const handleZoomStep = (factor: number) => {
    const vw = viewportSizeRef.current.width;
    const vh = viewportSizeRef.current.height;
    const cx = vw / 2;
    const cy = vh / 2;
    setCamera((prev) => {
      const nextZoom = Math.min(6, Math.max(0.08, prev.zoom * factor));
      const wx = (cx - prev.panX) / prev.zoom;
      const wy = (cy - prev.panY) / prev.zoom;
      return {
        zoom: nextZoom,
        panX: cx - wx * nextZoom,
        panY: cy - wy * nextZoom,
      };
    });
  };

  const handleZoomReset = () => {
    const bounds = computeExportBounds(project);
    const vw = viewportSizeRef.current.width;
    const vh = viewportSizeRef.current.height;
    setCamera({
      zoom: 1,
      panX: (vw - bounds.width) / 2 - bounds.x,
      panY: (vh - bounds.height) / 2 - bounds.y,
    });
  };

  // Global keyboard shortcuts (Undo, Redo, Delete, Arrow nudging)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length > 0) {
        e.preventDefault();
        handleDeleteIds(selectedIds);
        return;
      }

      if (
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) &&
        selectedIds.length > 0
      ) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const selSet = new Set(selectedIds);
        const nextItems = project.items.map((it) => {
          if (!selSet.has(it.id)) return it;
          if (it.type === 'image') return { ...it, x: it.x + dx, y: it.y + dy };
          if (it.parentImageId && selSet.has(it.parentImageId)) return it;
          return { ...it, offsetX: it.offsetX + dx, offsetY: it.offsetY + dy };
        });
        commitProject({ ...project, items: nextItems });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [commitProject, handleDeleteIds, handleRedo, handleUndo, project, selectedIds]);

  const handleSaveProject = async () => {
    const json = JSON.stringify(project, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const suggested = `${project.workspaceRootName || 'character-collage'}.collage.json`;

    if (window.showSaveFilePicker) {
      try {
        const fh = await window.showSaveFilePicker({
          suggestedName: suggested,
          types: [{ description: 'Collage Project', accept: { 'application/json': ['.json'] } }],
        });
        const w = await fh.createWritable();
        await w.write(blob);
        await w.close();
        showToast(`Saved ${fh.name}`);
        return;
      } catch (err) {
        if ((err as DOMException)?.name === 'AbortError') return;
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggested;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Downloaded ${suggested}`);
  };

  const handleLoadProjectFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as CollageProject;
      if (!parsed || !parsed.canvas || !Array.isArray(parsed.items)) {
        showToast('Invalid .collage.json project file.');
        return;
      }
      commitProject(parsed);
      setSelectedIds([]);
      setCroppingImageId(null);
      fitProjectCamera(parsed);
      showToast(`Opened project "${file.name}"`);
    } catch {
      showToast('Failed to read project JSON file.');
    }
  };

  const handleExportPng = async () => {
    try {
      setIsExporting(true);
      const suggested = `${project.workspaceRootName || 'collage'}.png`;
      const saved = await exportCollageToPng(project, assetMap, suggested);
      if (saved) {
        showToast('PNG collage exported at full 1:1 resolution.');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleReplaceImageSource = (imageId: string, newRelativePath: string) => {
    const asset = assetMap.get(newRelativePath);
    if (!asset) return;
    const nextItems = project.items.map((it) =>
      it.id === imageId && it.type === 'image'
        ? {
            ...it,
            sourcePath: asset.file.relativePath,
            fileName: asset.file.fileName,
            naturalWidth: asset.file.naturalWidth,
            naturalHeight: asset.file.naturalHeight,
            crop: null,
          }
        : it
    );
    commitProject({ ...project, items: nextItems });
    showToast(`Linked to ${asset.file.fileName}`);
  };

  const handleAutoRelinkMissing = () => {
    if (allFolderAssets.length === 0 || missingImages.length === 0) return;
    const byName = new Map<string, LoadedImageAsset>();
    for (const a of allFolderAssets) {
      const key = a.file.fileName.toLowerCase();
      if (!byName.has(key)) byName.set(key, a);
    }

    let relinkedCount = 0;
    const nextItems = project.items.map((it) => {
      if (it.type !== 'image' || assetMap.has(it.sourcePath)) return it;
      const found = byName.get(it.fileName.toLowerCase());
      if (!found) return it;
      relinkedCount++;
      return {
        ...it,
        sourcePath: found.file.relativePath,
        fileName: found.file.fileName,
        naturalWidth: found.file.naturalWidth,
        naturalHeight: found.file.naturalHeight,
      };
    });

    if (relinkedCount > 0) {
      commitProject({ ...project, items: nextItems });
      showToast(`Auto-relinked ${relinkedCount} moved image(s)!`);
    } else {
      showToast('No matching filenames found in the current folder.');
    }
  };

  const handleImportFontFile = async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      const familyName = file.name.replace(/\.[^/.]+$/, '').trim() || 'CustomFont';
      const record: CustomFontRecord = {
        id: createId('font'),
        familyName,
        fileName: file.name,
        buffer,
      };
      await registerCustomFontFace(record);
      const nextFonts = [
        ...customFonts.filter((f) => f.familyName !== familyName),
        record,
      ];
      setCustomFonts(nextFonts);
      await saveCustomFonts(nextFonts);

      // Apply immediately to selected text boxes
      if (selectedIds.length > 0) {
        handleUpdateSelectedTexts((t) => ({ ...t, fontFamily: familyName }), true);
      }
      showToast(`Imported font "${familyName}"`);
    } catch {
      showToast('Failed to load font file. Please select a valid .ttf or .otf file.');
    }
  };

  return (
    <div className="app-shell">
      <TopToolbar
        canUndo={past.length > 0}
        canRedo={future.length > 0}
        snap={project.canvas.snap}
        zoom={camera.zoom}
        isExporting={isExporting}
        snapshotterState={snapshotterState}
        snapshotterOverlayActive={Boolean(snapshotterStatus?.overlay_active)}
        snapshotterPopoverOpen={snapshotterPopoverOpen}
        snapshotterButtonRef={snapshotterBtnRef}
        onToggleSnapshotterPopover={() => {
          setSnapshotterPopoverOpen((prev) => {
            const next = !prev;
            if (next && snapshotterState === 'disconnected') {
              void connectToSnapshotter(false);
            }
            return next;
          });
        }}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onUpdateSnap={handleUpdateSnap}
        onAddGlobalText={handleAddGlobalText}
        onAddExternalImages={handleAddExternalImages}
        onZoomStep={handleZoomStep}
        onZoomReset={handleZoomReset}
        onZoomFit={handleZoomFit}
        onSaveProject={handleSaveProject}
        onLoadProjectFile={handleLoadProjectFile}
        onExportPng={handleExportPng}
      />

      <div className="workspace-body">
        <LeftFileBrowser
          folderSources={folderSourceSummaries}
          isScanning={isScanning}
          assets={allFolderAssets}
          onAddFolder={handleAddFolder}
          onFallbackFilesSelected={handleFallbackFilesSelected}
          onRefreshSource={handleRefreshSource}
          onRemoveSource={handleRemoveSource}
          onQuickInsert={(relPath) => placeAsset(relPath)}
        />

        <CollageCanvas
          project={project}
          assetMap={assetMap}
          selectedIds={selectedIds}
          croppingImageId={croppingImageId}
          zoom={camera.zoom}
          panX={camera.panX}
          panY={camera.panY}
          onCameraChange={(panX, panY, zoom) => setCamera({ panX, panY, zoom })}
          onSelectIds={(ids) => {
            setSelectedIds(ids);
            if (croppingImageId && !ids.includes(croppingImageId)) {
              setCroppingImageId(null);
            }
          }}
          onUpdateItems={handleUpdateItems}
          onDropAsset={placeAsset}
          onExitCropMode={() => setCroppingImageId(null)}
          onViewportSizeChange={(width, height) => {
            viewportSizeRef.current = { width, height };
          }}
          onDoubleClickText={() => {
            window.setTimeout(() => textInputRef.current?.focus(), 20);
          }}
        />

        <RightInspector
          canvasSettings={project.canvas}
          items={project.items}
          selectedIds={selectedIds}
          assets={allFolderAssets}
          assetMap={assetMap}
          missingImages={missingImages}
          customFonts={customFonts}
          detectedCk3Fonts={detectedCk3Fonts}
          croppingImageId={croppingImageId}
          textInputRef={textInputRef}
          onUpdateCanvas={handleUpdateCanvas}
          onSelectIds={setSelectedIds}
          onUpdateSelectedImages={handleUpdateSelectedImages}
          onUpdateSelectedTexts={handleUpdateSelectedTexts}
          onDeleteIds={handleDeleteIds}
          onMoveZOrder={handleMoveZOrder}
          onToggleCropMode={(id) =>
            setCroppingImageId((cur) => (cur === id ? null : id))
          }
          onReplaceImageSource={handleReplaceImageSource}
          onAutoRelinkMissing={handleAutoRelinkMissing}
          onAddAttachedText={handleAddAttachedText}
          onImportFontFile={handleImportFontFile}
        />
      </div>

      <SnapshotterPopover
        open={snapshotterPopoverOpen}
        anchorRef={snapshotterBtnRef}
        connectionState={snapshotterState}
        status={snapshotterStatus}
        autoImport={autoImportSnapshots}
        autoPlace={autoPlaceSnapshots}
        onClose={() => setSnapshotterPopoverOpen(false)}
        onConnect={() => void connectToSnapshotter(true)}
        onPatchConfig={async (patch) => {
          try {
            const res = await patchSnapshotterConfig(patch, DEFAULT_BRIDGE_BASE_URL);
            if (res.ok && res.status) {
              setSnapshotterStatus(res.status);
              return null;
            }
            return res.error || 'Could not update setting.';
          } catch {
            return 'Lost connection to Character Snapshotter.';
          }
        }}
        onTrigger={async (action) => {
          try {
            const res = await triggerSnapshotter(action, DEFAULT_BRIDGE_BASE_URL);
            if (res.ok) {
              if (res.status) setSnapshotterStatus(res.status);
              return null;
            }
            return res.error || 'Could not trigger Character Snapshotter.';
          } catch {
            return 'Lost connection to Character Snapshotter.';
          }
        }}
        onBrowseFolder={async () => {
          try {
            await browseSnapshotterFolder(DEFAULT_BRIDGE_BASE_URL);
          } catch {
            showToast('Could not open desktop folder picker.');
          }
        }}
        onOpenFolder={async () => {
          try {
            await openSnapshotterFolder(DEFAULT_BRIDGE_BASE_URL);
          } catch {
            showToast('Could not open snapshot folder.');
          }
        }}
        onOpenSettings={async () => {
          try {
            await openSnapshotterSettings(DEFAULT_BRIDGE_BASE_URL);
          } catch {
            showToast('Could not open desktop settings dialog.');
          }
        }}
        onChangeAutoImport={setAutoImportSnapshots}
        onChangeAutoPlace={setAutoPlaceSnapshots}
      />

      {toast && <div className="toast-banner">{toast}</div>}
    </div>
  );
};

export default App;
