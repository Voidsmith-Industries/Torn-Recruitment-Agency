'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { minify } = require('terser');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'R4G3RUNN3R-Recruitment-Agency.user.js');
const DIST_DIR = path.join(ROOT, 'dist');
const DIST = path.join(DIST_DIR, 'recruitment-agency.user.js');

const wrapper = fs.readFileSync(SOURCE, 'utf8');
const headerMatch = wrapper.match(/^(\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==)\s*\n([\s\S]*)$/);
if (!headerMatch) throw new Error('Userscript metadata block is missing or malformed.');

const header = headerMatch[1];
const bootstrap = headerMatch[2].trimStart();
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

// The shipped release is minified: whitespace/comments removed, dead code
// compressed and function-local names mangled. Top-level and global names
// (RA_* module globals, GM_* grants) and all property names are left intact,
// and the ==UserScript== metadata block is emitted byte-for-byte, unminified.
// No eval or packing. Terser is pinned exactly in package.json so the output
// is deterministic (same input -> same bytes); CI diffs a rebuild against dist.
const TERSER_OPTIONS = Object.freeze({
  ecma: 2020,
  module: false,
  toplevel: false,
  compress: { passes: 2, toplevel: false, unsafe: false },
  mangle: { toplevel: false, eval: false, properties: false },
  format: { comments: false, ascii_only: false, beautify: false, semicolons: true },
  sourceMap: false
});

async function main() {
  const body = `${modules}\n${bootstrap.trim()}\n`;
  const result = await minify(body, TERSER_OPTIONS);
  if (!result || typeof result.code !== 'string' || !result.code.length) throw new Error('Minifier produced no output.');
  const output = `${bundledHeader}\n\n${result.code}\n`;

  fs.mkdirSync(DIST_DIR, { recursive: true });
  fs.writeFileSync(DIST, output, 'utf8');

  const remoteRequires = output.match(/^\/\/ @require\s+/gm) || [];
  if (remoteRequires.length) throw new Error('Bundled release still contains remote @require directives.');
  if (!output.startsWith(`${bundledHeader}\n`)) throw new Error('Userscript metadata block was not preserved verbatim.');

  process.stdout.write(`${DIST}\n`);
}

main().catch(error => {
  process.stderr.write(`${error && error.stack || error}\n`);
  process.exitCode = 1;
});
