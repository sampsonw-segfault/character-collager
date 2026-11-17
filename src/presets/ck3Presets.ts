import { BorderStyle, CollageProject, StylePreset, TextStyleTemplate } from '../types/collage';

export interface ColorSwatch {
  name: string;
  hex: string;
}

export const CK3_BACKGROUND_SWATCHES: ColorSwatch[] = [
  { name: 'CK3 Warm Umber', hex: '#181410' },
  { name: 'CK3 Keyline Dark', hex: '#120F0C' },
  { name: 'Pure Black', hex: '#000000' },
  { name: 'Parchment Light', hex: '#E8DEC8' },
  { name: 'Pure White', hex: '#FFFFFF' },
];

export const CK3_BORDER_SWATCHES: ColorSwatch[] = [
  { name: 'Royal Goldenrod', hex: '#DAA520' },
  { name: 'Metallic Silver', hex: '#C0C0C0' },
  { name: 'Spouse Slate', hex: '#8B8682' },
  { name: 'Umber-Bronze', hex: '#4A4238' },
  { name: 'CK3 Keyline', hex: '#120F0C' },
  { name: 'Imperial Crimson', hex: '#8E2424' },
  { name: 'Pure White', hex: '#FFFFFF' },
];

export const DEFAULT_BORDER_STYLE: BorderStyle = {
  enabled: false,
  placement: 'inside',
  width: 4,
  color: '#DAA520',
  outerKeylineWidth: 2,
  outerKeylineColor: '#120F0C',
};

export const DEFAULT_NAMEPLATE_TEXT_STYLE: TextStyleTemplate = {
  fontFamily: 'Fondamento',
  fontWeight: 'bold',
  fontStyle: 'normal',
  fontSize: 34,
  fillColor: '#FFFFFF',
  fillOpacity: 1,
  strokeWidth: 3,
  strokeColor: '#000000',
  textAlign: 'center',
  anchor: 'bottom-center',
  maxWidth: null,
};

export const BUILTIN_STYLE_PRESETS: StylePreset[] = [
  {
    id: 'preset-ruler-gold',
    name: 'Ruler Gold',
    builtIn: true,
    border: {
      enabled: true,
      placement: 'inside',
      width: 4,
      color: '#DAA520',
      outerKeylineWidth: 2,
      outerKeylineColor: '#120F0C',
    },
    textTemplate: { ...DEFAULT_NAMEPLATE_TEXT_STYLE },
  },
  {
    id: 'preset-spouse-silver',
    name: 'Spouse Silver',
    builtIn: true,
    border: {
      enabled: true,
      placement: 'inside',
      width: 4,
      color: '#C0C0C0',
      outerKeylineWidth: 2,
      outerKeylineColor: '#120F0C',
    },
    textTemplate: { ...DEFAULT_NAMEPLATE_TEXT_STYLE, fontSize: 30 },
  },
  {
    id: 'preset-descendant-bronze',
    name: 'Descendant Bronze',
    builtIn: true,
    border: {
      enabled: true,
      placement: 'inside',
      width: 4,
      color: '#4A4238',
      outerKeylineWidth: 2,
      outerKeylineColor: '#120F0C',
    },
    textTemplate: { ...DEFAULT_NAMEPLATE_TEXT_STYLE },
  },
  {
    id: 'preset-clean-no-border',
    name: 'Clean (No Border)',
    builtIn: true,
    border: {
      enabled: false,
      placement: 'inside',
      width: 0,
      color: '#DAA520',
      outerKeylineWidth: 0,
      outerKeylineColor: '#120F0C',
    },
  },
];

export interface FontOption {
  family: string;
  label: string;
  badge?: string;
}

export const BUILTIN_FONTS: FontOption[] = [
  { family: 'Fondamento', label: 'Fondamento (CK3 TitleFont)', badge: 'CK3' },
  { family: 'Open Sans', label: 'Open Sans (CK3 UI)', badge: 'CK3' },
  { family: 'Open Sans Condensed', label: 'Open Sans Condensed (CK3)', badge: 'CK3' },
  { family: 'MonomakhUnicode', label: 'Monomakh Unicode (CK3 Map)', badge: 'CK3' },
  { family: 'Cinzel', label: 'Cinzel (Display Serif)' },
  { family: 'EB Garamond', label: 'EB Garamond (Classic Serif)' },
  { family: 'Arial', label: 'Arial (Classic Script Font)' },
  { family: 'Impact', label: 'Impact (Bold Caption)' },
  { family: 'Georgia', label: 'Georgia (Serif)' },
];

export function createInitialProject(): CollageProject {
  return {
    version: '1.0',
    workspaceRootName: '',
    canvas: {
      backgroundColor: '#181410',
      transparentBackground: false,
      outerMargin: 20,
      boundsMode: 'auto',
      width: 2588,
      height: 2588,
      snap: {
        enabled: true,
        thresholdPx: 10,
        gapX: 12,
        gapY: 12,
        gapLinked: true,
      },
    },
    items: [],
  };
}
