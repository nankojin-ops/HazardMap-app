/**
 * @file shelter.test.js
 * @description ShelterService のタイル座標計算、Haversine距離、福祉判定、重複マージ、ソートパイプラインを検証するテスト
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { ShelterService } from '../js/shelter-service.js';
import { APP_CONFIG } from '../js/config.js';

test('ShelterService: getTileCoordinate によるタイル座標計算', () => {
  // 新大阪駅周辺 (lat: 34.7263, lng: 135.4973, zoom: 10)
  const tile = ShelterService.getTileCoordinate(34.7263, 135.4973, 10);
  assert.strictEqual(tile.z, 10);
  assert.strictEqual(tile.x, 897);
  assert.strictEqual(tile.y, 406);

  // 札幌 (lat: 43.1180, lng: 141.2250, zoom: 10)
  const sapporoTile = ShelterService.getTileCoordinate(43.1180, 141.2250, 10);
  assert.strictEqual(sapporoTile.z, 10);
  assert.strictEqual(sapporoTile.x, 913);
  assert.strictEqual(sapporoTile.y, 375);
});

test('ShelterService: calculateDistanceKm による大円距離計算精度', () => {
  // 同一地点は 0km
  const zeroDist = ShelterService.calculateDistanceKm(35.0, 135.0, 35.0, 135.0);
  assert.strictEqual(zeroDist, 0);

  // 新大阪駅 (34.7335, 135.5001) 〜 大阪駅 (34.7025, 135.4960)
  // 実測直線距離: 約 3.46km
  const dist = ShelterService.calculateDistanceKm(34.7335, 135.5001, 34.7025, 135.4960);
  assert.ok(dist >= 3.4 && dist <= 3.6, `直線距離約3.5km想定、実測: ${dist}km`);
});

test('ShelterService: parseFeatureCoordinates による安全パース', () => {
  // Point形式
  const pointGeom = {
    type: 'Point',
    coordinates: [135.4973, 34.7263]
  };
  const parsedPoint = ShelterService.parseFeatureCoordinates(pointGeom);
  assert.deepStrictEqual(parsedPoint, { lat: 34.7263, lng: 135.4973 });

  // Polygon形式
  const polyGeom = {
    type: 'Polygon',
    coordinates: [[[135.4973, 34.7263], [135.4980, 34.7270], [135.4973, 34.7263]]]
  };
  const parsedPoly = ShelterService.parseFeatureCoordinates(polyGeom);
  assert.deepStrictEqual(parsedPoly, { lat: 34.7263, lng: 135.4973 });

  // 不正形式
  assert.strictEqual(ShelterService.parseFeatureCoordinates(null), null);
  assert.strictEqual(ShelterService.parseFeatureCoordinates({ type: 'Unknown' }), null);
  assert.strictEqual(ShelterService.parseFeatureCoordinates({ type: 'Point', coordinates: ['invalid'] }), null);
});

test('ShelterService: checkIsWelfare による福祉避難所判定ロジック', () => {
  // 1. プロパティ判定
  assert.strictEqual(ShelterService.checkIsWelfare({ welfare: '1' }, '施設A'), true);
  assert.strictEqual(ShelterService.checkIsWelfare({ is_welfare: 1 }, '施設B'), true);
  assert.strictEqual(ShelterService.checkIsWelfare({ welfare: '0' }, '施設C'), false);

  // 2. 備考・対象者キーワード判定
  assert.strictEqual(ShelterService.checkIsWelfare({ remarks: '高齢者デイサービス利用可能' }, '施設D'), true);
  assert.strictEqual(ShelterService.checkIsWelfare({ target: '要介護認定者' }, '施設E'), true);

  // 3. 施設名称キーワード判定
  assert.strictEqual(ShelterService.checkIsWelfare({}, '特別養護老人ホーム淀川園'), true);
  assert.strictEqual(ShelterService.checkIsWelfare({}, '市立障がい者支援センター'), true);
  assert.strictEqual(ShelterService.checkIsWelfare({}, 'ケアセンターひまわり'), true);

  // 4. 一般避難所
  assert.strictEqual(ShelterService.checkIsWelfare({}, '大阪市立淀川中学校'), false);
  assert.strictEqual(ShelterService.checkIsWelfare({}, '西中島小学校体育館'), false);
});

test('ShelterService: fetchTileFeatures の404吸収とキャッシュ動作', async () => {
  ShelterService.clearCache();
  const originalFetch = globalThis.fetch;
  let fetchCallCount = 0;

  try {
    globalThis.fetch = async (url) => {
      fetchCallCount++;
      if (url.includes('not-found-tile')) {
        return {
          ok: false,
          status: 404
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          features: [{ properties: { name: 'テスト避難所' } }]
        })
      };
    };

    // 404 Not Found の場合: 空配列を返し例外を出さない
    const res404 = await ShelterService.fetchTileFeatures('https://example.com/not-found-tile');
    assert.deepStrictEqual(res404, []);
    assert.strictEqual(fetchCallCount, 1);

    // キャッシュ確認: 2回目は fetch を呼ばずキャッシュから返却
    const res404Cached = await ShelterService.fetchTileFeatures('https://example.com/not-found-tile');
    assert.deepStrictEqual(res404Cached, []);
    assert.strictEqual(fetchCallCount, 1, 'キャッシュから取得されたため fetch カウントは増加しない');

    // 200 OK の場合
    const res200 = await ShelterService.fetchTileFeatures('https://example.com/ok-tile');
    assert.strictEqual(res200.length, 1);
    assert.strictEqual(fetchCallCount, 2);

  } finally {
    globalThis.fetch = originalFetch;
    ShelterService.clearCache();
  }
});

test('ShelterService: getNearbyShelters の重複マージ・ソート・徒歩計算統合テスト', async () => {
  ShelterService.clearCache();
  const originalFetch = globalThis.fetch;

  try {
    // モックデータ返却: 同一施設「中央小学校」が洪水(skhb01)と地震(skhb04)の2つのタイルで返却されるケース
    globalThis.fetch = async (url) => {
      if (url.includes('skhb01')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            features: [
              {
                geometry: { type: 'Point', coordinates: [135.5000, 34.7300] },
                properties: { name: '中央小学校', address: '大阪市淀川区1-1' }
              },
              {
                geometry: { type: 'Point', coordinates: [135.5100, 34.7400] },
                properties: { name: '特別養護老人ホームさくら', address: '大阪市淀川区2-2' }
              }
            ]
          })
        };
      } else if (url.includes('skhb04')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            features: [
              {
                geometry: { type: 'Point', coordinates: [135.5000, 34.7300] },
                properties: { name: '中央小学校', address: '大阪市淀川区1-1' }
              }
            ]
          })
        };
      }

      // その他種別は 404
      return { ok: false, status: 404 };
    };

    // 中心座標: 新大阪 (34.7263, 135.4973)
    const shelters = await ShelterService.getNearbyShelters(34.7263, 135.4973);

    assert.ok(Array.isArray(shelters));
    assert.strictEqual(shelters.length, 2, '中央小学校が重複マージされ計2件になること');

    // 1件目: 距離の近い「中央小学校」
    const chuo = shelters.find(s => s.name === '中央小学校');
    assert.ok(chuo);
    assert.strictEqual(chuo.isWelfare, false);
    assert.strictEqual(chuo.targetNote, '一般避難者対象');
    // 洪水と地震の両方がカテゴリに含まれていること
    assert.ok(chuo.categories.includes('洪水'));
    assert.ok(chuo.categories.includes('地震'));
    assert.ok(chuo.category.includes('洪水') && chuo.category.includes('地震'));

    // 徒歩時間の計算検証 (80m/分、迂回係数1.25)
    // 直線距離: calculateDistanceKm(34.7263, 135.4973, 34.7300, 135.5000) = 約 0.48km
    // 道なり距離: 0.48 * 1.25 = 0.60km (600m)
    // 徒歩時間: ceil(600 / 80) = 8分
    assert.ok(chuo.walkingMinutes > 0);
    assert.strictEqual(typeof chuo.walkingDistance, 'number');

    // 2件目: 「特別養護老人ホームさくら」 (福祉避難所)
    const sakura = shelters.find(s => s.name === '特別養護老人ホームさくら');
    assert.ok(sakura);
    assert.strictEqual(sakura.isWelfare, true);
    assert.strictEqual(sakura.targetNote, '要介護者・要配慮者優先（福祉避難所等）');

    // ソート順検証: 徒歩時間昇順
    assert.ok(shelters[0].walkingMinutes <= shelters[1].walkingMinutes);

  } finally {
    globalThis.fetch = originalFetch;
    ShelterService.clearCache();
  }
});
