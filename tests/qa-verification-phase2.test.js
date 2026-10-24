/**
 * @file qa-verification-phase2.test.js
 * @description QAエンジニアによる第2版（ハイブリッド検索・スマートリランキング・候補UI）の
 * 障害モード、エッジケース、セキュリティ、並行性、耐障害性、データ整合性の徹底検証テスト
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { GeocodingService } from '../js/geocoding-service.js';
import { UIController } from '../js/ui-controller.js';
import { App } from '../js/app.js';
import { APP_CONFIG } from '../js/config.js';

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

  return elements;
}

// ============================================================================
// 1. 異常入力・特殊記号・XSSインジェクション攻撃文字列の検証
// ============================================================================
test('QA-HYB-01: 異常入力・特殊記号・XSS攻撃文字列に対する堅牢性検証', async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => []
    });

    // 1. 空文字、空白のみ、改行、タブ
    assert.deepStrictEqual(await GeocodingService.search(''), []);
    assert.deepStrictEqual(await GeocodingService.search('   '), []);
    assert.deepStrictEqual(await GeocodingService.search('\n\t\r'), []);
    assert.deepStrictEqual(await GeocodingService.search(null), []);
    assert.deepStrictEqual(await GeocodingService.search(undefined), []);
    assert.deepStrictEqual(await GeocodingService.search(12345), []);
    assert.deepStrictEqual(await GeocodingService.search({}), []);

    // 2. XSSインジェクション攻撃文字列
    const xssPayloads = [
      '<script>alert("XSS")</script>',
      '"><img src=x onerror=alert(1)>',
      'javascript:/*--></title></style></textarea></script></xmp><svg/onload=\'+/"/+/onmouseover=1/+/[*/[]/+alert(1)//\'>',
      '\x00<script>',
      '\' OR \'1\'=\'1',
      '../../../../../../etc/passwd',
      '${7*7}',
      '{{constructor.constructor("alert(1)")()}}'
    ];

    for (const payload of xssPayloads) {
      const res = await GeocodingService.search(payload);
      assert.ok(Array.isArray(res), `XSSペイロード [${payload}] で配列が返ること`);
    }

    // 3. 超長文入力 (10,000文字)
    const longString = '新宿'.repeat(5000);
    const longRes = await GeocodingService.search(longString);
    assert.ok(Array.isArray(longRes));

    // 4. 絵文字・サロゲートペア
    const emojiRes = await GeocodingService.search('🗼📍🗾');
    assert.ok(Array.isArray(emojiRes));

  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ============================================================================
// 2. 外部API障害モード（500/429/壊れたレスポンス/例外/片肺運転）の網羅的検証
// ============================================================================
test('QA-HYB-02: 外部API障害モード（500/429/壊れたレスポンス/例外）の網羅的検証', async () => {
  const originalFetch = globalThis.fetch;

  try {
    // 障害モード1: GSIが500エラー、OSMが429レート制限エラー（完全ダウン）
    globalThis.fetch = async (url) => {
      if (url.includes('msearch')) return { ok: false, status: 500 };
      if (url.includes('nominatim')) return { ok: false, status: 429 };
      return { ok: false, status: 404 };
    };

    const res1 = await GeocodingService.search('新宿駅');
    assert.deepStrictEqual(res1, [], '両APIダウン時は例外を出さず空配列を返却すること');

    // 障害モード2: 200 OKだがJSONではない不正レスポンス（HTMLエラー画面の返却）
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0');
      }
    });

    const res2 = await GeocodingService.search('渋谷駅');
    assert.deepStrictEqual(res2, [], 'JSONパース失敗時も例外を吸収して空配列を返却すること');

    // 障害モード3: レスポンスが null や 配列以外のオブジェクト
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ error: 'Internal Server Error' }) // 配列ではない
    });

    const res3 = await GeocodingService.search('新大阪駅');
    assert.deepStrictEqual(res3, [], '配列以外のJSONレスポンス時も安全に空配列を返却すること');

    // 障害モード4: GeoJSON/JSON要素内のプロパティ破損（coordinatesが空配列、lat/lonが文字列でも数値でもない）
    globalThis.fetch = async (url) => {
      if (url.includes('msearch')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            { geometry: null }, // geometry欠落
            { geometry: { coordinates: [] } }, // coordinates要素なし
            { geometry: { coordinates: ['invalid', 'coord'] } }, // NaN
            { properties: null } // properties欠落
          ]
        };
      }
      if (url.includes('nominatim')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {}, // プロパティ全欠落
            { lat: 'abc', lon: 'def' }, // 数値変換不能
            { lat: null, lon: undefined }
          ]
        };
      }
      return { ok: false, status: 404 };
    };

    const res4 = await GeocodingService.search('東京タワー');
    assert.deepStrictEqual(res4, [], '破損した要素はすべてスキップされクラッシュしないこと');

  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ============================================================================
