import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const APP = join(ROOT, 'app');
const DEST = join(ROOT, 'Matiz.html');

const IMPORT_RE = /^[ \t]*import\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2[ \t]*;?[ \t]*$/gm;
const EXPORT_RE = /^([ \t]*)export\s+(?=(?:async\s+)?(?:function\b|class\b|const\b|let\b|var\b))/gm;
const EXPORTED_NAME = /^[ \t]*export\s+(?:async\s+)?(?:function\s*\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST = /^[ \t]*export\s*\{([^}]*)\}\s*;?[ \t]*$/gm;
const UNSUPPORTED = /^[ \t]*(?:import\b(?!\s*\()|export\b)|\bimport\s*\(|\bimport\.meta\b/m;

const lf = (text) => text.replace(/\r\n?/g, '\n');
const read = (path, encoding = 'utf8') => readFile(join(APP, path), encoding);
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('base64');

function resolveImport(origin, specifier) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) throw new Error(`${origin}: only relative imports are accepted (found "${specifier}").`);
  const target = posix.normalize(posix.join(posix.dirname(origin), specifier));
  if (target.startsWith('..')) throw new Error(`${origin}: "${specifier}" leaves the app folder.`);
  return target;
}

function transform(id, code) {
  const dependencies = [];
  const names = [...code.matchAll(EXPORTED_NAME)].map((m) => m[1]);
  let body = code.replace(EXPORT_LIST, (_, list) => {
    for (const part of list.split(',').map((p) => p.trim()).filter(Boolean)) {
      const [original, alias] = part.split(/\s+as\s+/);
      names.push(alias ? `${alias}: ${original}` : original);
    }
    return '';
  });
  body = body.replace(IMPORT_RE, (_, list, _quotes, specifier) => {
    const target = resolveImport(id, specifier);
    dependencies.push(target);
    const fields = list
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [original, alias] = part.split(/\s+as\s+/);
        return alias ? `${original}: ${alias}` : original;
      });
    return `const { ${fields.join(', ')} } = modules[${JSON.stringify(target)}];`;
  });
  body = body.replace(EXPORT_RE, '$1');
  const leftover = body.match(UNSUPPORTED);
  if (leftover) throw new Error(`${id}: unsupported module form: "${leftover[0].trim()}".`);
  return { dependencies, source: `modules[${JSON.stringify(id)}] = (() => {\n${body.trimEnd()}\nreturn { ${names.join(', ')} };\n})();\n` };
}

async function pack(entry) {
  const modules = new Map();
  const order = [];
  const visiting = [];
  async function visit(id) {
    if (modules.has(id)) return;
    if (visiting.includes(id)) throw new Error(`Circular import: ${[...visiting.slice(visiting.indexOf(id)), id].join(' -> ')}`);
    visiting.push(id);
    const { dependencies, source } = transform(id, lf(await read(id)));
    for (const dependency of dependencies) await visit(dependency);
    visiting.pop();
    modules.set(id, source);
    order.push(id);
  }
  await visit(entry);
  const script = `\n(() => {\n'use strict';\nconst modules = Object.create(null);\n\n${order.map((id) => modules.get(id)).join('\n')}})();\n`;
  return { script: script.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--'), count: order.length };
}

function policy(hashes) {
  return [
    "default-src 'none'",
    `script-src ${hashes.map((h) => `'sha256-${h}'`).join(' ')}`,
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'media-src blob: mediastream:',
    "connect-src 'none'",
    "frame-src 'self' about:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

function apply(html, replacements, file) {
  let output = html;
  for (const [pattern, replacement] of replacements) {
    if (!pattern.test(output)) throw new Error(`${file} changed and the generator did not find: ${pattern}`);
    output = output.replace(pattern, replacement);
  }
  return output;
}

export async function generate() {
  const [main, pixelHtml, theme, editor, paintCss, icon] = await Promise.all([
    read('index.html').then(lf),
    read('pixel/index.html').then(lf),
    read('css/theme.css').then(lf),
    read('css/editor.css').then(lf),
    read('css/paint.css').then(lf),
    read('img/favicon.svg', null),
  ]);
  const pixel = await pack('pixel/js/main.js');
  const paint = await pack('js/main.js');
  const hashes = [sha256(paint.script), sha256(pixel.script)];
  const favicon = `data:image/svg+xml;base64,${icon.toString('base64')}`;
  const style = (...sheets) => () => `<style>\n${sheets.map((s) => s.trimEnd()).join('\n\n')}\n    </style>`;

  const pixelPage = apply(
    pixelHtml,
    [
      [/[ \t]*<base href="\.\/">\n/, ''],
      [/<link rel="icon" href="\.\.\/img\/favicon\.svg" type="image\/svg\+xml">/, `<link rel="icon" href="${favicon}" type="image/svg+xml">`],
      [/[ \t]*<link rel="stylesheet" href="\.\.\/css\/theme\.css">\n/, ''],
      [/<link rel="stylesheet" href="\.\.\/css\/editor\.css">/, style(theme, editor)],
      [/[ \t]*<script type="module" src="js\/main\.js"><\/script>\n/, ''],
      [/<meta charset="utf-8">/, `<meta charset="utf-8">\n    <meta http-equiv="Content-Security-Policy" content="${policy(hashes)}">`],
      [/<\/body>/, () => `  <script>${pixel.script}</script>\n  </body>`],
    ],
    'pixel/index.html',
  );

  const embedded = Buffer.from(pixelPage, 'utf8').toString('base64');
  return apply(
    main,
    [
      [/[ \t]*<base href="\.\/">\n/, ''],
      [/<link rel="icon" href="img\/favicon\.svg" type="image\/svg\+xml">/, `<link rel="icon" href="${favicon}" type="image/svg+xml">`],
      [/[ \t]*<link rel="stylesheet" href="css\/theme\.css">\n/, ''],
      [/[ \t]*<link rel="stylesheet" href="css\/editor\.css">\n/, ''],
      [/<link rel="stylesheet" href="css\/paint\.css">/, style(theme, editor, paintCss)],
      [/[ \t]*<script type="module" src="js\/main\.js"><\/script>\n/, ''],
      [/<meta charset="utf-8">/, `<meta charset="utf-8">\n    <meta http-equiv="Content-Security-Policy" content="${policy(hashes)}">`],
      [/<\/body>/, () => `  <script type="application/octet-stream" id="pixel-source">${embedded}</script>\n    <script>${paint.script}</script>\n  </body>`],
    ],
    'index.html',
  );
}

async function main() {
  const check = process.argv.includes('--check');
  const html = await generate();
  if (check) {
    const current = await readFile(DEST, 'utf8').catch(() => '');
    if (lf(current) !== html) {
      console.error('Matiz.html is out of date with the app code. Run "npm run portable" and commit it.');
      process.exit(1);
    }
    console.log('Matiz.html is up to date with the app code.');
    return;
  }
  await writeFile(DEST, html, 'utf8');
  console.log(`Matiz.html generated (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB). Open it with a double click, no server needed.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
