import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  Grid,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { LoadedImageAsset } from '../types/collage';
import { supportsDirectoryPicker } from '../services/fileSystemAdapter';

export interface FolderSourceSummary {
  id: string;
  rootName: string;
  count: number;
  hasHandle: boolean;
}

interface FolderTreeNode {
  path: string;
  name: string;
  depth: number;
  directAssets: LoadedImageAsset[];
  children: FolderTreeNode[];
  totalCount: number;
}

function isFolderOrAncestorHidden(folderPath: string, hiddenFolders: Set<string>): boolean {
  if (!folderPath || hiddenFolders.size === 0) return false;
  if (hiddenFolders.has(folderPath)) return true;
  const parts = folderPath.split('/');
  let prefix = '';
  for (let i = 0; i < parts.length - 1; i++) {
    prefix = prefix ? `${prefix}/${parts[i]}` : parts[i];
    if (hiddenFolders.has(prefix)) return true;
  }
  return false;
}

interface LeftFileBrowserProps {
  folderSources: FolderSourceSummary[];
  isScanning: boolean;
  assets: LoadedImageAsset[];
  onAddFolder: () => void;
  onFallbackFilesSelected: (files: FileList) => void;
  onRefreshSource: (sourceId: string) => void;
  onRemoveSource: (sourceId: string) => void;
  onQuickInsert: (relativePath: string) => void;
}

