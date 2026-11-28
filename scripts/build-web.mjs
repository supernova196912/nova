import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import CleanCSS from 'clean-css';
import { minify } from 'html-minifier-terser';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'web');
const downloadsDir = path.join(source, 'descargas');
const output = path.join(root, 'dist');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
async function copyStatic(from, to) {
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (entry.name === '.env' || entry.name.endsWith('.jks') || entry.name === 'build' || entry.name === '.gradle') continue;
    if (entry.name.toLowerCase().endsWith('.apk') && !(from === downloadsDir || from.startsWith(downloadsDir + path.sep))) continue;
    const src = path.join(from, entry.name), dest = path.join(to, entry.name);
    if (entry.isDirectory()) { await mkdir(dest, { recursive: true }); await copyStatic(src, dest); }
    else if (!['index.html', 'app.js', 'app.css', 'cinenova-mobile-tv.css'].includes(entry.name)) await cp(src, dest);
  }
}
await copyStatic(source, output);
const bundled = await build({ entryPoints: [path.join(source, 'app.js')], outfile: path.join(output, 'app.js'), bundle: true, write: false, format: 'iife', target: 'es2020', minify: true, legalComments: 'none', sourcemap: false });
await writeFile(path.join(output, 'app.js'), bundled.outputFiles[0].text);
for (const file of ['app.css', 'cinenova-mobile-tv.css']) {
  const result = new CleanCSS({ level: 2 }).minify(await readFile(path.join(source, file), 'utf8'));
  if (result.errors.length) throw new Error(`${file}: ${result.errors.join('; ')}`);
  await writeFile(path.join(output, file), result.styles);
}
const html = await minify(await readFile(path.join(source, 'index.html'), 'utf8'), { collapseWhitespace: true, removeComments: true, minifyCSS: true, minifyJS: false, removeRedundantAttributes: true, removeEmptyAttributes: true });
await writeFile(path.join(output, 'index.html'), html);
console.log('Web production build written to dist/ (no source maps).');
