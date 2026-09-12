/**
 * OpenAPI contract checker (closure GAP 3).
 *
 * Compares the filesystem truth (route files + exported handlers) against
 * api/openapi.yaml:
 *  1. every route file + handler has a matching path + method in the YAML,
 *  2. every YAML path + method has a matching route file + handler
 *     (no ghosts, no duplicate method keys),
 *  3. every local $ref resolves to a defined component,
 *  4. no stale bearerAuth references remain (cookieAuth is the scheme).
 *
 * The YAML is parsed with format-aware regexes (2-space paths, 4-space
 * methods) matching this repo's controlled style — not a general parser.
 *
 * Usage: npm run verify:openapi
 */
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..');
const API_DIR = path.join(REPO, 'src', 'app', 'api');
const YAML_PATH = path.join(REPO, 'api', 'openapi.yaml');

const failures = [];
function fail(message) {
  failures.push(message);
  console.error(`FAIL: ${message}`);
}

function walkRoutes(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkRoutes(full));
      continue;
    }
    if (entry.name === 'route.ts') {
      out.push(full);
    }
  }
  return out;
}

function main() {
  // ── filesystem truth ──
  const expected = new Map();
  for (const file of walkRoutes(API_DIR)) {
    const source = fs.readFileSync(file, 'utf8');
    const methods = [...source.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) =>
      m[1].toLowerCase(),
    );
    let openapiPath = path.relative(API_DIR, path.dirname(file)).replaceAll(path.sep, '/');
    openapiPath = openapiPath.replace(/\[([^\]]+)\]/g, '{$1}');
    if (!openapiPath.startsWith('/')) {
      openapiPath = `/${openapiPath}`;
    }
    expected.set(openapiPath, methods);
  }

  // ── yaml model ──
  const lines = fs.readFileSync(YAML_PATH, 'utf8').split('\n');
  const documented = new Map();
  let current = null;
  for (const line of lines) {
    const pathMatch = line.match(/^  (\/v1\/\S+):\s*$/);
    if (pathMatch) {
      current = pathMatch[1];
      if (!documented.has(current)) {
        documented.set(current, []);
      }
      continue;
    }
    const methodMatch = line.match(/^    (get|post|put|patch|delete):\s*$/);
    if (methodMatch && current) {
      documented.get(current).push(methodMatch[1]);
    }
  }

  // ── 1 + 2. bidirectional comparison ──
  for (const [openapiPath, methods] of expected) {
    if (!documented.has(openapiPath)) {
      fail(`undocumented route file: ${openapiPath} [${methods.join(',')}]`);
      continue;
    }
    for (const method of methods) {
      if (!documented.get(openapiPath).includes(method)) {
        fail(`undocumented handler: ${method.toUpperCase()} ${openapiPath}`);
      }
    }
  }
  for (const [openapiPath, methods] of documented) {
    const seen = new Set();
    for (const method of methods) {
      if (seen.has(method)) {
        fail(`duplicate method key: ${method.toUpperCase()} ${openapiPath}`);
      }
      seen.add(method);
    }
    if (!expected.has(openapiPath)) {
      fail(`ghost path (no route file): ${openapiPath} [${methods.join(',')}]`);
      continue;
    }
    for (const method of methods) {
      if (!expected.get(openapiPath).includes(method)) {
        fail(`ghost handler (no export): ${method.toUpperCase()} ${openapiPath}`);
      }
    }
  }

  // ── 3. $ref resolution ──
  const yaml = lines.join('\n');
  const defined = new Set();
  const sectionFor = { schemas: null, responses: null, parameters: null };
  let section = null;
  for (const line of lines) {
    if (line === '  schemas:') {
      section = 'schemas';
      continue;
    }
    if (line === '  responses:') {
      section = 'responses';
      continue;
    }
    if (line === '  parameters:') {
      section = 'parameters';
      continue;
    }
    if (/^  \S/.test(line)) {
      section = null;
      continue;
    }
    const def = section && line.match(/^    ([A-Za-z0-9_]+):\s*$/);
    if (def) {
      defined.add(`${section}/${def[1]}`);
      sectionFor[section] = true;
    }
  }
  for (const match of yaml.matchAll(/\$ref:\s*'#\/components\/(schemas|responses|parameters)\/([A-Za-z0-9_]+)'/g)) {
    if (!defined.has(`${match[1]}/${match[2]}`)) {
      fail(`dangling $ref: #/components/${match[1]}/${match[2]}`);
    }
  }

  // ── 4. stale auth scheme ──
  if (yaml.includes('bearerAuth')) {
    fail('stale bearerAuth reference (cookieAuth is the session scheme)');
  }

  console.log(`\nroutes: ${expected.size} files, documented paths: ${documented.size}`);
  if (failures.length > 0) {
    console.error(`${failures.length} contract check(s) failed.`);
    process.exit(1);
  }
  console.log('OpenAPI contract matches the route tree.');
}

main();
