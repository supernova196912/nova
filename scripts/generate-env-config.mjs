import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const envPath = resolve(root, '.env');
const outputPath = resolve(root, 'web', 'app-config.json');
const legacyKeyPath = resolve(root, 'web', 'tmdb-config.json');
const envFile = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
const readEnv = (name) => envFile.split(/\r?\n/)
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#'))
  .map(line => line.match(new RegExp(`^${name}\\s*=\\s*(.*)$`))?.[1])
  .find(Boolean)?.replace(/^['"]|['"]$/g, '').trim() || '';
const apiBaseUrl = (process.env.CINENOVA_API_BASE_URL || readEnv('CINENOVA_API_BASE_URL'))
  .trim().replace(/\/$/, '');

writeFileSync(outputPath, JSON.stringify({ apiBaseUrl }), { encoding: 'utf8' });
if (existsSync(legacyKeyPath)) rmSync(legacyKeyPath);
console.log(`Wrote public app configuration without TMDB credentials to ${outputPath}`);
