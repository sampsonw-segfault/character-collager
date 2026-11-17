export type BorderPlacement = 'inside' | 'outside';

export interface BorderStyle {
  enabled: boolean;
  placement: BorderPlacement;
  width: number;
  color: string;
  outerKeylineWidth: number;
  outerKeylineColor: string;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DecoratorConfig {
  id: string;
  kind: string;
  enabled: boolean;
  params: Record<string, unknown>;
}

export interface ImageItem {
  id: string;
  type: 'image';
  sourcePath: string;
  fileName: string;
  x: number;
  y: number;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
  aspectLocked: boolean;
  crop: CropRect | null;
  zIndex: number;
  border: BorderStyle;
  decorators: DecoratorConfig[];
}

export type TextAlign = 'left' | 'center' | 'right';
export type TextAnchor = 'top-left' | 'center' | 'bottom-center' | 'top-center';

export interface TextItem {
  id: string;
  type: 'text';
  parentImageId: string | null;
  offsetX: number;
  offsetY: number;
  text: string;
  fontFamily: string;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  fontSize: number;
  fillColor: string;
  fillOpacity: number;
  strokeWidth: number;
  strokeColor: string;
  textAlign: TextAlign;
  anchor: TextAnchor;
  maxWidth: number | null;
  zIndex: number;
}

export type CollageItem = ImageItem | TextItem;

export interface SnapSettings {
  enabled: boolean;
  thresholdPx: number;
  gapX: number;
  gapY: number;
  gapLinked: boolean;
}

export interface CanvasSettings {
  backgroundColor: string;
  transparentBackground: boolean;
  outerMargin: number;
  boundsMode: 'auto' | 'fixed';
  width: number;
  height: number;
  snap: SnapSettings;
}

export interface CollageProject {
  version: '1.0';
  workspaceRootName: string;
  canvas: CanvasSettings;
  items: CollageItem[];
}

export interface WorkspaceImageFile {
  relativePath: string;
  folderPath: string;
  fileName: string;
  file: File;
  objectUrl: string;
  naturalWidth: number;
  naturalHeight: number;
}

export interface LoadedImageAsset {
  file: WorkspaceImageFile;
  element: HTMLImageElement;
}

export interface TextStyleTemplate {
  fontFamily: string;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  fontSize: number;
  fillColor: string;
  fillOpacity: number;
  strokeWidth: number;
  strokeColor: string;
  textAlign: TextAlign;
  anchor: TextAnchor;
  maxWidth: number | null;
}

export interface StylePreset {
  id: string;
  name: string;
  builtIn?: boolean;
  border: BorderStyle;
  textTemplate?: TextStyleTemplate;
}

export interface SnapGuide {
  axis: 'x' | 'y';
  position: number;
  start: number;
  end: number;
  kind: 'align' | 'gap';
  gapPx?: number;
  gapLabelPos?: { x: number; y: number };
}

export interface CustomFontRecord {
  id: string;
  familyName: string;
  fileName: string;
  buffer: ArrayBuffer;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