// 3. スマートリランキングアルゴリズムの境界条件とスコアリング検証
// ============================================================================
test('QA-HYB-03: スマートリランキングアルゴリズムの境界条件とスコアリング検証', () => {
  // 1. 文字列マッチ度の境界テスト
  const candidateExact = {
    title: '新宿駅',
    address: '東京都新宿区新宿三丁目',
    lat: 35.69,
    lng: 139.70,
    prefCode: '13',
    source: 'osm',
    rawImportance: 0.8
  };

  const scoreExact = GeocodingService.calculateCandidateScore(candidateExact, '新宿駅', 35.69, 139.70);
  assert.strictEqual(scoreExact.score >= 130, true, '完全一致＋区＋高知名度＋距離ゼロで高スコア');
  assert.strictEqual(scoreExact.isHighConfidence, true, '高確度フラグがtrue');

  // 2. 距離ペナルティの境界値 (0km, 500km, 1000km, 2000km)
  const d0 = GeocodingService.calculateCandidateScore(candidateExact, '新宿駅', 35.69, 139.70);
  const d500 = GeocodingService.calculateCandidateScore(candidateExact, '新宿駅', 35.69 + 4.5, 139.70);
  const d1000 = GeocodingService.calculateCandidateScore(candidateExact, '新宿駅', 35.69 + 9.0, 139.70);
  const d2000 = GeocodingService.calculateCandidateScore(candidateExact, '新宿駅', 35.69 + 18.0, 139.70);

  assert.ok(d0.score > d500.score, '距離0kmの方が500kmよりスコアが高い');
  assert.ok(d500.score > d1000.score, '距離500kmの方が1000kmよりスコアが高い');
  assert.strictEqual(
    Math.round((d1000.score - d2000.score) * 10) / 10,
    0,
    '1000km以上離れても距離ペナルティは最大15点で頭打ちとなり過剰減点されないこと'
  );

  // 3. rawImportance の異常値耐性 (負数、NaN、null、未定義、2.0等の範囲外)
  const candidateAnomaly = {
    title: 'テスト地点',
    address: '東京都テスト区',
    lat: 35.0,
    lng: 135.0,
    prefCode: '13',
    source: 'osm',
    rawImportance: -5
  };
  const scoreNeg = GeocodingService.calculateCandidateScore(candidateAnomaly, 'テスト地点', null, null);
  assert.ok(!isNaN(scoreNeg.score), '負のrawImportanceでもNaNにならないこと');

  candidateAnomaly.rawImportance = 999;
  const scoreOver = GeocodingService.calculateCandidateScore(candidateAnomaly, 'テスト地点', null, null);
  assert.ok(scoreOver.score <= 150, '知名度スコアは上限20点でクランプされること');

  candidateAnomaly.rawImportance = 'invalid';
  const scoreNan = GeocodingService.calculateCandidateScore(candidateAnomaly, 'テスト地点', null, null);
  assert.ok(!isNaN(scoreNan.score), '不正文字列でもNaNにならないこと');
});

