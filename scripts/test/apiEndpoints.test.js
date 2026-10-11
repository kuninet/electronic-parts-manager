const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const serverDir = path.resolve(repoRoot, 'server');
const clientSrcDir = path.resolve(repoRoot, 'client/src');
const apiDocPath = path.resolve(repoRoot, 'docs/API.md');
const partsListVuePath = path.resolve(clientSrcDir, 'components/PartsList.vue');

function getServerRoutes() {
  const serverIndex = fs.readFileSync(path.resolve(serverDir, 'index.js'), 'utf-8');
  const requireMap = new Map();
  for (const m of serverIndex.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*require\(['"]\.\/routes\/([^'"]+)['"]\)/g)) {
    requireMap.set(m[1], m[2]);
  }

  const mounts = [];
  for (const m of serverIndex.matchAll(/app\.use\(\s*['"]([^'"]+)['"]\s*,\s*require\(['"]\.\/routes\/([^'"]+)['"]\)\s*\)/g)) {
    mounts.push({ mount: m[1], routeFile: m[2] });
  }
  for (const m of serverIndex.matchAll(/app\.use\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)\s*\)/g)) {
    if (requireMap.has(m[2])) {
      mounts.push({ mount: m[1], routeFile: requireMap.get(m[2]) });
    }
  }

  const serverRoutes = [];
  for (const { mount, routeFile } of mounts) {
    const filePath = path.resolve(serverDir, 'routes', routeFile.endsWith('.js') ? routeFile : routeFile + '.js');
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const m of content.matchAll(/router\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g)) {
      const method = m[1].toUpperCase();
      const subPath = m[2];
      const fullPath = subPath === '/' ? mount : `${mount}${subPath}`;
      serverRoutes.push({ method, path: fullPath, file: routeFile });
    }
  }
  return serverRoutes;
}

