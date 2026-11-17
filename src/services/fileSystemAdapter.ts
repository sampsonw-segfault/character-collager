import { LoadedImageAsset, WorkspaceImageFile } from '../types/collage';
import { RawWorkspaceFileEntry } from './idbStorage';

export type { RawWorkspaceFileEntry };

export const DEFAULT_EXCLUDED_FOLDERS = new Set([
  'scripts',
  '__pycache__',
  '.git',
  'node_modules',
  'dist',
  'build',
  '.vite',
]);

const IMAGE_EXT_REGEX = /\.(png|jpe?g|webp|gif|bmp)$/i;

interface FSPermissionHandle extends FileSystemDirectoryHandle {
  queryPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  entries?: () => AsyncIterableIterator<[string, FileSystemHandle]>;
}

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      id?: string;
      mode?: 'read' | 'readwrite';
    }) => Promise<FileSystemDirectoryHandle>;
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: Array<{
        description?: string;
        accept: Record<string, string[]>;
      }>;
    }) => Promise<FileSystemFileHandle>;
  }
}

export function supportsDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export function loadImageElement(objectUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = objectUrl;
  });
}

export async function hydrateWorkspaceFiles(
  rawFiles: RawWorkspaceFileEntry[]
): Promise<LoadedImageAsset[]> {
  // Sort deterministically by folder path then natural filename order
  rawFiles.sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true, sensitivity: 'base' })
  );

  const BATCH_SIZE = 16;
  const assets: LoadedImageAsset[] = [];

  for (let i = 0; i < rawFiles.length; i += BATCH_SIZE) {
    const batch = rawFiles.slice(i, i + BATCH_SIZE);
    const loadedBatch = await Promise.all(
      batch.map(async (entry) => {
        const objectUrl = URL.createObjectURL(entry.file);
        try {
          const element = await loadImageElement(objectUrl);
          const workspaceFile: WorkspaceImageFile = {
            relativePath: entry.relativePath,
            folderPath: entry.folderPath,
            fileName: entry.fileName,
            file: entry.file,
            objectUrl,
            naturalWidth: element.naturalWidth,
            naturalHeight: element.naturalHeight,
          };
          return { file: workspaceFile, element };
        } catch {
          URL.revokeObjectURL(objectUrl);
          return null;
        }
      })
    );
    for (const item of loadedBatch) {
      if (item) {
        assets.push(item);
      }
    }
  }

  return assets;
}

async function walkDirectoryHandle(
  dirHandle: FileSystemDirectoryHandle,
  prefix: string,
  collector: RawWorkspaceFileEntry[]
): Promise<void> {
  const iterableHandle = dirHandle as FSPermissionHandle;
  if (!iterableHandle.entries) {
    return;
  }
  for await (const [name, handle] of iterableHandle.entries()) {
    if (handle.kind === 'directory') {
      if (DEFAULT_EXCLUDED_FOLDERS.has(name.toLowerCase())) {
        continue;
      }
      const nextPrefix = prefix ? `${prefix}/${name}` : name;
      await walkDirectoryHandle(handle as FileSystemDirectoryHandle, nextPrefix, collector);
    } else if (handle.kind === 'file' && IMAGE_EXT_REGEX.test(name)) {
      const fileHandle = handle as FileSystemFileHandle;
      const file = await fileHandle.getFile();
      const relativePath = prefix ? `${prefix}/${name}` : name;
      collector.push({
        relativePath,
        folderPath: prefix,
        fileName: name,
        file,
      });
    }
  }
}

export interface WorkspaceScanResult {
  rootName: string;
  handle: FileSystemDirectoryHandle | null;
  assets: LoadedImageAsset[];
  rawFiles: RawWorkspaceFileEntry[];
}

export async function scanDirectoryHandle(
  handle: FileSystemDirectoryHandle,
  rootNameOverride?: string
): Promise<WorkspaceScanResult> {
  const rootName = rootNameOverride || handle.name;
  const collector: RawWorkspaceFileEntry[] = [];
  await walkDirectoryHandle(handle, rootName, collector);
  const assets = await hydrateWorkspaceFiles(collector);
  return {
    rootName,
    handle,
    assets,
    rawFiles: collector,
  };
}

export async function pickWorkspaceDirectory(): Promise<WorkspaceScanResult> {
  if (!window.showDirectoryPicker) {
    throw new Error('Directory picker API is not supported in this browser.');
  }
  const handle = await window.showDirectoryPicker({ mode: 'read' });
  return scanDirectoryHandle(handle);
}

export async function tryAutoReconnectDirectoryHandle(
  handle: FileSystemDirectoryHandle,
  rootNameOverride?: string
): Promise<WorkspaceScanResult | null> {
  try {
    const permHandle = handle as FSPermissionHandle;
    if (permHandle.queryPermission) {
      const state = await permHandle.queryPermission({ mode: 'read' });
      if (state !== 'granted') {
        return null;
      }
    }
    return await scanDirectoryHandle(handle, rootNameOverride);
  } catch {
    return null;
  }
}

export async function reconnectDirectoryHandle(
  handle: FileSystemDirectoryHandle,
  rootNameOverride?: string
): Promise<WorkspaceScanResult> {
  const permHandle = handle as FSPermissionHandle;
  if (permHandle.queryPermission) {
    const state = await permHandle.queryPermission({ mode: 'read' });
    if (state !== 'granted' && permHandle.requestPermission) {
      const requested = await permHandle.requestPermission({ mode: 'read' });
      if (requested !== 'granted') {
        throw new Error('Folder read permission was denied.');
      }
    }
  }
  return scanDirectoryHandle(handle, rootNameOverride);
}

export async function scanFileList(
  fileList: FileList | File[],
  existingNames?: Set<string>
): Promise<WorkspaceScanResult> {
  const files = Array.from(fileList);
  let detectedRoot = 'Selected Folder';
  for (const file of files) {
    if (!IMAGE_EXT_REGEX.test(file.name)) continue;
    const rawRel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const parts = rawRel.split('/').filter(Boolean);
    if (parts.length > 1) {
      detectedRoot = parts[0];
      break;
    }
  }

  let rootName = detectedRoot;
  if (existingNames && existingNames.has(rootName)) {
    let idx = 2;
    while (existingNames.has(`${detectedRoot} (${idx})`)) {
      idx++;
    }
    rootName = `${detectedRoot} (${idx})`;
  }

  const collector: RawWorkspaceFileEntry[] = [];
  for (const file of files) {
    if (!IMAGE_EXT_REGEX.test(file.name)) {
      continue;
    }
    const rawRel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const parts = rawRel.split('/').filter(Boolean);
    const innerParts = parts.length > 1 ? parts.slice(1) : parts;
    // Skip files inside excluded folders
    if (innerParts.slice(0, -1).some((seg) => DEFAULT_EXCLUDED_FOLDERS.has(seg.toLowerCase()))) {
      continue;
    }
    const innerRel = innerParts.join('/');
    const innerFolder = innerParts.slice(0, -1).join('/');
    const relativePath = `${rootName}/${innerRel}`;
    const folderPath = innerFolder ? `${rootName}/${innerFolder}` : rootName;
    collector.push({
      relativePath,
      folderPath,
      fileName: file.name,
      file,
    });
  }

  const assets = await hydrateWorkspaceFiles(collector);
  return {
    rootName,
    handle: null,
    assets,
    rawFiles: collector,
  };
}
