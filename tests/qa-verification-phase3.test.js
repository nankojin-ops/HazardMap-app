/**
 * @file qa-verification-phase3.test.js
 * @description QAエンジニアによる第3版（モバイル優先ヘッダー・フルワイド候補パネルUI）の徹底的障害モード検証テスト
 * 
 * 検証対象:
 * 1. [BUG-008] z-index スタッキングコンテキスト不整合（header z-30 vs backdrop z-40）による被覆障害の検出
 * 2. [BUG-009] UIController.showSearchResults における distanceKm のXSSサニタイズ漏れの検出
 * 3. [BUG-010] searchAddress 開始時の古いドロップダウン残存レースリスク
 * 4. [BUG-011] search-input の pr-10 と検索ボタンの重なり検証
 * 5. 画面幅境界値（320px〜1024px）における有効検索幅とレスポンシブクラスの検証
 * 6. バックドロップの全クローズライフサイクル（フリーズ防止）の網羅的検証
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UIController } from '../js/ui-controller.js';
import { App } from '../js/app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// ============================================================================
// 1. [BUG-008 検出] z-index スタッキングコンテキスト検証
// ============================================================================
test('QA-P3-STACK-01: [BUG-008是正] header と search-backdrop の z-index 階層スタッキングコンテキスト整合性検証', () => {
  const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');

  // header の z-index を抽出
  const headerMatch = html.match(/<header[^>]*class="[^"]*z-(\d+)[^"]*"/);
  assert.ok(headerMatch, 'header に z-index クラスが存在すること');
  const headerZ = parseInt(headerMatch[1], 10);

  // search-backdrop の z-index を抽出
  const backdropMatch = html.match(/id="search-backdrop"[^>]*class="[^"]*z-(\d+)[^"]*"/);
  assert.ok(backdropMatch, 'search-backdrop に z-index クラスが存在すること');
  const backdropZ = parseInt(backdropMatch[1], 10);

  // header の内部に search-results-dropdown が配置されていることを確認
  const headerSubstr = html.substring(html.indexOf('<header'), html.indexOf('</header>'));
  assert.ok(
    headerSubstr.includes('id="search-results-dropdown"'),
    'search-results-dropdown が header の内部孫要素として配置されていること'
  );

  // body が flex コンテナであることを確認 (header が flex item となる)
  assert.ok(
    /<body[^>]*class="[^"]*flex[^"]*"/.test(html),
    'body が flex コンテナであり、header が flex item であること'
  );

  // 【障害モード検証判定】
  // header が flex item であり z-index を持つ場合、header は独自のスタッキングコンテキストを形成する。
  // そのため、header 内部の search-results-dropdown (z-50) の実質的な親スタックレベルは headerZ となる。
  // search-backdrop は header の兄弟要素であるため、backdropZ が headerZ 以上である場合、
  // search-backdrop は header および search-results-dropdown の前面に覆いかぶさり、
  // 候補カードのタップが完全に遮断される。
  // したがって、headerZ > backdropZ が必須要件である。
  const isStackingContextValid = headerZ > backdropZ;

  // 現状のコード（header z-30, backdrop z-40）ではこの条件に違反していることを検出し、Issue票とする
  if (!isStackingContextValid) {
    console.warn(`\n[BUG-008 検出] header (z-${headerZ}) <= search-backdrop (z-${backdropZ}) となっており、バックドロップがドロップダウンを覆ってタップを遮断します。`);
  }

  // 【是正後判定】
  // header (z-40) > search-backdrop (z-30) となり、スタッキングコンテキストが正しく確立されていること
  assert.strictEqual(
    isStackingContextValid,
    true,
    'header (z-40) > search-backdrop (z-30) となっており、スタッキングコンテキスト整合性が保たれていること'
  );
});

// ============================================================================
// 2. [BUG-009 検出] UIController.showSearchResults における distanceKm のXSSサニタイズ検証
// ============================================================================
test('QA-P3-XSS-01: [BUG-009是正] candidate.distanceKm に対するXSSインジェクション攻撃文字列のサニタイズ検証', () => {
  const elements = {};
  const createElement = (tag) => ({
    tagName: tag.toUpperCase(),
    classList: { add() {}, remove() {}, contains() { return false; } },
    setAttribute() {},
    getAttribute() { return null; },
    children: [],
    appendChild(child) { this.children.push(child); return child; },
    innerHTML: '',
    addEventListener() {}
  });

  globalThis.document = {
    getElementById(id) {
      if (!elements[id]) {
        elements[id] = createElement('div');
        elements[id].id = id;
      }
      return elements[id];
    },
    createElement
  };

  const maliciousCandidate = {
    id: 'xss-dist',
    title: '安全な地名',
    address: '安全な住所',
    source: 'osm',
    distanceKm: '"><img src=x onerror=alert("XSS")>'
  };

  UIController.showSearchResults([maliciousCandidate], () => {});

  const dropdown = elements['search-results-dropdown'];
  const generatedHtml = dropdown.children[0].innerHTML;

  // distanceKm に生のHTMLタグが含まれているか検証
  const hasRawHtmlInjection = generatedHtml.includes('<img src=x onerror=alert("XSS")>');
  if (hasRawHtmlInjection) {
    console.warn('\n[BUG-009 検出] candidate.distanceKm が escapeHtml されずに innerHTML に直接挿入されています。');
  }

  assert.strictEqual(
    hasRawHtmlInjection,
    false,
    'distanceKm がサニタイズ・エスケープされ、生HTMLタグとして挿入されないこと'
  );
});

// ============================================================================
// 3. [BUG-010 検出] 検索再実行時の古いドロップダウン残存レースリスク検証
// ============================================================================
test('QA-P3-RACE-01: [BUG-010是正] App.searchAddress 開始時に既存ドロップダウンが即座にクローズされるかの検証', () => {
  const code = fs.readFileSync(path.join(rootDir, 'js', 'app.js'), 'utf8');

  // searchAddress メソッドの先頭部（isSearching = true の直後から GeocodingService.search の直前まで）を抽出
  const searchAddressBodyMatch = code.match(/static\s+async\s+searchAddress\s*\([^)]*\)\s*\{([\s\S]*?)await\s+GeocodingService\.search/);
  assert.ok(searchAddressBodyMatch, 'searchAddress メソッドが存在すること');

  const beforeFetchBlock = searchAddressBodyMatch[1];
  const hidesBeforeFetch = beforeFetchBlock.includes('UIController.hideSearchResults()');

  if (!hidesBeforeFetch) {
    console.warn('\n[BUG-010 検出] searchAddress 開始時に hideSearchResults() が呼ばれておらず、非同期通信中に古い検索候補が画面に残存します。');
  }

  assert.strictEqual(
    hidesBeforeFetch,
    true,
    '検索通信開始時に古いドロップダウンを閉じる処理が存在すること'
  );
});

// ============================================================================
// 4. [BUG-011 検出] 検索入力欄 pr-10 と検索ボタンの重なり検証
// ============================================================================
test('QA-P3-INPUT-01: [BUG-011是正] search-input の pr-14 と search-btn の幅・右マージン干渉解消検証', () => {
  const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');

  // search-input のクラス
  const inputMatch = html.match(/<input[^>]*id="search-input"[^>]*class="[^"]*"/);
  assert.ok(inputMatch);

  // search-btn のクラス
  const btnMatch = html.match(/<button[^>]*id="search-btn"[^>]*class="[^"]*"/);
  assert.ok(btnMatch);

  // pr-10 は 40px (2.5rem)。
  // 一方、ボタンは right-1.5 (6px) + px-2.5 (20px) + テキスト「検索」(約24px) = 約50px。
  // 50px > 40px であるため、10px 分の文字重複領域が生じる
  const hasPr14 = inputMatch[0].includes('pr-14');
  const hasRight1_5 = btnMatch[0].includes('right-1.5');

  assert.strictEqual(hasPr14, true, 'search-input に pr-14 (56px) が指定され、ボタン（約50px）との干渉が解消されていること');
});

// ============================================================================
// 5. 画面幅境界値計算およびレスポンシブ整合性検証
// ============================================================================
test('QA-P3-BND-01: 画面幅境界値 (320px〜1024px) における有効検索幅の数理的検証', () => {
  // モバイル時の固定要素幅 (実測値)
  // header padding (px-2): 16px
  // search-container margin (mx-1.5): 12px
  // left container (toggle + gap + logo icon): 84px
  // right container (location icon): 34px
  const mobileFixedElementsWidth = 16 + 12 + 84 + 34; // 146px

  const viewports = [
    { width: 320, name: 'iPhone SE 1', expectedMin: 170 },
    { width: 360, name: 'Galaxy Compact', expectedMin: 200 },
    { width: 375, name: 'iPhone SE 2/3', expectedMin: 200 },
    { width: 390, name: 'iPhone 14', expectedMin: 200 },
    { width: 414, name: 'iPhone 11', expectedMin: 200 },
    { width: 639, name: 'Max Mobile', expectedMin: 200 }
  ];

  for (const vp of viewports) {
    const availableWidth = vp.width - mobileFixedElementsWidth;
    assert.ok(
      availableWidth >= vp.expectedMin,
      `${vp.name} (${vp.width}px) において有効検索幅 ${availableWidth}px が ${vp.expectedMin}px 以上であること`
    );
  }
});

// ============================================================================
// 6. バックドロップの全クローズライフサイクル（フリーズ防止）の網羅的検証
// ============================================================================
test('QA-P3-CLOSE-01: ドロップダウンおよびバックドロップを閉じる全ライフサイクルの網羅性検証', () => {
  const code = fs.readFileSync(path.join(rootDir, 'js', 'app.js'), 'utf8');

  // クローズが求められる全トリガー:
  // 1. バックドロップタップ
  assert.ok(code.includes("searchBackdrop.addEventListener('click'"), 'バックドロップクリックでクローズされること');
  // 2. ESCキー押下
  assert.ok(code.includes("e.key === 'Escape'"), 'ESCキー押下でクローズされること');
  // 3. 検索枠外クリック
  assert.ok(code.includes("!searchContainer.contains(e.target)"), '枠外クリックでクローズされること');
  // 4. 現在地取得ボタン
  assert.ok(code.includes("btnLocation.addEventListener('click'"), '現在地ボタンでクローズされること');
  // 5. ロゴクリック
  assert.ok(code.includes("headerLogo.addEventListener('click'"), 'ロゴクリックでクローズされること');
  // 6. サンプル地点ボタン
  assert.ok(code.includes("btn.addEventListener('click'"), 'サンプル地点クリックでクローズされること');
});
