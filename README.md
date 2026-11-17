# Character Collager

An interactive visual collage editor for browsing local portrait folders, snapping and layering images with pixel-accurate margins, adding borders and styled text overlays, and exporting full-resolution `.png` collages directly in the browser.

## Features

- **Multi-Folder Portrait Browser:** Add multiple local directories at once (100% client-side; images stay on your machine), browse nested folders in a collapsible tree or flat grid, filter by name/folder, and hide unused subfolders.
- **Interactive Canvas & Snapping:** Drag portraits onto the canvas with smooth pan/zoom, magnetic edge/corner/center snapping (hold `Alt` to bypass for overlaps), multi-selection, and non-destructive cropping.
- **External Image Insertion:** Add standalone images from anywhere on your computer using **`+ Image`**.
- **Borders & Text Overlays:** Per-image colored borders (inset or outside) with keyline options, image-attached labels that move and layer with their portrait, collage-global titles/captions, bundled open-source medieval/UI fonts, and `.ttf`/`.otf` custom font import.
- **Save, Reopen & Export:** Save/load editable `.collage.json` project files with automatic missing-file relinking, plus 1:1 lossless `.png` export.

## Local Development

```bash
npm install
npm run dev
```

Build the static bundle (`dist/`) for hosting (e.g., GitHub Pages):

```bash
npm run build
```
