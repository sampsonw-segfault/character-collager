import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

interface Ck3FontFaceSpec {
  family: string;
  label: string;
  weight: string;
  style: string;
  rel: string;
}

const CK3_LOCAL_FONT_FACES: Ck3FontFaceSpec[] = [
  {
    family: 'Gitan Latin',
    label: 'Gitan Latin (CK3 UI)',
    weight: '400',
    style: 'normal',
    rel: 'Gitan/GitanLatin-Regular.otf',
  },
  {
    family: 'Gitan Latin',
    label: 'Gitan Latin (CK3 UI)',
    weight: '700',
    style: 'normal',
    rel: 'Gitan/GitanLatin-Bold.otf',
  },
  {
    family: 'Gitan Latin',
    label: 'Gitan Latin (CK3 UI)',
    weight: '400',
    style: 'italic',
    rel: 'Gitan/GitanLatin-Italic.otf',
  },
  {
    family: 'Gitan Latin',
    label: 'Gitan Latin (CK3 UI)',
    weight: '700',
    style: 'italic',
    rel: 'Gitan/GitanLatin-Bold-Italic.otf',
  },
  {
    family: 'Paradox King Script',
    label: 'Paradox King Script (CK3 MapFont)',
    weight: '400',
    style: 'normal',
    rel: 'mapfont/Paradox_King_Script.otf',
  },
];

function findLocalCk3FontsDir(): string | null {
  const candidates = [
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
    'C:\\SteamLibrary',
    'D:\\SteamLibrary',
    'E:\\SteamLibrary',
    'F:\\SteamLibrary',
    'G:\\SteamLibrary',
  ];
  for (const base of candidates) {
    const dir = path.join(base, 'steamapps', 'common', 'Crusader Kings III', 'game', 'fonts');
    if (fs.existsSync(dir)) {
      return dir;
    }
  }
  return null;
}

function ck3LocalFontsPlugin(): Plugin {
  return {
    name: 'ck3-local-fonts',
    configureServer(server) {
      server.middlewares.use('/__ck3_local_fonts', (req, res, next) => {
        const parsed = new URL(req.url || '/', 'http://localhost');
        const fontsDir = findLocalCk3FontsDir();

        if (parsed.pathname === '/manifest.json') {
          if (!fontsDir) {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ found: false, families: [], faces: [] }));
            return;
          }

          const availableFaces = CK3_LOCAL_FONT_FACES.filter((face) =>
            fs.existsSync(path.join(fontsDir, face.rel))
          );
          const seenFamilies = new Set<string>();
          const families: Array<{ family: string; label: string }> = [];
          for (const face of availableFaces) {
            if (!seenFamilies.has(face.family)) {
              seenFamilies.add(face.family);
              families.push({ family: face.family, label: face.label });
            }
          }

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ found: availableFaces.length > 0, families, faces: availableFaces }));
          return;
        }

        if (parsed.pathname === '/file') {
          if (!fontsDir) {
            res.statusCode = 404;
            res.end('CK3 fonts directory not found');
            return;
          }
          const rel = parsed.searchParams.get('rel') || '';
          const match = CK3_LOCAL_FONT_FACES.find((face) => face.rel === rel);
          if (!match) {
            res.statusCode = 403;
            res.end('Font path not allowed');
            return;
          }
          const fullPath = path.join(fontsDir, match.rel);
          if (!fs.existsSync(fullPath)) {
            res.statusCode = 404;
            res.end('Font file not found');
            return;
          }
          const stat = fs.statSync(fullPath);
          res.setHeader('Content-Type', 'font/otf');
          res.setHeader('Content-Length', String(stat.size));
          fs.createReadStream(fullPath).pipe(res);
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), ck3LocalFontsPlugin()],
  base: './',
});
