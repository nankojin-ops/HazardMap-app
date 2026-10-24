/**
 * @file geocoding.test.js
 * @description GeocodingService のコード抽出ロジック、逆ジオコーダ連携、住所検索連携を検証するテスト
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

test('GeocodingService: geocode の正常系・異常系パース', async () => {
  const originalFetch = globalThis.fetch;

  try {
    // 正常系モック: 新大阪駅検索
    globalThis.fetch = async (url) => {
      assert.ok(url.includes('msearch'));
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            geometry: {
              coordinates: [135.49736, 34.72631] // GeoJSON [lng, lat]
            },
            properties: {
              title: '大阪府大阪市淀川区西中島'
            }
          }
        ]
      };
    };

    const result = await GeocodingService.geocode('新大阪');
    assert.ok(result !== null);
    assert.strictEqual(result.lat, 34.72631);
    assert.strictEqual(result.lng, 135.49736);
    assert.strictEqual(result.title, '大阪府大阪市淀川区西中島');
    assert.strictEqual(result.prefCode, '27');

    // ヒットなしモック: 空配列
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => []
    });

    const noHit = await GeocodingService.geocode('存在しない地名xyz');
    assert.strictEqual(noHit, null);

    // 入力空文字テスト
    assert.strictEqual(await GeocodingService.geocode(''), null);
    assert.strictEqual(await GeocodingService.geocode('   '), null);
    assert.strictEqual(await GeocodingService.geocode(null), null);

  } finally {
    globalThis.fetch = originalFetch;
  }
});