// ============================================================================
// 4. UI Controller ドロップダウン描画時のXSSエスケープ検証
// ============================================================================
test('QA-HYB-04: UI Controller ドロップダウン描画時のXSSエスケープ検証', () => {
  setupDomMock();

  const maliciousCandidates = [
    {
      id: 'test_1',
      title: '<script>alert("XSS_TITLE")</script>',
      address: '<img src=x onerror=alert("XSS_ADDR")>',
      lat: 35.69,
      lng: 139.70,
      source: 'osm',
      distanceKm: 1.5,
      score: 100,
      isHighConfidence: false
    }
  ];

  let selectedItem = null;
  UIController.showSearchResults(maliciousCandidates, (item) => {
    selectedItem = item;
  });

  const dropdown = document.getElementById('search-results-dropdown');
  assert.strictEqual(dropdown.children.length, 1);

  const itemEl = dropdown.children[0];
  assert.ok(!itemEl.innerHTML.includes('<script>'), 'scriptタグが生のままDOMに挿入されていないこと');
  assert.ok(itemEl.innerHTML.includes('&lt;script&gt;alert(&quot;XSS_TITLE&quot;)&lt;/script&gt;'), 'タイトルが正しくエスケープされていること');
  assert.ok(itemEl.innerHTML.includes('&lt;img src=x onerror=alert(&quot;XSS_ADDR&quot;)&gt;'), '住所が正しくエスケープされていること');

  itemEl.dispatchEvent({ type: 'click' });
  assert.strictEqual(selectedItem, maliciousCandidates[0]);
  assert.ok(dropdown.classList.contains('hidden'), '選択後にドロップダウンが非表示化されること');
});

// ============================================================================
// 5. UI Controller の極端な引数・防御的プログラミング検証
// ============================================================================
test('QA-HYB-05: UI Controller の極端な引数・防御的プログラミング検証', () => {
  setupDomMock();

  assert.doesNotThrow(() => UIController.showSearchResults([], null));
  assert.doesNotThrow(() => UIController.showSearchResults(null, null));
  assert.doesNotThrow(() => UIController.showSearchResults(undefined, null));

  assert.doesNotThrow(() => UIController.hideSearchResults());

  assert.doesNotThrow(() => UIController.setSearchLoading(true));
  assert.doesNotThrow(() => UIController.setSearchLoading(false));
});

// ============================================================================
// 6. [BUG-005是正] 検索非同期通信におけるリクエスト世代管理の検証
// ============================================================================
test('QA-RACE-01: [BUG-005是正] App.searchAddress におけるリクエスト世代管理によるレースコンディション防止検証', async () => {
  setupDomMock();
  const originalFetch = globalThis.fetch;

  try {
    // 検索A（1回目・遅い検索: 50ms）
    // 検索B（2回目・速い検索: 0ms）
    globalThis.fetch = async (url) => {
      const isSearchA = url.includes(encodeURIComponent('遅い検索A'));
      if (isSearchA) {
        await new Promise(r => setTimeout(r, 50));
        return {
          ok: true,
          status: 200,
          json: async () => [
            { geometry: { coordinates: [139.7, 35.6] }, properties: { title: '検索Aの結果1' } },
            { geometry: { coordinates: [139.75, 35.65] }, properties: { title: '検索Aの結果2' } }
          ]
        };
      } else {
        return {
          ok: true,
          status: 200,
          json: async () => [
            { geometry: { coordinates: [135.5, 34.7] }, properties: { title: '検索Bの結果1' } },
            { geometry: { coordinates: [135.55, 34.75] }, properties: { title: '検索Bの結果2' } }
          ]
        };
      }
    };

    // 検索Aを先行実行
    const promiseA = App.searchAddress('遅い検索A');
    // isSearching をリセットし、後続の検索Bを実行（ユーザーが新たな検索を発行したシチュエーション）
    App.isSearching = false;
    const promiseB = App.searchAddress('検索B');

    await Promise.all([promiseA, promiseB]);

    const dropdown = document.getElementById('search-results-dropdown');
    const finalHtml = dropdown.innerHTML;

    const hasSearchA = finalHtml.includes('検索Aの結果');
    const hasSearchB = finalHtml.includes('検索Bの結果');

    // 是正後の判定:
    // 世代管理 (currentSearchRequestId) により、
    // 遅れて完了した検索Aの結果は破棄され、検索Bの結果がドロップダウンに維持されること
    assert.strictEqual(hasSearchA, false, '遅延した古い検索Aの結果は上書きされず破棄されること');
    assert.strictEqual(hasSearchB, true, '最新の検索Bの結果がドロップダウンに表示されていること');

  } finally {
    globalThis.fetch = originalFetch;
    App.isSearching = false;
  }
});

