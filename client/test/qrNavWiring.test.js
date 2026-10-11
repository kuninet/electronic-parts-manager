import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, '../src');

const appVuePath = path.resolve(srcDir, 'App.vue');
const mobileTabBarVuePath = path.resolve(srcDir, 'components/layout/MobileTabBar.vue');
const qrScannerVuePath = path.resolve(srcDir, 'components/QrScanner.vue');
const appTopBarVuePath = path.resolve(srcDir, 'components/layout/AppTopBar.vue');

describe('Mobile QR Navigation & Safe Area Wiring Tests (W-1 ~ W-9)', () => {
  test('W-1: App.vue defines leaveQrPage with window.location.hash = "#/"', () => {
    const content = fs.readFileSync(appVuePath, 'utf-8');
    assert.match(content, /const\s+leaveQrPage\s*=\s*\(\)\s*=>\s*\{/);
    assert.match(content, /window\.location\.hash\s*=\s*['"]#\/['"]/);
  });

  test('W-2: App.vue binds @navigate="onTabNavigate" and @more="onTabMore" on MobileTabBar', () => {
    const content = fs.readFileSync(appVuePath, 'utf-8');
    assert.match(content, /<MobileTabBar[^>]*@navigate="onTabNavigate"/);
    assert.match(content, /<MobileTabBar[^>]*@more="onTabMore"/);
  });

  test('W-3: App.vue passes :current-view="currentPage === \'qr\' ? \'qr\' : currentView" to MobileTabBar', () => {
    const content = fs.readFileSync(appVuePath, 'utf-8');
    assert.match(content, /<MobileTabBar[^>]*:current-view="currentPage\s*===\s*'qr'\s*\?\s*'qr'\s*:\s*currentView"/);
  });

  test('W-4: App.vue contains <MobileTabBar exactly once', () => {
    const content = fs.readFileSync(appVuePath, 'utf-8');
    const matches = content.match(/<MobileTabBar/g) || [];
    assert.equal(matches.length, 1, `Expected exactly 1 occurrence of <MobileTabBar, found ${matches.length}`);
  });

  test('W-5: MobileTabBar.vue qr link has active class and aria-current using currentView === "qr"', () => {
    const content = fs.readFileSync(mobileTabBarVuePath, 'utf-8');
    const qrLinkMatch = content.match(/<a[^>]*href="#\/qr"[^>]*>[\s\S]*?<\/a>/);
    assert.ok(qrLinkMatch, 'QR link <a> found in MobileTabBar.vue');
    const qrLink = qrLinkMatch[0];
    assert.match(qrLink, /:class="\{\s*active:\s*currentView\s*===\s*'qr'\s*\}"/);
    assert.match(qrLink, /:aria-current="currentView\s*===\s*'qr'\s*\?\s*'page'\s*:\s*undefined"/);
  });

  test('W-6: QrScanner.vue includes env(safe-area-inset-top) and var(--tabbar-h)', () => {
    const content = fs.readFileSync(qrScannerVuePath, 'utf-8');
    assert.match(content, /env\(\s*safe-area-inset-top\s*\)/);
    assert.match(content, /var\(\s*--tabbar-h\s*\)/);
  });

  test('W-7: QrScanner.vue does not have href="/" on btn-back and has href="#/"', () => {
    const content = fs.readFileSync(qrScannerVuePath, 'utf-8');
    assert.doesNotMatch(content, /<a[^>]*class="btn-back"[^>]*href="\/"/);
    assert.doesNotMatch(content, /<a[^>]*href="\/"[^>]*class="btn-back"/);
    assert.match(content, /<a[^>]*href="#\/"[^>]*class="btn-back"/);
  });

  test('W-8: QrScanner.vue sets disposed = true inside onUnmounted and guards with disposed || html5QrCode !== instance', () => {
    const content = fs.readFileSync(qrScannerVuePath, 'utf-8');
    assert.match(content, /let\s+disposed\s*=\s*false;/);
    assert.match(content, /disposed\s*\|\|\s*html5QrCode\s*!==\s*instance/);
    const unmountedMatch = content.match(/onUnmounted\s*\(\s*\(\)\s*=>\s*\{([\s\S]*?)\}\s*\);/);
    assert.ok(unmountedMatch, 'onUnmounted found in QrScanner.vue');
    assert.match(unmountedMatch[1], /disposed\s*=\s*true;/);
  });

  test('W-9: AppTopBar.vue .app-topbar rule includes env(safe-area-inset-top)', () => {
    const content = fs.readFileSync(appTopBarVuePath, 'utf-8');
    const topbarRuleMatch = content.match(/\.app-topbar\s*\{([^}]*)\}/);
    assert.ok(topbarRuleMatch, '.app-topbar css rule found in AppTopBar.vue');
    assert.match(topbarRuleMatch[1], /padding-top:\s*env\(\s*safe-area-inset-top\s*\);/);
  });
});
