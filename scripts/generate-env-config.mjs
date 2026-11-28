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
const videoGatewayUrl = (process.env.CINENOVA_VIDEO_GATEWAY_URL || readEnv('CINENOVA_VIDEO_GATEWAY_URL') || 'https://vg-core.novapelis.workers.dev')
  .trim().replace(/\/$/, '');

writeFileSync(outputPath, JSON.stringify({ apiBaseUrl, videoGatewayUrl }), { encoding: 'utf8' });
if (existsSync(legacyKeyPath)) rmSync(legacyKeyPath);
console.log(`Wrote public app configuration without TMDB credentials to ${outputPath}`);