function getAllFiles(dir, exts) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.resolve(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getAllFiles(fullPath, exts));
    } else {
      if (exts.some(ext => file.endsWith(ext))) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

function getClientCalls() {
  const files = getAllFiles(clientSrcDir, ['.js', '.vue']);
  const clientCalls = [];

  for (const f of files) {
    const content = fs.readFileSync(f, 'utf-8');
    const relPath = path.relative(repoRoot, f);

    const apiMatches = content.matchAll(/api\.(get|post|put|patch|delete)\(\s*(['`])([^'`]+)\2/g);
    for (const m of apiMatches) {
      const method = m[1].toUpperCase();
      let rawPath = m[3];
      const queryIdx = rawPath.indexOf('?');
      if (queryIdx !== -1) rawPath = rawPath.substring(0, queryIdx);
      let normalizedPath = rawPath.replace(/\$\{[^}]+\}/g, ':param');
      if (!normalizedPath.startsWith('/')) normalizedPath = '/' + normalizedPath;
      clientCalls.push({ method, path: `/api${normalizedPath}`, raw: m[0], file: relPath });
    }

    const fetchMatches = content.matchAll(/fetch\(\s*`\$\{apiBase\}([^`]+)`\s*,\s*\{[\s\S]*?method\s*:\s*['"](\w+)['"]/g);
    for (const m of fetchMatches) {
      let rawPath = m[1];
      const method = m[2].toUpperCase();
      const queryIdx = rawPath.indexOf('?');
      if (queryIdx !== -1) rawPath = rawPath.substring(0, queryIdx);
      let normalizedPath = rawPath.replace(/\$\{[^}]+\}/g, ':param');
      if (!normalizedPath.startsWith('/')) normalizedPath = '/' + normalizedPath;
      clientCalls.push({ method, path: `/api${normalizedPath}`, raw: m[0], file: relPath });
    }
  }
  return clientCalls;
}

function getApiDocHeadings() {
  const content = fs.readFileSync(apiDocPath, 'utf-8');
  const headings = [];
  const headingMatches = content.matchAll(/^####\s+`(GET|POST|PUT|PATCH|DELETE)\s+(\/api\/[^`\s]+)`/gm);
  for (const m of headingMatches) {
    headings.push({ method: m[1].toUpperCase(), path: m[2] });
  }
  return headings;
}

function normalizeKey(method, routePath) {
  const p = routePath.replace(/:[a-zA-Z0-9_]+/g, ':param');
  return `${method.toUpperCase()} ${p}`;
}

function routeToRegex(routePath) {
  const regexStr = '^' + routePath.replace(/:[a-zA-Z0-9_]+/g, '[^/]+') + '$';
  return new RegExp(regexStr);
}

test('Static API Endpoint Verification (A-1 ~ A-6)', async (t) => {
  const serverRoutes = getServerRoutes();
  const clientCalls = getClientCalls();

  await t.test('A-1: Extracted count meets threshold (client >= 60, server >= 50)', () => {
    assert.ok(
      clientCalls.length >= 60,
      `Expected client calls >= 60, but got ${clientCalls.length}`
    );
    assert.ok(
      serverRoutes.length >= 50,
      `Expected server routes >= 50, but got ${serverRoutes.length}`
    );
  });

  await t.test('A-2: All client API calls match existing server routes', () => {
    const unmatched = [];
    for (const call of clientCalls) {
      const match = serverRoutes.some((sr) => {
        if (sr.method !== call.method) return false;
        return routeToRegex(sr.path).test(call.path);
      });
      if (!match) {
        unmatched.push(`${call.method} ${call.path} (${call.file})`);
      }
    }
    assert.deepEqual(unmatched, [], `Unmatched client calls:\n${unmatched.join('\n')}`);
  });

  await t.test('A-3: PartsList.vue does not contain legacy bulk endpoints', () => {
    const content = fs.readFileSync(partsListVuePath, 'utf-8');
    const legacyPatterns = [
      'bulk-delete',
      'bulk-restore',
      'bulk-permanent-delete',
      'bulk-update'
    ];
    for (const pat of legacyPatterns) {
      assert.ok(
        !content.includes(pat),
        `PartsList.vue must not contain legacy endpoint: "${pat}"`
      );
    }
  });

  await t.test('A-4: All server routes are documented in docs/API.md', () => {
    const docHeadings = getApiDocHeadings();
    const docKeys = new Set(docHeadings.map((h) => normalizeKey(h.method, h.path)));
    const missingInDocs = [];

    for (const sr of serverRoutes) {
      const key = normalizeKey(sr.method, sr.path);
      if (!docKeys.has(key)) {
        missingInDocs.push(`${sr.method} ${sr.path} (${sr.file})`);
      }
    }
    assert.deepEqual(
      missingInDocs,
      [],
      `Server routes missing from docs/API.md:\n${missingInDocs.join('\n')}`
    );
  });

  await t.test('A-5: All headings in docs/API.md exist in server routes', () => {
    const docHeadings = getApiDocHeadings();
    const serverKeys = new Set(serverRoutes.map((sr) => normalizeKey(sr.method, sr.path)));
    const fictitiousHeadings = [];

    for (const dh of docHeadings) {
      const key = normalizeKey(dh.method, dh.path);
      if (!serverKeys.has(key)) {
        fictitiousHeadings.push(`${dh.method} ${dh.path}`);
      }
    }
    assert.deepEqual(
      fictitiousHeadings,
      [],
      `Fictitious routes found in docs/API.md:\n${fictitiousHeadings.join('\n')}`
    );
  });

  await t.test('A-6: No duplicate headings in docs/API.md', () => {
    const docHeadings = getApiDocHeadings();
    const seen = new Set();
    const duplicates = [];

    for (const dh of docHeadings) {
      const key = normalizeKey(dh.method, dh.path);
      if (seen.has(key)) {
        duplicates.push(key);
      }
      seen.add(key);
    }
    assert.deepEqual(
      duplicates,
      [],
      `Duplicate headings in docs/API.md:\n${duplicates.join('\n')}`
    );
  });
});