// ============================================================================
// 7. [BUG-006是正] 検索実行中における多重実行防止フラグの検証
// ============================================================================
test('QA-RACE-02: [BUG-006是正] App.searchAddress の同時並行実行防止（多重送信ガード）の検証', async () => {
  setupDomMock();
  const originalFetch = globalThis.fetch;

  try {
    let apiCallCount = 0;
    globalThis.fetch = async (url) => {
      if (url.includes('nominatim')) {
        apiCallCount++;
      }
      return { ok: true, status: 200, json: async () => [] };
    };

    // ユーザーがEnterキーを連続連打した場合のシミュレーション (5回同時送信)
    const promises = [
      App.searchAddress('新宿駅'),
      App.searchAddress('新宿駅'),
      App.searchAddress('新宿駅'),
      App.searchAddress('新宿駅'),
      App.searchAddress('新宿駅')
    ];

    await Promise.all(promises);

    // 多重送信ガード (isSearching) により、後続の4回はブロックされ、Nominatim APIは1回のみ発行されること
    assert.strictEqual(apiCallCount, 1, '多重送信ガードにより、同時多重リクエストが1回に抑止されること');
    assert.strictEqual(App.isSearching, false, '検索処理完了後は isSearching が false にリセットされること');

  } finally {
    globalThis.fetch = originalFetch;
    App.isSearching = false;
  }
});

// ============================================================================
// 7.5. [BUG-007是正] 現在地取得および初期位置取得時のドロップダウン非表示化検証
// ============================================================================
test('QA-UI-02: [BUG-007是正] 現在地取得および初期位置取得時のドロップダウン非表示化検証', async () => {
  setupDomMock();
  App.setupEventListeners();

  const dropdown = document.getElementById('search-results-dropdown');
  dropdown.classList.remove('hidden');

  // 現在地取得ボタンのクリックイベント発火
  const btnLocation = document.getElementById('btn-current-location');
  assert.ok(btnLocation !== null);

  const origGetCurrentLocation = App.getCurrentLocation;
  App.getCurrentLocation = async () => {};

  try {
    btnLocation.dispatchEvent({ type: 'click' });
    assert.ok(dropdown.classList.contains('hidden'), '現在地ボタン押下時にドロップダウンが非表示化されること');
  } finally {
    App.getCurrentLocation = origGetCurrentLocation;
  }

  // App.getCurrentLocation 自体の呼び出しでも hideSearchResults が実行されることを検証
  dropdown.classList.remove('hidden');
  const origGeo = globalThis.navigator ? globalThis.navigator.geolocation : undefined;
  if (!globalThis.navigator) globalThis.navigator = {};
  globalThis.navigator.geolocation = undefined;

  const origUpdateLocation = App.updateLocation;
  App.updateLocation = async () => {};

  try {
    await App.getCurrentLocation(false);
    assert.ok(dropdown.classList.contains('hidden'), 'getCurrentLocation実行時にドロップダウンが非表示化されること');
  } finally {
    if (origGeo) globalThis.navigator.geolocation = origGeo;
    App.updateLocation = origUpdateLocation;
  }
});

