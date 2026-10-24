/**
 * @file geocoding.test.js
 * @description GeocodingService のコード抽出ロジック、逆ジオコーダ連携、住所検索連携、
 * ハイブリッド検索（GSI + OSM）、スマートリランキング、耐障害性、後方互換性を検証するテスト
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { GeocodingService } from '../js/geocoding-service.js';
import { APP_CONFIG } from '../js/config.js';

test('GeocodingService: extractPrefCodeFromMuniCd による都道府県コード抽出', () => {
  // 正常系: 5桁文字列
  assert.strictEqual(GeocodingService.extractPrefCodeFromMuniCd('27100'), '27');
  assert.strictEqual(GeocodingService.extractPrefCodeFromMuniCd('01100'), '01');
  assert.strictEqual(GeocodingService.extractPrefCodeFromMuniCd('13101'), '13');
  assert.strictEqual(GeocodingService.extractPrefCodeFromMuniCd('47201'), '47');

  // 数値型および先頭ゼロ省略時
  assert.strictEqual(GeocodingService.extractPrefCodeFromMuniCd(1100), '01');
  assert.strictEqual(GeocodingService.extractPrefCodeFromMuniCd(27100), '27');

  // 異常系: 無効値でのフォールバック (大阪府: 27)
  assert.strictEqual(GeocodingService.extractPrefCodeFromMuniCd(null), APP_CONFIG.DEFAULT_PREF_CODE);
  assert.strictEqual(GeocodingService.extractPrefCodeFromMuniCd(undefined), APP_CONFIG.DEFAULT_PREF_CODE);
  assert.strictEqual(GeocodingService.extractPrefCodeFromMuniCd(''), APP_CONFIG.DEFAULT_PREF_CODE);
  assert.strictEqual(GeocodingService.extractPrefCodeFromMuniCd('abcde'), APP_CONFIG.DEFAULT_PREF_CODE);
  assert.strictEqual(GeocodingService.extractPrefCodeFromMuniCd('99100'), APP_CONFIG.DEFAULT_PREF_CODE); // 99は都道府県コード外
});

test('GeocodingService: findPrefCodeFromText によるテキスト内都道府県判別', () => {
  assert.strictEqual(GeocodingService.findPrefCodeFromText('東京都千代田区霞が関'), '13');
  assert.strictEqual(GeocodingService.findPrefCodeFromText('北海道札幌市手稲区'), '01');
  assert.strictEqual(GeocodingService.findPrefCodeFromText('大阪府大阪市淀川区宮原'), '27');
  assert.strictEqual(GeocodingService.findPrefCodeFromText('広島県広島市安佐南区八木'), '34');
  assert.strictEqual(GeocodingService.findPrefCodeFromText('静岡県静岡市清水区三保'), '22');

  // 該当なし
  assert.strictEqual(GeocodingService.findPrefCodeFromText('海外または都道府県名のない文字列'), null);
  assert.strictEqual(GeocodingService.findPrefCodeFromText(''), null);
  assert.strictEqual(GeocodingService.findPrefCodeFromText(null), null);
});

test('GeocodingService: reverseGeocodePrefCode の正常系とモック通信', async () => {
  const originalFetch = globalThis.fetch;

  try {
    // 正常系モック: 北海道 (01100)
    globalThis.fetch = async (url) => {
      assert.ok(url.includes('mreversegeocoder'));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: {
            muniCd: '01100',
            lv01Nm: '手稲本町'
          }
        })
      };
    };

    const prefCode = await GeocodingService.reverseGeocodePrefCode(43.1180, 141.2250);
    assert.strictEqual(prefCode, '01');

    // 異常系モック: API 500エラー時のフォールバック
    globalThis.fetch = async () => ({
      ok: false,
      status: 500
    });

    const fallbackCode = await GeocodingService.reverseGeocodePrefCode(34.72, 135.49);
    assert.strictEqual(fallbackCode, APP_CONFIG.DEFAULT_PREF_CODE);

    // 異常系モック: 通信例外発生時のフォールバック
    globalThis.fetch = async () => {
      throw new Error('Network unreachable');
    };

    const exCode = await GeocodingService.reverseGeocodePrefCode(34.72, 135.49);
    assert.strictEqual(exCode, APP_CONFIG.DEFAULT_PREF_CODE);

  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GeocodingService: normalizeQuery によるクエリ正規化', () => {
  // 全角英数・スペース
  assert.strictEqual(GeocodingService.normalizeQuery('新宿　駅'), '新宿 駅');
  assert.strictEqual(GeocodingService.normalizeQuery('　　東京タワー　　'), '東京タワー');
  assert.strictEqual(GeocodingService.normalizeQuery('１２３ＡＢＣ'), '123ABC');
  assert.strictEqual(GeocodingService.normalizeQuery('六本木１丁目'), '六本木1丁目');

  // 空文字・異常値
  assert.strictEqual(GeocodingService.normalizeQuery(''), '');
  assert.strictEqual(GeocodingService.normalizeQuery(null), '');
  assert.strictEqual(GeocodingService.normalizeQuery(undefined), '');
});

test('GeocodingService: search による新宿駅ハイブリッド検索とスマートリランキング (AC-9.1)', async () => {
  const originalFetch = globalThis.fetch;

  try {
    // GSIは山形県朝日町新宿を返し、OSMは東京都新宿区の新宿駅を返すモック
    globalThis.fetch = async (url) => {
      if (url.includes('msearch')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              geometry: { coordinates: [140.2312, 38.3145] },
              properties: { title: '山形県西村山郡朝日町新宿' }
            }
          ]
        };
      }

      if (url.includes('nominatim')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              osm_type: 'node',
              osm_id: 123456,
              lat: '35.690921',
              lon: '139.700258',
              name: '新宿駅',
              display_name: '新宿駅, 新宿区, 東京都, 日本',
              importance: 0.85
            }
          ]
        };
      }

      return { ok: false, status: 404 };
    };

    // 東京中心 (35.68, 139.76) からの検索
    const candidates = await GeocodingService.search('新宿駅', {
      centerLat: 35.68,
      centerLng: 139.76
    });

    assert.ok(candidates.length >= 2, '候補が複数取得できていること');

    // 第1候補が東京都新宿区の新宿駅であること（山形県朝日町ではないこと）
    const top = candidates[0];
    assert.strictEqual(top.title, '新宿駅');
    assert.ok(top.address.includes('東京都') || top.address.includes('新宿区'));
    assert.strictEqual(top.source, 'osm');
    assert.strictEqual(top.lat, 35.690921);
    assert.strictEqual(top.lng, 139.700258);
    assert.strictEqual(top.prefCode, '13');
    assert.strictEqual(top.isHighConfidence, true, '完全一致かつ高スコアで高確度判定');

    // 山形県朝日町新宿は2位以下であり、スコアが大幅に低いこと
    const yamagataCandidate = candidates.find(c => c.address.includes('山形県'));
    assert.ok(yamagataCandidate, '山形県の候補が存在すること');
    assert.ok(top.score > yamagataCandidate.score, '新宿駅のスコアが山形県朝日町新宿を上回ること');

  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GeocodingService: 距離バイアスによる同名候補のリランキング', async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async (url) => {
      if (url.includes('msearch')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              geometry: { coordinates: [141.35, 43.06] }, // 札幌
              properties: { title: '北海道札幌市中央区本町' }
            },
            {
              geometry: { coordinates: [139.70, 35.65] }, // 渋谷
              properties: { title: '東京都渋谷区本町' }
            }
          ]
        };
      }
      if (url.includes('nominatim')) {
        return {
          ok: true,
          status: 200,
          json: async () => []
        };
      }
      return { ok: false, status: 404 };
    };

    // 東京中心 (35.68, 139.76) から「本町」を検索 -> 渋谷区本町が上位
    const tokyoSearch = await GeocodingService.search('本町', {
      centerLat: 35.68,
      centerLng: 139.76
    });

    assert.ok(tokyoSearch.length >= 2);
    assert.strictEqual(tokyoSearch[0].title, '東京都渋谷区本町');
    assert.ok(tokyoSearch[0].score > tokyoSearch[1].score);

    // 札幌中心 (43.06, 141.35) から「本町」を検索 -> 札幌市本町が上位
    const sapporoSearch = await GeocodingService.search('本町', {
      centerLat: 43.06,
      centerLng: 141.35
    });

    assert.ok(sapporoSearch.length >= 2);
    assert.strictEqual(sapporoSearch[0].title, '北海道札幌市中央区本町');
    assert.ok(sapporoSearch[0].score > sapporoSearch[1].score);

  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GeocodingService: 耐障害性（片肺運転の保証）', async () => {
  const originalFetch = globalThis.fetch;

  try {
    // ケース1: GSIが500エラー、OSMが正常
    globalThis.fetch = async (url) => {
      if (url.includes('msearch')) {
        return { ok: false, status: 500 };
      }
      if (url.includes('nominatim')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              osm_type: 'node',
              osm_id: 999,
              lat: '35.658581',
              lon: '139.745433',
              name: '東京タワー',
              display_name: '東京タワー, 港区, 東京都, 日本',
              importance: 0.9
            }
          ]
        };
      }
      return { ok: false, status: 404 };
    };

    const candidatesOsmOnly = await GeocodingService.search('東京タワー');
    assert.strictEqual(candidatesOsmOnly.length, 1);
    assert.strictEqual(candidatesOsmOnly[0].title, '東京タワー');
    assert.strictEqual(candidatesOsmOnly[0].source, 'osm');

    // ケース2: OSMが例外スロー（ネットワーク切断）、GSIが正常
    globalThis.fetch = async (url) => {
      if (url.includes('msearch')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              geometry: { coordinates: [135.49736, 34.72631] },
              properties: { title: '大阪府大阪市淀川区西中島' }
            }
          ]
        };
      }
      if (url.includes('nominatim')) {
        throw new Error('OSM connection timeout');
      }
      return { ok: false, status: 404 };
    };

    const candidatesGsiOnly = await GeocodingService.search('西中島');
    assert.strictEqual(candidatesGsiOnly.length, 1);
    assert.strictEqual(candidatesGsiOnly[0].title, '大阪府大阪市淀川区西中島');
    assert.strictEqual(candidatesGsiOnly[0].source, 'gsi');

    // ケース3: 両APIとも空結果
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => []
    });

    const emptyResult = await GeocodingService.search('zzxyy9999');
    assert.deepStrictEqual(emptyResult, []);

    // ケース4: 入力が空文字
    assert.deepStrictEqual(await GeocodingService.search(''), []);
    assert.deepStrictEqual(await GeocodingService.search(null), []);

  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GeocodingService: 後方互換メソッド geocode の動作確認', async () => {
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
              properties: { title: '大阪府大阪市淀川区西中島' }
            }
          ]
        };
      }
      if (url.includes('nominatim')) {
        return {
          ok: true,
          status: 200,
          json: async () => []
        };
      }
      return { ok: false, status: 404 };
    };

    const result = await GeocodingService.geocode('新大阪');
    assert.ok(result !== null);
    assert.strictEqual(result.lat, 34.72631);
    assert.strictEqual(result.lng, 135.49736);
    assert.strictEqual(result.title, '大阪府大阪市淀川区西中島');
    assert.strictEqual(result.prefCode, '27');

    // ヒットなし
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => []
    });

    const noHit = await GeocodingService.geocode('存在しない地名xyz');
    assert.strictEqual(noHit, null);

    // 空文字入力
    assert.strictEqual(await GeocodingService.geocode(''), null);
    assert.strictEqual(await GeocodingService.geocode('   '), null);
    assert.strictEqual(await GeocodingService.geocode(null), null);

  } finally {
    globalThis.fetch = originalFetch;
  }
});
