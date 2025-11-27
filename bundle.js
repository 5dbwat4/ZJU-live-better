// bundle.js
import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const targetDirs = ['classroom.zju', 'courses.zju', 'webplus.zju'];
const outDir = 'dist';

const excludeFiles = [];

// Polyfill
const esmBanner = {
  js: `
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
`,
};

async function build() {
  const entryPoints = [];
  
  targetDirs.forEach(dir => {
    const dirPath = path.join(__dirname, dir);
    if (fs.existsSync(dirPath)) {
      const files = fs.readdirSync(dirPath);
      files.forEach(file => {
        if (file.endsWith('.js') && !excludeFiles.includes(file)) {
          entryPoints.push(path.join(dir, file));
        }
      });
    }
  });

  console.log(`[Build] Finding entry points:`, entryPoints);

  try {
    await esbuild.build({
      entryPoints: entryPoints,
      bundle: true,
      platform: 'node',
      target: 'es2020',
      format: 'esm',
      outdir: outDir,
      banner: esmBanner,
      keepNames: true,
      sourcemap: false,
      minify: true,
      external: [],
    });
    
    console.log(`[Success] Build completed! Files are generated in the /${outDir} directory.`);
  } catch (e) {
    console.error('[Error] Build failed:', e);
    process.exit(1);
  }
}

build();