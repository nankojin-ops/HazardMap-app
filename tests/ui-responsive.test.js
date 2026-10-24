/**
 * @file ui-responsive.test.js
 * @description モバイル優先ヘッダー情報設計（ADR-07）および
 * ビューポート基準フルワイド候補パネル・バックドロップ連動（ADR-08, AC-9.6〜AC-9.8）の検証テスト
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

// DOMモック簡易セットアップ
function setupDomMock() {
  const elements = {};

  const createElement = (tag) => {
    const el = {
      tagName: tag.toUpperCase(),
      classList: {
        _classes: new Set(),
        add(...cls) { cls.forEach(c => this._classes.add(c)); },
        remove(...cls) { cls.forEach(c => this._classes.delete(c)); },
        contains(c) { return this._classes.has(c); }
      },
      attributes: {},
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return this.attributes[k] || null; },
      children: [],
      appendChild(child) {
        this.children.push(child);
        this.innerHTML += child.innerHTML || '';
        return child;
      },
      innerHTML: '',
      textContent: '',
      style: {},
      disabled: false,
      value: '',
      addEventListener(evt, handler) {
        if (!this._handlers) this._handlers = {};
        if (!this._handlers[evt]) this._handlers[evt] = [];
        this._handlers[evt].push(handler);
      },
      dispatchEvent(evt) {
        if (this._handlers && this._handlers[evt.type]) {
          this._handlers[evt.type].forEach(h => h(evt));
        }
      },
      querySelectorAll(selector) {
        const results = [];
        const match = (node) => {
          if (selector.startsWith('.')) {
            const cls = selector.slice(1);
            if (node.classList && node.classList.contains(cls)) results.push(node);
          }
          if (node.children) {
            node.children.forEach(match);
          }
        };
        match(this);
        return results;
      }
    };
    return el;
  };

  const getElementById = (id) => {
    if (!elements[id]) {
      elements[id] = createElement('div');
      elements[id].id = id;
    }
    return elements[id];
  };

  globalThis.document = {
    getElementById,
    createElement,
    querySelectorAll(selector) {
      return [];
    },
    addEventListener(evt, handler) {
      if (!this._handlers) this._handlers = {};
      if (!this._handlers[evt]) this._handlers[evt] = [];
      this._handlers[evt].push(handler);
    },
    dispatchEvent(evt) {
      if (this._handlers && this._handlers[evt.type]) {
        this._handlers[evt.type].forEach(h => h(evt));
      }
    }
  };

  // 事前初期化
  [
    'search-results-dropdown',
    'search-backdrop',
    'search-input',
    'search-form',
    'search-btn',
    'search-spinner',
    'search-btn-text',
    'search-container',
    'btn-current-location',
    'btn-toggle-sidebar',
    'sidebar',
    'sidebar-backdrop',
    'toast-container',
    'toast-close',
    'header-logo'
  ].forEach(id => {
    getElementById(id);
  });

  return elements;
}

// ============================================================================
// 1. HTML静的構造検証: ヘッダーおよびロゴタイトルのレスポンシブクラス (AC-9.6)
// ============================================================================
test('UI-RESP-01: index.html におけるヘッダーロゴと検索コンテナのレスポンシブクラス検証 (AC-9.6)', () => {
  const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');

  // 1. ヘッダータグのパディングが px-2 sm:px-4 に最適化されていること
  assert.ok(
    html.includes('<header class="h-16 bg-white border-b border-gray-200 px-2 sm:px-4 flex items-center justify-between z-40 shadow-sm shrink-0">'),
    'ヘッダーの左右パディングがモバイルで px-2、デスクトップで px-4 に設定されていること'
  );

  // 2. アプリタイトル h1 に hidden sm:block が付与されていること
  assert.ok(
    /<h1[^>]*class="[^"]*hidden\s+sm:block[^"]*"[^>]*>防災ハザードマップ<\/h1>/.test(html),
    'ロゴタイトル「防災ハザードマップ」がモバイルで非表示 (hidden)、デスクトップで表示 (sm:block) となっていること'
  );

  // 3. 検索バーコンテナ (#search-container) のマージンが mx-1.5 sm:mx-3 に最適化されていること
  assert.ok(
    /<div[^>]*id="search-container"[^>]*class="[^"]*mx-1\.5\s+sm:mx-3[^"]*"/.test(html) ||
    /<div[^>]*class="[^"]*mx-1\.5\s+sm:mx-3[^"]*"[^>]*id="search-container"/.test(html),
    '検索コンテナのマージンがモバイルで mx-1.5、デスクトップで mx-3 に設定されていること'
  );

  // 4. 現在地取得ボタンのパディングが px-2.5 sm:px-3 に最適化されていること
  assert.ok(
    html.includes('id="btn-current-location"') && html.includes('px-2.5 sm:px-3'),
    '現在地取得ボタンのパディングがモバイルで px-2.5、デスクトップで px-3 に設定されていること'
  );
});

// ============================================================================
// 2. HTML静的構造検証: ビューポート基準フルワイドドロップダウンおよびバックドロップ (AC-9.7, AC-9.8)
// ============================================================================
test('UI-RESP-02: index.html における候補ドロップダウンとバックドロップの配置・z-index検証 (AC-9.7, AC-9.8)', () => {
  const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');

  // 1. #search-backdrop 要素の存在とクラス定義
  assert.ok(
    html.includes('id="search-backdrop"'),
    '半透明バックドロップ (#search-backdrop) が存在すること'
  );
  assert.ok(
    /<div[^>]*id="search-backdrop"[^>]*class="[^"]*fixed\s+inset-0\s+bg-black\/40\s+z-30\s+hidden\s+sm:hidden[^"]*"/.test(html),
    'バックドロップに fixed inset-0 bg-black/40 z-30 hidden sm:hidden クラスが付与されていること'
  );

  // 2. #search-results-dropdown 要素のレスポンシブクラス定義
  assert.ok(
    html.includes('id="search-results-dropdown"'),
    '候補ドロップダウン (#search-results-dropdown) が存在すること'
  );
  assert.ok(
    html.includes('fixed inset-x-2 top-[60px]'),
    'モバイル時に fixed inset-x-2 top-[60px] で全幅展開されるクラスが指定されていること'
  );
  assert.ok(
    html.includes('sm:absolute sm:inset-x-0 sm:left-0 sm:right-0 sm:top-full sm:mt-1.5'),
    'デスクトップ時に sm:absolute sm:inset-x-0 sm:top-full で検索バー直下に展開されるクラスが指定されていること'
  );
  assert.ok(
    html.includes('z-50'),
    '候補ドロップダウンが最前面 (z-50) に配置されていること'
  );
});

// ============================================================================
// 3. CSSスタイル検証: 候補アイテムのタッチターゲット高さとフィードバック
// ============================================================================
test('UI-RESP-03: css/style.css におけるタッチターゲット高さ (48px) とアクティブスタイルの検証', () => {
  const css = fs.readFileSync(path.join(rootDir, 'css', 'style.css'), 'utf8');

  // 1. .search-result-item の min-height が 48px であること (Apple HIG / WCAG)
  assert.ok(
    css.includes('min-height: 48px;'),
    '.search-result-item に min-height: 48px; が定義されていること'
  );

  // 2. .search-result-item:active の背景色定義
  assert.ok(
    css.includes('.search-result-item:active'),
    '.search-result-item:active スタイルが定義されていること'
  );

  // 3. #search-backdrop のトランジション定義
  assert.ok(
    css.includes('#search-backdrop'),
    '#search-backdrop のアニメーションスタイルが定義されていること'
  );
});

// ============================================================================
// 4. UIController連動検証: showSearchResults によるフルワイド候補2行構造描画とバックドロップ表示
// ============================================================================
test('UI-RESP-04: UIController.showSearchResults による2行構造描画とバックドロップ連動 (AC-9.7)', () => {
  const elements = setupDomMock();

  const dropdown = elements['search-results-dropdown'];
  const backdrop = elements['search-backdrop'];
  const searchInput = elements['search-input'];

  dropdown.classList.add('hidden');
  backdrop.classList.add('hidden');

  const candidates = [
    {
      id: 'c1',
      title: '新宿駅',
      address: '東京都新宿区新宿三丁目38-1',
      lat: 35.69092,
      lng: 139.70025,
      source: 'osm',
      distanceKm: 3.2
    },
    {
      id: 'c2',
      title: '東京都新宿区',
      address: '東京都新宿区歌舞伎町一丁目',
      lat: 35.69384,
      lng: 139.70354,
      source: 'gsi',
      distanceKm: 3.5
    }
  ];

  let selectedCandidate = null;
  UIController.showSearchResults(candidates, (candidate) => {
    selectedCandidate = candidate;
  });

  // 1. ドロップダウンおよびバックドロップの hidden 解除
  assert.strictEqual(dropdown.classList.contains('hidden'), false, 'ドロップダウンの hidden が解除されていること');
  assert.strictEqual(backdrop.classList.contains('hidden'), false, 'バックドロップの hidden が解除されていること');
  assert.strictEqual(searchInput.getAttribute('aria-expanded'), 'true', 'aria-expanded が true であること');

  // 2. 候補行の件数確認
  assert.strictEqual(dropdown.children.length, 2, '2件の候補行が生成されていること');

  // 3. 1件目の候補行のDOM構造・クラス検証
  const item1 = dropdown.children[0];
  assert.ok(
    item1.className.includes('min-h-[48px]'),
    '候補アイテムに min-h-[48px] クラスが付与されていること'
  );
  assert.ok(
    item1.className.includes('active:bg-blue-100'),
    '候補アイテムに active:bg-blue-100 クラスが付与されていること'
  );
  assert.ok(
    item1.className.includes('p-3.5'),
    '十分なタッチパディング p-3.5 が付与されていること'
  );

  // 4. 2行構造の検証 (1行目: バッジ+名称+距離、2行目: 詳細住所)
  assert.ok(
    item1.innerHTML.includes('OSM'),
    '1行目に提供元バッジ (OSM) が描画されていること'
  );
  assert.ok(
    item1.innerHTML.includes('新宿駅'),
    '1行目にタイトル (新宿駅) が描画されていること'
  );
  assert.ok(
    item1.innerHTML.includes('約3.2km'),
    '1行目に直線距離 (約3.2km) が描画されていること'
  );
  assert.ok(
    item1.innerHTML.includes('東京都新宿区新宿三丁目38-1'),
    '2行目に詳細住所が描画されていること'
  );
  assert.ok(
    item1.innerHTML.includes('fa-location-dot'),
    '2行目に位置ピンアイコンが含まれること'
  );

  // 5. 選択クリック時のコールバックと非表示連動
  item1.dispatchEvent({ type: 'click' });
  assert.strictEqual(selectedCandidate, candidates[0], '選択した候補がコールバックに渡されること');
  assert.strictEqual(dropdown.classList.contains('hidden'), true, '選択後にドロップダウンが非表示化されること');
  assert.strictEqual(backdrop.classList.contains('hidden'), true, '選択後にバックドロップが非表示化されること');
});

// ============================================================================
// 5. UIController連動検証: hideSearchResults による一括非表示化
// ============================================================================
test('UI-RESP-05: UIController.hideSearchResults によるドロップダウンとバックドロップの完全同期非表示化', () => {
  const elements = setupDomMock();

  const dropdown = elements['search-results-dropdown'];
  const backdrop = elements['search-backdrop'];
  const searchInput = elements['search-input'];

  dropdown.classList.remove('hidden');
  backdrop.classList.remove('hidden');
  searchInput.setAttribute('aria-expanded', 'true');
  dropdown.innerHTML = '<div>item</div>';

  UIController.hideSearchResults();

  assert.strictEqual(dropdown.classList.contains('hidden'), true, 'ドロップダウンに hidden が付与されること');
  assert.strictEqual(backdrop.classList.contains('hidden'), true, 'バックドロップに hidden が付与されること');
  assert.strictEqual(dropdown.innerHTML, '', 'ドロップダウンのDOMがクリアされること');
  assert.strictEqual(searchInput.getAttribute('aria-expanded'), 'false', 'aria-expanded が false に戻ること');
});

// ============================================================================
// 6. セキュリティ検証: 候補カード内のタイトル・住所のXSSサニタイズ
// ============================================================================
test('UI-RESP-06: 2行構造候補カード描画におけるXSS脆弱性排除の検証', () => {
  const elements = setupDomMock();
  const dropdown = elements['search-results-dropdown'];

  const maliciousCandidates = [
    {
      id: 'xss-1',
      title: '<script>alert("XSS")</script>',
      address: '<img src=x onerror="alert(\'HACKED\')">',
      source: 'osm',
      distanceKm: null
    }
  ];

  UIController.showSearchResults(maliciousCandidates, () => {});

  const item = dropdown.children[0];
  assert.ok(!item.innerHTML.includes('<script>'), 'scriptタグが生のままDOMに挿入されていないこと');
  assert.ok(item.innerHTML.includes('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;'), 'タイトルが正しくエスケープされていること');
  assert.ok(item.innerHTML.includes('&lt;img src=x onerror=&quot;alert(&#39;HACKED&#39;)&quot;&gt;'), '住所が正しくエスケープされていること');
});

// ============================================================================
// 7. イベント調停検証: バックドロップタップによる候補一覧クローズ (AC-9.7)
// ============================================================================
test('UI-RESP-07: バックドロップクリックで hideSearchResults が実行されクローズされること (AC-9.7)', () => {
  const elements = setupDomMock();

  const dropdown = elements['search-results-dropdown'];
  const backdrop = elements['search-backdrop'];

  // イベントリスナーの初期登録
  App.setupEventListeners();

  // 候補を表示状態にする
  dropdown.classList.remove('hidden');
  backdrop.classList.remove('hidden');

  // バックドロップをクリック
  backdrop.dispatchEvent({ type: 'click' });

  // ドロップダウンおよびバックドロップが閉じること
  assert.strictEqual(dropdown.classList.contains('hidden'), true, 'バックドロップクリックでドロップダウンが非表示化されること');
  assert.strictEqual(backdrop.classList.contains('hidden'), true, 'バックドロップクリックでバックドロップ自身も非表示化されること');
});

// ============================================================================
// 8. 防御的プログラミング検証: バックドロップ要素が存在しない環境でのクラッシュ防止
// ============================================================================
test('UI-RESP-08: バックドロップ要素 (search-backdrop) が存在しない場合でも安全に動作すること', () => {
  setupDomMock();

  // backdrop 要素を意図的に null に偽装
  const originalGetElementById = document.getElementById;
  document.getElementById = (id) => {
    if (id === 'search-backdrop') return null;
    return originalGetElementById(id);
  };

  try {
    assert.doesNotThrow(() => {
      UIController.showSearchResults([
        { title: 'テスト', address: 'テスト住所', source: 'gsi' }
      ], () => {});
    }, 'search-backdrop が null でも showSearchResults でクラッシュしないこと');

    assert.doesNotThrow(() => {
      UIController.hideSearchResults();
    }, 'search-backdrop が null でも hideSearchResults でクラッシュしないこと');
  } finally {
    document.getElementById = originalGetElementById;
  }
});
