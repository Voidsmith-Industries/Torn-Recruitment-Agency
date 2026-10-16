'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'R4G3RUNN3R-Recruitment-Agency.user.js');
const DIST_DIR = path.join(ROOT, 'dist');
const DIST = path.join(DIST_DIR, 'recruitment-agency.user.js');

const wrapper = fs.readFileSync(SOURCE, 'utf8');
const headerMatch = wrapper.match(/^(\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==)\s*\n([\s\S]*)$/);
if (!headerMatch) throw new Error('Userscript metadata block is missing or malformed.');

const header = headerMatch[1];
const bootstrap = headerMatch[2].trimStart();
const runtimeSource = fs.readFileSync(path.join(ROOT, 'src', 'v45-app.js'), 'utf8');
const runtimeVersion = runtimeSource.match(/\bconst SCRIPT_VERSION\s*=\s*'([^']+)'/);
const installerVersion = bootstrap.match(/\bconst INSTALLER_VERSION\s*=\s*'([^']+)'/);
if (!runtimeVersion || !installerVersion || runtimeVersion[1] !== installerVersion[1]) {
  throw new Error('Bundled runtime and installer versions do not match.');
}
if (!/\bconst EXPECTED_APP_VERSION\s*=\s*'[^']+';/.test(bootstrap)) {
  throw new Error('Userscript runtime version guard is missing.');
}
const bundledBootstrap = bootstrap.replace(
  /\bconst EXPECTED_APP_VERSION\s*=\s*'[^']+';/,
  `const EXPECTED_APP_VERSION = '${runtimeVersion[1]}';`
);
const requireUrls = [...header.matchAll(/^\/\/ @require\s+(\S+)\s*$/gm)].map(match => match[1]);
if (!requireUrls.length) throw new Error('No runtime modules were declared in the userscript wrapper.');

const moduleFiles = requireUrls.map(url => {
  const parsed = new URL(url);
  const name = path.posix.basename(parsed.pathname);
  const file = path.join(ROOT, 'src', name);
  if (!fs.existsSync(file)) throw new Error(`Declared runtime module is missing locally: ${name}`);
  return { name, file };
});

const bundledHeader = header
  .split('\n')
  .filter(line => !line.startsWith('// @require'))
  .join('\n');

const modules = moduleFiles.map(({ name, file }) => {
  const source = fs.readFileSync(file, 'utf8').trim();
  return `\n/* bundled runtime: ${name} */\n${source}\n`;
}).join('');

const output = `${bundledHeader}\n\n${modules}\n/* userscript bootstrap */\n${bundledBootstrap.trim()}\n`;
fs.mkdirSync(DIST_DIR, { recursive: true });
fs.writeFileSync(DIST, output, 'utf8');

const remoteRequires = output.match(/^\/\/ @require\s+/gm) || [];
if (remoteRequires.length) throw new Error('Bundled release still contains remote @require directives.');

process.stdout.write(`${DIST}\n`);
