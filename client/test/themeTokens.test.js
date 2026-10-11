import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEME_COLORS } from '../src/utils/theme.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, '../src');
const indexHtmlPath = path.resolve(__dirname, '../index.html');
const styleCssPath = path.resolve(srcDir, 'style.css');

function getAllFiles(dir, extensions = ['.vue', '.css', '.js']) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.resolve(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      results = results.concat(getAllFiles(fullPath, extensions));
    } else if (extensions.some(ext => file.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

describe('Theme Tokens Consistency Tests', () => {
  test('Test 1: All CSS variables used across client/src are defined in style.css', () => {
    const styleContent = fs.readFileSync(styleCssPath, 'utf-8');
    const definedVars = new Set();
    const defMatches = styleContent.matchAll(/--([a-zA-Z0-9-_]+)\s*:/g);
    for (const match of defMatches) {
      definedVars.add(`--${match[1]}`);
    }

    const files = getAllFiles(srcDir);
    const missingVars = [];

    for (const filePath of files) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const varUsageMatches = content.matchAll(/var\(\s*(--[a-zA-Z0-9-_]+)/g);
      for (const match of varUsageMatches) {
        const varName = match[1];
        if (varName.endsWith('-')) {
          // 動的プレフィックス（例: var(--cat-${...})）の場合はプレフィックスで始まる定義が存在するか確認
          const hasPrefix = Array.from(definedVars).some(v => v.startsWith(varName));
          if (hasPrefix) continue;
        }
        if (!definedVars.has(varName)) {
          missingVars.push({ file: path.relative(srcDir, filePath), varName });
        }
      }
    }

    assert.equal(
      missingVars.length,
      0,
      `Undefined CSS variables found: ${JSON.stringify(missingVars, null, 2)}`
    );
  });

  test('Test 2: No raw colors in <style> blocks of App.vue and components/**/*.vue without exemption', () => {
    const vueFiles = [
      path.resolve(srcDir, 'App.vue'),
      ...getAllFiles(path.resolve(srcDir, 'components'), ['.vue'])
    ].filter(f => fs.existsSync(f));

    const colorRegex = /(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]+\)|\bwhite\b|\bblack\b)/;
    const violations = [];

    for (const file of vueFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const styleBlockMatches = content.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g);

      for (const blockMatch of styleBlockMatches) {
        const styleContent = blockMatch[1];
        const lines = styleContent.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.includes('/* theme-exempt:')) continue;
          // CSSプロパティ名 white-space は除外して色値を検査
          const sanitizedLine = line.replace(/white-space[a-zA-Z0-9-:]*/g, '');
          if (colorRegex.test(sanitizedLine)) {
            violations.push({
              file: path.relative(srcDir, file),
              lineNum: i + 1,
              code: line.trim()
            });
          }
        }
      }
    }

    assert.equal(
      violations.length,
      0,
      `Raw colors found in style blocks: ${JSON.stringify(violations, null, 2)}`
    );
  });

  test('Test 3: index.html contains theme colors matching THEME_COLORS', () => {
    const indexContent = fs.readFileSync(indexHtmlPath, 'utf-8');
    assert.ok(
      indexContent.includes(THEME_COLORS.dark),
      `index.html must contain dark theme color ${THEME_COLORS.dark}`
    );
    assert.ok(
      indexContent.includes(THEME_COLORS.light),
      `index.html must contain light theme color ${THEME_COLORS.light}`
    );
  });

  test('Test 4: No legacy alias variables in client/src', () => {
    const LEGACY_VARS = [
      '--bg-primary', '--bg-secondary', '--bg-card', '--bg-card-solid',
      '--bg-input', '--bg-hover', '--bg-dropdown', '--modal-bg',
      '--text-primary', '--text-secondary', '--text-muted',
      '--accent-color', '--accent-gradient',
      '--border-color', '--border-focus',
      '--success', '--warning', '--danger', '--info',
      '--shadow-card', '--shadow-hover', '--shadow-modal',
      '--glass-blur', '--overlay-bg',
      '--transition-fast', '--transition-normal', '--transition-bounce',
      '--font-family'
    ];

    const files = getAllFiles(srcDir);
    const violations = [];

    for (const filePath of files) {
      const content = fs.readFileSync(filePath, 'utf-8');
      for (const legacyVar of LEGACY_VARS) {
        if (content.includes(legacyVar)) {
          violations.push({
            file: path.relative(srcDir, filePath),
            legacyVar
          });
        }
      }
    }

    assert.equal(
      violations.length,
      0,
      `Legacy CSS variables found in client/src: ${JSON.stringify(violations, null, 2)}`
    );
  });
});

