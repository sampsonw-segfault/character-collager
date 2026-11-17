import { CollageProject, CustomFontRecord, StylePreset } from '../types/collage';

const DB_NAME = 'character-collager-db';
const DB_VERSION = 1;
const STORE_KV = 'kv';

const KEY_DIR_HANDLE = 'directoryHandle';
const KEY_AUTOSAVE = 'autosaveProject';
const KEY_PRESETS = 'customPresets';
const KEY_FONTS = 'customFonts';
const KEY_WORKSPACE_CACHE = 'workspaceCache';
const KEY_FOLDER_SOURCES = 'folderSourcesCache';
const KEY_EXTERNAL_FILES = 'externalFiles';

export interface RawWorkspaceFileEntry {
  relativePath: string;
  folderPath: string;
  fileName: string;
  file: File;
}

export interface CachedWorkspaceData {
  rootName: string;
  files: RawWorkspaceFileEntry[];
}

export interface CachedFolderSource {
  id: string;
  rootName: string;
  handle: FileSystemDirectoryHandle | null;
  files: RawWorkspaceFileEntry[];
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function kvGet<T>(key: string): Promise<T | null> {
  try {
    const db = await openDatabase();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_KV, 'readonly');
      const req = tx.objectStore(STORE_KV).get(key);
      req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function kvSet<T>(key: string, value: T): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_KV, 'readwrite');
      const req = tx.objectStore(STORE_KV).put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Gracefully ignore storage quota / private-browsing errors
  }
}

export async function saveDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await kvSet(KEY_DIR_HANDLE, handle);
}

export async function loadDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  return kvGet<FileSystemDirectoryHandle>(KEY_DIR_HANDLE);
}

export async function saveAutosaveProject(project: CollageProject): Promise<void> {
  await kvSet(KEY_AUTOSAVE, project);
}

export async function loadAutosaveProject(): Promise<CollageProject | null> {
  return kvGet<CollageProject>(KEY_AUTOSAVE);
}

export async function saveCustomPresets(presets: StylePreset[]): Promise<void> {
  await kvSet(KEY_PRESETS, presets);
}

export async function loadCustomPresets(): Promise<StylePreset[]> {
  return (await kvGet<StylePreset[]>(KEY_PRESETS)) ?? [];
}

export async function saveCustomFonts(fonts: CustomFontRecord[]): Promise<void> {
  await kvSet(KEY_FONTS, fonts);
}

export async function loadCustomFonts(): Promise<CustomFontRecord[]> {
  return (await kvGet<CustomFontRecord[]>(KEY_FONTS)) ?? [];
}

export async function saveWorkspaceCache(data: CachedWorkspaceData): Promise<void> {
  try {
    // Materialize standalone File copies so IndexedDB persists blobs across handle invalidation
    const standaloneFiles: RawWorkspaceFileEntry[] = await Promise.all(
      data.files.map(async (entry) => {
        const buf = await entry.file.arrayBuffer();
        const clonedFile = new File([buf], entry.fileName, {
          type: entry.file.type || 'image/png',
          lastModified: entry.file.lastModified,
        });
        return {
          relativePath: entry.relativePath,
          folderPath: entry.folderPath,
          fileName: entry.fileName,
          file: clonedFile,
        };
      })
    );
    await kvSet<CachedWorkspaceData>(KEY_WORKSPACE_CACHE, {
      rootName: data.rootName,
      files: standaloneFiles,
    });
  } catch {
    // Gracefully ignore storage quota or read errors
  }
}

export async function loadWorkspaceCache(): Promise<CachedWorkspaceData | null> {
  return kvGet<CachedWorkspaceData>(KEY_WORKSPACE_CACHE);
}

export async function saveFolderSourcesCache(sources: CachedFolderSource[]): Promise<void> {
  try {
    const serialized: CachedFolderSource[] = await Promise.all(
      sources.map(async (src) => ({
        id: src.id,
        rootName: src.rootName,
        handle: src.handle,
        files: await materializeEntries(src.files),
      }))
    );
    await kvSet<CachedFolderSource[]>(KEY_FOLDER_SOURCES, serialized);
  } catch {
    // Gracefully ignore storage quota or read errors
  }
}

export async function loadFolderSourcesCache(): Promise<CachedFolderSource[]> {
  return (await kvGet<CachedFolderSource[]>(KEY_FOLDER_SOURCES)) ?? [];
}

async function materializeEntries(
  files: RawWorkspaceFileEntry[]
): Promise<RawWorkspaceFileEntry[]> {
  return Promise.all(
    files.map(async (entry) => {
      const buf = await entry.file.arrayBuffer();
      const clonedFile = new File([buf], entry.fileName, {
        type: entry.file.type || 'image/png',
        lastModified: entry.file.lastModified,
      });
      return {
        relativePath: entry.relativePath,
        folderPath: entry.folderPath,
        fileName: entry.fileName,
        file: clonedFile,
      };
    })
  );
}

export async function saveExternalFilesCache(files: RawWorkspaceFileEntry[]): Promise<void> {
  try {
    const standaloneFiles = await materializeEntries(files);
    await kvSet<RawWorkspaceFileEntry[]>(KEY_EXTERNAL_FILES, standaloneFiles);
  } catch {
    // Gracefully ignore storage quota or read errors
  }
}

export async function loadExternalFilesCache(): Promise<RawWorkspaceFileEntry[]> {
  return (await kvGet<RawWorkspaceFileEntry[]>(KEY_EXTERNAL_FILES)) ?? [];
}

export async function registerCustomFontFace(record: CustomFontRecord): Promise<void> {
  // Clone buffer slice so FontFace parsing never detaches our stored ArrayBuffer
  const fontFace = new FontFace(record.familyName, record.buffer.slice(0));
  const loaded = await fontFace.load();
  document.fonts.add(loaded);
}
