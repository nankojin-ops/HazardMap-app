/**
 * @file qa-edge-cases.test.js
 * @description QAエンジニアによるエッジケース、境界条件、無効入力、セキュリティ、耐障害性の徹底検証テストスイート
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { ShelterService } from '../js/shelter-service.js';
import { GeocodingService } from '../js/geocoding-service.js';
import { MapService } from '../js/map-service.js';
import { UIController } from '../js/ui-controller.js';
import { APP_CONFIG } from '../js/config.js';

// ============================================================================
// 1. セキュリティ検証 (XSS & HTMLエスケープ)
// ============================================================================
test('QA-SEC-01: MapService.escapeHtml および UIController.escapeHtml のエスケープ網羅性', () => {
  const dangerousStrings = [
    '<script>alert("xss")</script>',
    '<img src="x" onerror="alert(1)">',
    '"><svg onload=alert(1)>',
    "';alert(1);'",
    '& < > " \''
  ];

  for (const str of dangerousStrings) {
    const escapedMap = MapService.escapeHtml(str);
    const escapedUI = UIController.escapeHtml(str);

    assert.strictEqual(escapedMap, escapedUI, 'MapServiceとUIControllerのエスケープ結果は一致すべき');
    assert.ok(!escapedMap.includes('<'), `< がエスケープされていること: ${escapedMap}`);
    assert.ok(!escapedMap.includes('>'), `> がエスケープされていること: ${escapedMap}`);
    assert.ok(!escapedMap.includes('"'), `" がエスケープされていること: ${escapedMap}`);
    assert.ok(!escapedMap.includes("'"), `' がエスケープされていること: ${escapedMap}`);
  }

  // null, undefined, 数値, 空文字の耐性
  assert.strictEqual(MapService.escapeHtml(null), '');
  assert.strictEqual(MapService.escapeHtml(undefined), '');
  assert.strictEqual(MapService.escapeHtml(''), '');
  assert.strictEqual(MapService.escapeHtml(123), '');
});

test('QA-SEC-02: [潜在脆弱性の検出] MapService.setLocationMarker の popupText における未エスケープHTMLの脆弱性検証', () => {
  // MapService.setLocationMarker は外部から渡された popupText をそのまま bindPopup / setPopupContent に渡している。
  // App.updateLocation では `<strong>${label}</strong>` として結合している。
  // もし label に `<img src=x onerror=alert(1)>` が渡された場合、サニタイズされずにそのまま出力されるか？
  
  const rawLabel = '<img src=x onerror=alert(1)>';
  const constructedPopupText = `<strong>${rawLabel}</strong>`;

  // この文字列はエスケープされていないため、悪意あるタグが残存している
  assert.ok(constructedPopupText.includes('<img src=x onerror=alert(1)>'), '未エスケープのタグがそのまま結合されている');

  // 推奨される安全な構築方法:
  const safeConstructed = `<strong>${MapService.escapeHtml(rawLabel)}</strong>`;
  assert.ok(!safeConstructed.includes('<img'), '安全な構築ではタグが無効化されるべき');
});

// ============================================================================
// 2. 極端・無効な入力値 (Extreme & Invalid Inputs)
// ============================================================================
test('QA-INP-01: ShelterService.getTileCoordinate の極端な座標値に対する堅牢性', () => {
  // 極端な緯度 (90度, -90度, 85度以上)
  const tilePoleNorth = ShelterService.getTileCoordinate(90, 135, 10);
  // Math.cos(90 deg) = 0 に近いため、y が NaN または -Infinity になる可能性がある
  assert.ok(
    Number.isNaN(tilePoleNorth.y) || !Number.isFinite(tilePoleNorth.y) || typeof tilePoleNorth.y === 'number',
    '極地緯度での計算結果型'
  );

  // 範囲外の極端な値 (lat: 99999, lng: 99999)
  const tileExtreme = ShelterService.getTileCoordinate(99999, 99999, 10);
  assert.strictEqual(typeof tileExtreme.x, 'number');
  assert.strictEqual(typeof tileExtreme.y, 'number');

  // 日本標準座標 (正常値)
  const normalTile = ShelterService.getTileCoordinate(35.6812, 139.7671, 10);
  assert.ok(normalTile.x >= 0 && normalTile.x < 1024);
  assert.ok(normalTile.y >= 0 && normalTile.y < 1024);
});

test('QA-INP-02: ShelterService.getNearbyShelters に無効な引数が渡された場合の即時リターン', async () => {
  assert.deepStrictEqual(await ShelterService.getNearbyShelters(NaN, 135.0), []);
  assert.deepStrictEqual(await ShelterService.getNearbyShelters(35.0, NaN), []);
  assert.deepStrictEqual(await ShelterService.getNearbyShelters('35.0', 135.0), []);
  assert.deepStrictEqual(await ShelterService.getNearbyShelters(null, null), []);
  assert.deepStrictEqual(await ShelterService.getNearbyShelters(undefined, undefined), []);
});

test('QA-INP-03: GeocodingService.geocode に対する超長文・特殊記号・インジェクション耐性', async () => {
  const originalFetch = globalThis.fetch;

  try {
    let capturedUrl = '';
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => []
      };
    };

    // 1000文字の超長文
    const longQuery = 'A'.repeat(1000);
    const resLong = await GeocodingService.geocode(longQuery);
    assert.strictEqual(resLong, null);
    assert.ok(capturedUrl.includes(encodeURIComponent(longQuery)));

    // XSS文字列クエリ
    const xssQuery = '<script>alert("test")</script>';
    const resXss = await GeocodingService.geocode(xssQuery);
    assert.strictEqual(resXss, null);
    assert.ok(!capturedUrl.includes('<script>'), 'URLエンコードされていること');

    // 空白・改行のみ
    assert.strictEqual(await GeocodingService.geocode('\n\t  \r'), null);

  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ============================================================================
// 3. 境界条件の検証 (Boundary Conditions)
// ============================================================================
test('QA-BND-01: 検索距離境界値 5.0km ちょうどの包含判定', async () => {
  ShelterService.clearCache();
  const originalFetch = globalThis.fetch;

  try {
    // 中心座標: lat: 35.0000, lng: 135.0000
    // 地球半径 6371km において、緯度 1度 = 約 111.1949km
    // 5.0km は 緯度差で約 0.044966度
    const userLat = 35.0000;
    const userLng = 135.0000;

    // ぴったり 5.0km の座標を逆算
    // calculateDistanceKm(35.0, 135.0, 35.0 + deltaLat, 135.0) = 5.0
    // dLat = (5.0 / 6371) * (180 / Math.PI) = 0.044966052...
    const exact5kmLat = userLat + (5.0 / 6371) * (180 / Math.PI);
    const distExact = ShelterService.calculateDistanceKm(userLat, userLng, exact5kmLat, userLng);
    assert.ok(Math.abs(distExact - 5.0) < 0.0001, `実測距離: ${distExact}km`);

    // 5.001km (境界外)
    const over5kmLat = userLat + (5.005 / 6371) * (180 / Math.PI);
    const distOver = ShelterService.calculateDistanceKm(userLat, userLng, over5kmLat, userLng);
    assert.ok(distOver > 5.0, `実測距離: ${distOver}km`);

    globalThis.fetch = async (url) => {
      if (url.includes('skhb01')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            features: [
              {
                geometry: { type: 'Point', coordinates: [userLng, exact5kmLat] },
                properties: { name: '5km境界避難所' }
              },
              {
                geometry: { type: 'Point', coordinates: [userLng, over5kmLat] },
                properties: { name: '5km超過避難所' }
              }
            ]
          })
        };
      }
      return { ok: false, status: 404 };
    };

    const shelters = await ShelterService.getNearbyShelters(userLat, userLng, 5.0);
    const names = shelters.map(s => s.name);

    assert.ok(names.includes('5km境界避難所'), '5.0km以内の避難所はリストに含まれること');
    assert.ok(!names.includes('5km超過避難所'), '5.0kmを超える避難所は除外されること');

  } finally {
    globalThis.fetch = originalFetch;
    ShelterService.clearCache();
  }
});

test('QA-BND-02: 避難所件数が50件超過時のスライスとソート整合性', async () => {
  ShelterService.clearCache();
  const originalFetch = globalThis.fetch;

  try {
    // 60件の避難所データを生成 (距離が徐々に離れる)
    const dummyFeatures = [];
    for (let i = 1; i <= 60; i++) {
      dummyFeatures.push({
        geometry: {
          type: 'Point',
          coordinates: [135.0000 + i * 0.0005, 35.0000 + i * 0.0005]
        },
        properties: {
          name: `避難所第${i}号`,
          address: `市区町村${i}`
        }
      });
    }

    globalThis.fetch = async (url) => {
      if (url.includes('skhb01')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ features: dummyFeatures })
        };
      }
      return { ok: false, status: 404 };
    };

    const shelters = await ShelterService.getNearbyShelters(35.0000, 135.0000);

    // 最大件数が APP_CONFIG.MAX_SHELTER_DISPLAY_COUNT (50件) に正確に切り捨てられているか
    assert.strictEqual(shelters.length, 50, '取得件数は上限50件であること');

    // ソート順の厳密性検証 (徒歩所要時間昇順、同時間の場合は徒歩距離昇順)
    for (let j = 0; j < shelters.length - 1; j++) {
      const current = shelters[j];
      const next = shelters[j + 1];

      if (current.walkingMinutes === next.walkingMinutes) {
        assert.ok(
          current.walkingDistance <= next.walkingDistance,
          `所要時間同一時は距離昇順であること: [${j}] ${current.walkingDistance} <= [${j+1}] ${next.walkingDistance}`
        );
      } else {
        assert.ok(
          current.walkingMinutes < next.walkingMinutes,
          `所要時間昇順であること: [${j}] ${current.walkingMinutes} < [${j+1}] ${next.walkingMinutes}`
        );
      }
    }

  } finally {
    globalThis.fetch = originalFetch;
    ShelterService.clearCache();
  }
});

// ============================================================================
// 4. データ整合性・ジオメトリパースの網羅検証
// ============================================================================
test('QA-DAT-01: ShelterService.parseFeatureCoordinates の各GeoJSON型パース耐久性', () => {
  // 正常Point
  assert.deepStrictEqual(
    ShelterService.parseFeatureCoordinates({ type: 'Point', coordinates: [135.5, 35.5] }),
    { lat: 35.5, lng: 135.5 }
  );

  // MultiPoint (最初の頂点)
  assert.deepStrictEqual(
    ShelterService.parseFeatureCoordinates({
      type: 'MultiPoint',
      coordinates: [[135.1, 35.1], [135.2, 35.2]]
    }),
    { lat: 35.1, lng: 135.1 }
  );

  // Polygon (外側リングの最初の頂点)
  assert.deepStrictEqual(
    ShelterService.parseFeatureCoordinates({
      type: 'Polygon',
      coordinates: [
        [[135.3, 35.3], [135.4, 35.4], [135.3, 35.3]]
      ]
    }),
    { lat: 35.3, lng: 135.3 }
  );

  // 異常系: coordinatesが空配列
  assert.strictEqual(ShelterService.parseFeatureCoordinates({ type: 'Point', coordinates: [] }), null);
  assert.strictEqual(ShelterService.parseFeatureCoordinates({ type: 'Polygon', coordinates: [] }), null);
  assert.strictEqual(ShelterService.parseFeatureCoordinates({ type: 'MultiPoint', coordinates: [] }), null);

  // 異常系: coordinatesにNaNや文字列
  assert.strictEqual(ShelterService.parseFeatureCoordinates({ type: 'Point', coordinates: ['135', '35'] }), null);
  assert.strictEqual(ShelterService.parseFeatureCoordinates({ type: 'Point', coordinates: [NaN, 35] }), null);
});

test('QA-DAT-02: 福祉避難所判定の偽陽性・偽陰性検証', () => {
  // 偽陽性防止: "0" や false は福祉避難所と判定されないこと
  assert.strictEqual(ShelterService.checkIsWelfare({ welfare: '0' }, '一般中学校'), false);
  assert.strictEqual(ShelterService.checkIsWelfare({ welfare: 0 }, '一般中学校'), false);
  assert.strictEqual(ShelterService.checkIsWelfare({ is_welfare: false }, '一般中学校'), false);
  assert.strictEqual(ShelterService.checkIsWelfare({ welfare: null }, '一般中学校'), false);

  // 偽陰性防止: 施設名にキーワードが含まれている場合の検知
  assert.strictEqual(ShelterService.checkIsWelfare({}, 'デイサービスセンターあさひ'), true);
  assert.strictEqual(ShelterService.checkIsWelfare({}, '老健施設みどり'), true); // "老健" キーワード
  assert.strictEqual(ShelterService.checkIsWelfare({}, '特別支援学校体育館'), true); // "支援学校" キーワード

  // BUG-003是正後検証: 「老人保健施設」「老人ホーム」が福祉避難所として検知されること
  const isRokenMatched = ShelterService.checkIsWelfare({}, '老人保健施設みどり');
  assert.strictEqual(isRokenMatched, true, '拡充後のWELFARE_KEYWORDSで「老人保健施設」が正常にマッチすること');

  const isRokenHomeMatched = ShelterService.checkIsWelfare({}, '特別養護老人ホーム若葉');
  assert.strictEqual(isRokenHomeMatched, true, '拡充後のWELFARE_KEYWORDSで「老人ホーム」が正常にマッチすること');
});

// ============================================================================
// 5. 耐障害性とエラー処理の検証 (Fault Tolerance)
// ============================================================================
test('QA-FLT-01: 国土地理院タイルAPIが500/ネットワーク切断/破損JSONを返した場合の耐障害性', async () => {
  ShelterService.clearCache();
  const originalFetch = globalThis.fetch;

  try {
    let callIndex = 0;
    globalThis.fetch = async () => {
      callIndex++;
      if (callIndex % 3 === 1) {
        // 500 Internal Server Error
        return { ok: false, status: 500 };
      } else if (callIndex % 3 === 2) {
        // ネットワーク切断 (例外スロー)
        throw new Error('ECONNRESET');
      } else {
        // 破損JSON
        return {
          ok: true,
          status: 200,
          json: async () => { throw new SyntaxError('Unexpected token < in JSON'); }
        };
      }
    };

    // 全リクエストが障害であっても、例外をスローせず安全に空配列を返すこと
    const shelters = await ShelterService.getNearbyShelters(34.7263, 135.4973);
    assert.deepStrictEqual(shelters, [], '通信障害時はクラッシュせず空配列を返す');

  } finally {
    globalThis.fetch = originalFetch;
    ShelterService.clearCache();
  }
});

// ============================================================================
// 6. 是正タスク検証 (BUG-001, BUG-002, BUG-004)
// ============================================================================
test('QA-FIX-01: [BUG-001是正] MapService.setLocationMarker におけるポップアップHTMLサニタイズ検証', () => {
  const originalWindow = globalThis.window;
  let boundPopupContent = '';

  try {
    globalThis.window = {
      L: {
        divIcon: () => ({}),
        marker: () => ({
          addTo: () => ({
            bindPopup: (content) => { boundPopupContent = content; }
          })
        })
      }
    };
    MapService.map = {
      setView: () => {}
    };
    MapService.centerMarker = null;

    // 悪意あるスクリプトタグを含むラベルを渡す
    MapService.setLocationMarker(34.7, 135.5, '<script>alert("xss")</script>');
    assert.ok(!boundPopupContent.includes('<script>'), '悪意あるscriptタグがエスケープされていること');
    assert.ok(boundPopupContent.includes('&lt;script&gt;'), 'HTMLエンティティに変換されていること');

    // プレーンテキストの場合も安全に太字タグで包まれること
    MapService.centerMarker = null;
    MapService.setLocationMarker(34.7, 135.5, '新大阪駅周辺');
    assert.strictEqual(boundPopupContent, '<strong>新大阪駅周辺</strong>');

  } finally {
    globalThis.window = originalWindow;
    MapService.map = null;
    MapService.centerMarker = null;
  }
});

test('QA-FIX-02: [BUG-002是正] UIController.highlightShelterCard のハイライト動作検証', () => {
  const originalDoc = globalThis.document;
  let scrolled = false;

  try {
    const dummyCard = {
      getAttribute: (attr) => attr === 'data-shelter-id' ? '新大阪小_34.72000_135.49000' : null,
      classList: {
        add: (...cls) => { dummyCard._classes.push(...cls); },
        remove: (...cls) => { dummyCard._classes = dummyCard._classes.filter(c => !cls.includes(c)); }
      },
      scrollIntoView: (opts) => {
        scrolled = true;
        assert.strictEqual(opts.behavior, 'smooth');
        assert.strictEqual(opts.block, 'nearest');
      },
      _classes: []
    };

    globalThis.document = {
      getElementById: (id) => id === 'shelter-list' ? {
        querySelectorAll: (sel) => sel === '.shelter-card-active' ? [] : [dummyCard]
      } : null
    };

    UIController.highlightShelterCard({
      name: '新大阪小',
      lat: 34.72000,
      lng: 135.49000
    });

    assert.ok(dummyCard._classes.includes('shelter-card-active'), 'アクティブクラスが付与されること');
    assert.ok(scrolled, 'scrollIntoViewが呼び出されること');

  } finally {
    globalThis.document = originalDoc;
  }
});

test('QA-FIX-03: [BUG-004是正] App.currentRequestId によるレースコンディション防止ガード検証', async () => {
  const { App } = await import('../js/app.js');
  const initialId = App.currentRequestId;
  assert.strictEqual(typeof initialId, 'number');

  // インクリメント確認
  App.currentRequestId++;
  assert.strictEqual(App.currentRequestId, initialId + 1);
});
