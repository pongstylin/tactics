import path from 'path';
import process from 'process';
import Module from 'module';
import fs from 'fs';

const builtins = Module.builtinModules;
const JS_EXTENSIONS = new Set(['.js', '.mjs']);

const ALIASES = new Map([
  ['config',   'config'],
  ['server',   'src/server'],
  ['models',   'src/models'],
  ['data',     'src/data'],
  ['tactics',  'src/tactics'],
  ['utils',    'src/utils'],
  ['plugins',  'src/plugins'],
]);

const basePath = process.cwd();
const baseURL = new URL('file://');
baseURL.pathname = `${basePath}/`;

export function resolve(specifier, context, defaultResolve) {
  defaultResolve = defaultResolve.bind(this, specifier, context, defaultResolve);
  let parentURL = context.parentURL || baseURL.href;

  if (builtins.includes(specifier))
    return {
      url: specifier,
      format: 'builtin',
    };

  let parts = specifier.split(/\//);
  let firstPart = parts[0];
  let resolved;

  // Resolve aliased directories
  if (ALIASES.has(firstPart) && parts.length > 1) {
    let fullRelativePath = specifier.replace(firstPart, ALIASES.get(firstPart));

    resolved = new URL(fullRelativePath, baseURL);
  }
  // Make root paths relative to nodejs root.
  // Except for the entry point: src/server.js
  else if (/^\/(?:!.+\/src\/server\.js)$/.test(specifier))
    resolved = new URL(specifier.slice(1), baseURL);
  // Matches specifiers that don't look like a path (node_modules)
  else if (!/^\.{0,2}[/]/.test(specifier) && !specifier.startsWith('file:')) {
    return moduleResolve(`${basePath}/node_modules`, specifier, defaultResolve);
  }
  // Matches path specifiers called from node modules
  else if (parentURL.startsWith(`${baseURL}node_modules`)) {
    let parentModulePath = parentURL.replace(/^file:\/\/\//, '');
    return moduleResolve(parentModulePath, specifier, defaultResolve);
  }
  else
    resolved = new URL(specifier, parentURL);

  const ext = path.extname(resolved.pathname);
  let format;

  if (ext === '.json')
    format = 'json';
  else if (JS_EXTENSIONS.has(ext))
    format = 'module';
  else
    throw new Error(`Cannot load file with unsupported extension ${ext}.`);

  return {
    url: resolved.href,
    format: format,
  };
}

function moduleResolve(basePath, specifier, defaultResolve) {
  let baseSpecifierPath = path.resolve(basePath, specifier);
  let specifierPath = baseSpecifierPath;
  let exts = ['.js'];
  let ext = '';

  while (!fs.existsSync(specifierPath)) {
    if (exts.length === 0)
      throw `Unable to find '${specifier}' in node modules`;

    ext = exts.shift();
    specifierPath = baseSpecifierPath + ext;
  }

  let stats = fs.statSync(specifierPath);
  let packagePath;
  if (stats.isDirectory()) {
    packagePath = path.resolve(specifierPath, 'package.json');
    if (!fs.existsSync(packagePath))
      throw 'Unable to find package in node modules';
  }
  else {
    let parts = specifierPath.split(/[\\\/]/);
    parts.pop();

    while (!fs.existsSync(parts.join('/') + '/package.json')) {
      parts.pop();
    }

    packagePath = parts.join('/') + '/package.json';
  }

  let pkg = JSON.parse( fs.readFileSync(packagePath) );
  if ('module' in pkg || specifierPath !== baseSpecifierPath) {
    return {
      url: new URL(`node_modules/${specifier}${ext}`, baseURL).href,
      format: 'module' in pkg ? 'module' : 'commonjs',
    };
  }
  else
    return defaultResolve();
}