export const LeftFileBrowser: React.FC<LeftFileBrowserProps> = ({
  folderSources,
  isScanning,
  assets,
  onAddFolder,
  onFallbackFilesSelected,
  onRefreshSource,
  onRemoveSource,
  onQuickInsert,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grouped' | 'flat'>('grouped');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [hiddenFolders, setHiddenFolders] = useState<Set<string>>(new Set());
  const [showHiddenFolders, setShowHiddenFolders] = useState(false);

  const dirInputRef = useRef<HTMLInputElement | null>(null);
  const seenRootsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (dirInputRef.current) {
      dirInputRef.current.setAttribute('webkitdirectory', '');
      dirInputRef.current.setAttribute('directory', '');
    }
  }, []);

  // Automatically expand newly added top-level folder sources while keeping subfolders collapsed
  useEffect(() => {
    const currentRoots = new Set(folderSources.map((s) => s.rootName));
    const newlyAdded: string[] = [];
    for (const src of folderSources) {
      if (!seenRootsRef.current.has(src.rootName)) {
        newlyAdded.push(src.rootName);
      }
    }
    seenRootsRef.current = currentRoots;

    if (newlyAdded.length > 0) {
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        for (const r of newlyAdded) next.add(r);
        return next;
      });
    }
  }, [folderSources]);

  const handleAddFolderClick = () => {
    if (supportsDirectoryPicker()) {
      onAddFolder();
    } else {
      dirInputRef.current?.click();
    }
  };

  const filteredAssets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return assets.filter((asset) => {
      const folder = asset.file.folderPath;
      if (!showHiddenFolders && isFolderOrAncestorHidden(folder, hiddenFolders)) {
        return false;
      }
      if (!q) return true;
      return (
        asset.file.fileName.toLowerCase().includes(q) ||
        asset.file.relativePath.toLowerCase().includes(q)
      );
    });
  }, [assets, searchQuery, hiddenFolders, showHiddenFolders]);

  const { topLevelNodes, topLevelPaths, allFolderPaths } = useMemo(() => {
    const nodeByPath = new Map<string, FolderTreeNode>();
    const roots: FolderTreeNode[] = [];
    const rootPaths: string[] = [];
    const paths: string[] = [];

    for (const asset of filteredAssets) {
      const segments = asset.file.folderPath.split('/').filter(Boolean);
      if (segments.length === 0) continue;

      let parentNode: FolderTreeNode | null = null;
      let curPath = '';

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        curPath = curPath ? `${curPath}/${seg}` : seg;
        let node = nodeByPath.get(curPath);
        if (!node) {
          node = {
            path: curPath,
            name: seg,
            depth: i,
            directAssets: [],
            children: [],
            totalCount: 0,
          };
          nodeByPath.set(curPath, node);
          paths.push(curPath);
          if (i === 0) {
            roots.push(node);
            rootPaths.push(curPath);
          } else if (parentNode) {
            parentNode.children.push(node);
          }
        }
        parentNode = node;
      }

      if (parentNode) {
        parentNode.directAssets.push(asset);
      }
    }

    const sourceOrder = new Map<string, number>();
    folderSources.forEach((s, idx) => sourceOrder.set(s.rootName, idx));

    roots.sort((a, b) => {
      const ia = sourceOrder.get(a.name);
      const ib = sourceOrder.get(b.name);
      if (ia !== undefined && ib !== undefined) return ia - ib;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });

    const sortAndCount = (node: FolderTreeNode): number => {
      node.children.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      );
      let total = node.directAssets.length;
      for (const child of node.children) {
        total += sortAndCount(child);
      }
      node.totalCount = total;
      return total;
    };

    for (const root of roots) {
      sortAndCount(root);
    }

    return { topLevelNodes: roots, topLevelPaths: rootPaths, allFolderPaths: paths };
  }, [filteredAssets, folderSources]);

  const isSearching = searchQuery.trim().length > 0;
  const effectiveExpanded = useMemo(
    () => (isSearching ? new Set(allFolderPaths) : expandedFolders),
    [isSearching, allFolderPaths, expandedFolders]
  );

  const toggleExpand = (folderPath: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
      return next;
    });
  };

  const toggleHideFolder = (e: React.MouseEvent, folder: string) => {
    e.stopPropagation();
    setHiddenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) {
        next.delete(folder);
      } else {
        next.add(folder);
      }
      return next;
    });
  };

  const expandAll = () => setExpandedFolders(new Set(allFolderPaths));
  const collapseAll = () => setExpandedFolders(new Set(topLevelPaths));

  const renderAssetCard = (asset: LoadedImageAsset) => {
    const { relativePath, fileName, objectUrl, naturalWidth, naturalHeight } = asset.file;
    return (
      <div
        key={relativePath}
        className="asset-card"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-collage-asset', relativePath);
          e.dataTransfer.setData('text/plain', relativePath);
          e.dataTransfer.effectAllowed = 'copy';
        }}
        onDoubleClick={() => onQuickInsert(relativePath)}
        title={`${relativePath} (${naturalWidth}×${naturalHeight}) — Drag onto canvas or double-click`}
      >
        <div className="asset-thumb-wrap">
          <img src={objectUrl} alt={fileName} loading="lazy" draggable={false} />
          <span className="asset-dim-badge">
            {naturalWidth}×{naturalHeight}
          </span>
          <button
            type="button"
            className="asset-add-btn"
            title="Add to canvas"
            onClick={(e) => {
              e.stopPropagation();
              onQuickInsert(relativePath);
            }}
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="asset-name">{fileName}</div>
      </div>
    );
  };

  const renderFolderNode = (node: FolderTreeNode) => {
    const isRoot = node.depth === 0;
    const isExpanded = effectiveExpanded.has(node.path);
    const isHidden = hiddenFolders.has(node.path);

    return (
      <div
        key={node.path}
        className={`folder-node ${isRoot ? 'is-root-folder' : ''} ${
          isHidden ? 'is-hidden-folder' : ''
        }`}
      >
        <div
          className="folder-header"
          onClick={() => toggleExpand(node.path)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') toggleExpand(node.path);
          }}
        >
          <span className="folder-chevron">
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          <span className="folder-kind-icon">
            {isExpanded ? <FolderOpen size={13} /> : <Folder size={13} />}
          </span>
          <span className="folder-name" title={node.path}>
            {node.name}
          </span>
          <span
            className="folder-count"
            title={`${node.directAssets.length} direct, ${node.totalCount} total`}
          >
            {node.totalCount}
          </span>
          {!isRoot && (
            <button
              type="button"
              className="folder-eye-btn"
              title={isHidden ? 'Unhide folder' : 'Hide folder from browser'}
              onClick={(e) => toggleHideFolder(e, node.path)}
            >
              {isHidden ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
          )}
        </div>

        {isExpanded && (
          <div className="folder-body">
            {node.directAssets.length > 0 && (
              <div className="asset-grid">{node.directAssets.map(renderAssetCard)}</div>
            )}
            {node.children.length > 0 && (
              <div className="folder-children">
                {node.children.map((child) => renderFolderNode(child))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="left-pane">
      <div className="pane-header">
        <div className="pane-title-row">
          <span className="pane-title">Portrait Browser</span>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={handleAddFolderClick}
            disabled={isScanning}
            title="Add a local folder as an image source"
          >
            <Plus size={13} />
            <span>Add Folder</span>
          </button>
        </div>

        <input
          ref={dirInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              onFallbackFilesSelected(e.target.files);
            }
            e.target.value = '';
          }}
        />

        {folderSources.length > 0 && (
          <div className="folder-sources-list">
            {folderSources.map((src) => (
              <div key={src.id} className="folder-source-row">
                <Folder size={12} className="folder-source-icon" />
                <span className="folder-source-name" title={src.rootName}>
                  {src.rootName}
                </span>
                <span className="folder-count">{src.count}</span>
                {src.hasHandle && (
                  <button
                    type="button"
                    className="folder-source-btn"
                    title={`Refresh "${src.rootName}"`}
                    onClick={() => onRefreshSource(src.id)}
                    disabled={isScanning}
                  >
                    <RefreshCw size={12} className={isScanning ? 'spin' : ''} />
                  </button>
                )}
                <button
                  type="button"
                  className="folder-source-btn danger"
                  title={`Remove "${src.rootName}" from sources (keeps images already on canvas)`}
                  onClick={() => onRemoveSource(src.id)}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="search-box">
          <Search size={14} className="search-icon" />
          <input
            type="text"
            placeholder="Filter portraits or folders..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="browser-toolbar-row">
          <div className="segmented">
            <button
              type="button"
              className={viewMode === 'grouped' ? 'active' : ''}
              onClick={() => setViewMode('grouped')}
              title="Tiered folder tree"
            >
              Folders
            </button>
            <button
              type="button"
              className={viewMode === 'flat' ? 'active' : ''}
              onClick={() => setViewMode('flat')}
              title="Flat grid across all subfolders"
            >
              <Grid size={12} /> Flat
            </button>
          </div>

          {viewMode === 'grouped' && allFolderPaths.length > topLevelPaths.length && (
            <div className="mini-links">
              <button type="button" onClick={expandAll}>
                Expand
              </button>
              <span>/</span>
              <button type="button" onClick={collapseAll}>
                Collapse
              </button>
            </div>
          )}
        </div>

        {hiddenFolders.size > 0 && (
          <div className="hidden-folders-bar">
            <span>{hiddenFolders.size} folder(s) hidden</span>
            <button
              type="button"
              className="link-btn"
              onClick={() => setShowHiddenFolders((v) => !v)}
            >
              {showHiddenFolders ? 'Hide Again' : 'Show Hidden'}
            </button>
          </div>
        )}
      </div>

      <div className="browser-scroll">
        {isScanning ? (
          <div className="empty-state">
            <RefreshCw size={22} className="spin" />
            <p>Scanning folders & reading portrait dimensions...</p>
          </div>
        ) : assets.length === 0 ? (
          <div className="empty-state">
            <FolderOpen size={28} />
            <p>
              Click <strong>+ Add Folder</strong> to load one or more local directories (such as{' '}
              <code>Grugmon</code> or <code>Stanley</code>) and drag portraits onto the canvas.
            </p>
            <p className="muted-hint">
              100% local in your browser — no images are ever uploaded.
            </p>
          </div>
        ) : filteredAssets.length === 0 ? (
          <div className="empty-state">
            <p>No portraits match your filter or all folders are hidden.</p>
          </div>
        ) : viewMode === 'flat' ? (
          <div className="asset-grid">{filteredAssets.map(renderAssetCard)}</div>
        ) : (
          <div className="folder-tree">
            {topLevelNodes.map((rootNode) => renderFolderNode(rootNode))}
          </div>
        )}
      </div>

      <div className="pane-footer">
        <span>
          {filteredAssets.length} of {assets.length} portraits shown
        </span>
      </div>
    </aside>
  );
};