// ============================================================================
// 8. GeocodingService.geocode 後方互換性とシグネチャ整合性の完全検証
// ============================================================================
test('QA-COMPAT-01: GeocodingService.geocode 後方互換性とシグネチャ整合性の完全検証', async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async (url) => {
      if (url.includes('msearch')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              geometry: { coordinates: [135.49736, 34.72631] },
              properties: { title: '大阪府大阪市淀川区宮原' }
            }
          ]
        };
      }
      return { ok: true, status: 200, json: async () => [] };
    };

    const res = await GeocodingService.geocode('新大阪');
    assert.ok(res !== null);
    assert.strictEqual(typeof res.lat, 'number');
    assert.strictEqual(typeof res.lng, 'number');
    assert.strictEqual(typeof res.title, 'string');
    assert.strictEqual(typeof res.prefCode, 'string');
    assert.strictEqual(res.prefCode, '27');

    // 異常入力時のnull返却
    assert.strictEqual(await GeocodingService.geocode(''), null);
    assert.strictEqual(await GeocodingService.geocode('   '), null);
    assert.strictEqual(await GeocodingService.geocode(null), null);
    assert.strictEqual(await GeocodingService.geocode(undefined), null);

  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ============================================================================
// 9. URLパラメータ経由の初期化 (?address=...) におけるドロップダウン・自動選択の挙動検証
// ============================================================================
test('QA-URL-01: URLパラメータ経由の初期化 (?address=...) におけるドロップダウン・自動選択の挙動検証', async () => {
  setupDomMock();
  const originalFetch = globalThis.fetch;

  try {
    // 1件のみ高確度でヒットするケース
    globalThis.fetch = async (url) => {
      if (url.includes('msearch')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              geometry: { coordinates: [139.700258, 35.690921] },
              properties: { title: '新宿駅' }
            }
          ]
        };
      }
      return { ok: true, status: 200, json: async () => [] };
    };

    let updatedLocation = null;
    const origUpdateLocation = App.updateLocation;
    App.updateLocation = async (lat, lng, label, zoom, prefCode) => {
      updatedLocation = { lat, lng, label, zoom, prefCode };
    };

    try {
      await App.searchAddress('新宿駅');
      assert.ok(updatedLocation !== null, '高確度1件の場合はダイレクト移動すること');
      assert.strictEqual(updatedLocation.label, '新宿駅');

      // 複数件ヒットするケース (?address=東京都)
      updatedLocation = null;
      globalThis.fetch = async (url) => {
        if (url.includes('msearch')) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              { geometry: { coordinates: [139.7, 35.6] }, properties: { title: '東京都千代田区' } },
              { geometry: { coordinates: [139.6, 35.7] }, properties: { title: '東京都新宿区' } }
            ]
          };
        }
        return { ok: true, status: 200, json: async () => [] };
      };

      await App.searchAddress('東京都');
      assert.strictEqual(updatedLocation, null, '複数件時はダイレクト移動しないこと');
      const dropdown = document.getElementById('search-results-dropdown');
      assert.ok(!dropdown.classList.contains('hidden'), 'ドロップダウンが表示されていること');

    } finally {
      App.updateLocation = origUpdateLocation;
    }

  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ============================================================================
// 10. ドロップダウン開閉状態と aria-expanded 属性の同期検証
// ============================================================================
test('QA-UI-01: ドロップダウン開閉状態と aria-expanded 属性の同期検証', () => {
  setupDomMock();

  const searchInput = document.getElementById('search-input');
  const dropdown = document.getElementById('search-results-dropdown');

  assert.strictEqual(searchInput.getAttribute('aria-expanded'), null);

  const candidates = [
    { id: 'c1', title: '地点1', address: '住所1', lat: 35.0, lng: 135.0, source: 'gsi' }
  ];

  UIController.showSearchResults(candidates, () => {});
  assert.strictEqual(searchInput.getAttribute('aria-expanded'), 'true');
  assert.ok(!dropdown.classList.contains('hidden'));

  UIController.hideSearchResults();
  assert.strictEqual(searchInput.getAttribute('aria-expanded'), 'false');
  assert.ok(dropdown.classList.contains('hidden'));
});
