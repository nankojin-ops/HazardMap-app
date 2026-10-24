/**
 * @file config.test.js
 * @description APP_CONFIG 定数および設定オブジェクトの健全性・完全性を検証するテスト
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_CONFIG } from '../js/config.js';

test('APP_CONFIG: オブジェクトの凍結確認', () => {
  assert.ok(Object.isFrozen(APP_CONFIG), 'APP_CONFIGは凍結されている必要があります');
  assert.ok(Object.isFrozen(APP_CONFIG.TILE_URLS), 'TILE_URLSは凍結されている必要があります');
  assert.ok(Object.isFrozen(APP_CONFIG.API_ENDPOINTS), 'API_ENDPOINTSは凍結されている必要があります');
  assert.ok(Object.isFrozen(APP_CONFIG.HAZARD_CATEGORIES), 'HAZARD_CATEGORIESは凍結されている必要があります');
  assert.ok(Object.isFrozen(APP_CONFIG.PREFECTURE_CODE_MAP), 'PREFECTURE_CODE_MAPは凍結されている必要があります');
  assert.ok(Object.isFrozen(APP_CONFIG.WELFARE_KEYWORDS), 'WELFARE_KEYWORDSは凍結されている必要があります');
  assert.ok(Object.isFrozen(APP_CONFIG.SAMPLE_LOCATIONS), 'SAMPLE_LOCATIONSは凍結されている必要があります');
});

test('APP_CONFIG: 移動・距離計算パラメータの妥当性', () => {
  assert.strictEqual(APP_CONFIG.WALKING_SPEED_MPM, 80, '徒歩分速は不動産表記基準の80m/分である必要があります');
  assert.strictEqual(APP_CONFIG.CIRCUITY_FACTOR, 1.25, '道なり迂回係数は1.25である必要があります');
  assert.strictEqual(APP_CONFIG.MAX_SEARCH_RADIUS_KM, 5, '検索半径上限は5kmである必要があります');
  assert.strictEqual(APP_CONFIG.MAX_SHELTER_DISPLAY_COUNT, 50, '最大表示件数は50件である必要があります');
});

test('APP_CONFIG: 初期表示座標・ズーム・都道府県の妥当性', () => {
  assert.strictEqual(typeof APP_CONFIG.DEFAULT_LAT, 'number');
  assert.strictEqual(typeof APP_CONFIG.DEFAULT_LNG, 'number');
  assert.ok(APP_CONFIG.DEFAULT_LAT > 34.7 && APP_CONFIG.DEFAULT_LAT < 34.8, '新大阪駅周辺の緯度');
  assert.ok(APP_CONFIG.DEFAULT_LNG > 135.4 && APP_CONFIG.DEFAULT_LNG < 135.6, '新大阪駅周辺の経度');
  assert.strictEqual(APP_CONFIG.DEFAULT_ZOOM, 14);
  assert.strictEqual(APP_CONFIG.DEFAULT_PREF_CODE, '27', '大阪府コード27');
});

test('APP_CONFIG: タイルURLテンプレートのプレースホルダー検証', () => {
  const { std, flood, sediment, tsunami, shelterGeoJson } = APP_CONFIG.TILE_URLS;

  assert.ok(std.includes('{z}') && std.includes('{x}') && std.includes('{y}'));
  assert.ok(flood.includes('{z}') && flood.includes('{x}') && flood.includes('{y}'));
  assert.ok(sediment.includes('{pref}') && sediment.includes('{z}') && sediment.includes('{x}') && sediment.includes('{y}'));
  assert.ok(tsunami.includes('{pref}') && tsunami.includes('{z}') && tsunami.includes('{x}') && tsunami.includes('{y}'));
  assert.ok(shelterGeoJson.includes('{code}') && shelterGeoJson.includes('{x}') && shelterGeoJson.includes('{y}'));
});

test('APP_CONFIG: 災害種別カテゴリ一覧の検証 (6種別)', () => {
  assert.strictEqual(APP_CONFIG.HAZARD_CATEGORIES.length, 6);
  const codes = APP_CONFIG.HAZARD_CATEGORIES.map(c => c.code);
  assert.deepStrictEqual(codes, ['skhb01', 'skhb02', 'skhb03', 'skhb04', 'skhb05', 'skhb06']);

  const types = APP_CONFIG.HAZARD_CATEGORIES.map(c => c.type);
  assert.deepStrictEqual(types, ['洪水', '土砂', '高潮', '地震', '津波', '火事']);
});

test('APP_CONFIG: 47都道府県コードマッピングの網羅性検証', () => {
  const map = APP_CONFIG.PREFECTURE_CODE_MAP;
  assert.strictEqual(Object.keys(map).length, 47, '47都道府県すべてが網羅されている必要があります');
  assert.strictEqual(map['北海道'], '01');
  assert.strictEqual(map['東京都'], '13');
  assert.strictEqual(map['愛知県'], '23');
  assert.strictEqual(map['大阪府'], '27');
  assert.strictEqual(map['沖縄県'], '47');

  for (const [pref, code] of Object.entries(map)) {
    assert.strictEqual(typeof code, 'string');
    assert.strictEqual(code.length, 2, `${pref} のコードは2桁文字列である必要があります`);
    const num = parseInt(code, 10);
    assert.ok(num >= 1 && num <= 47, `${pref} のコード数値範囲`);
  }
});

test('APP_CONFIG: 福祉キーワードの存在確認', () => {
  assert.ok(Array.isArray(APP_CONFIG.WELFARE_KEYWORDS));
  assert.ok(APP_CONFIG.WELFARE_KEYWORDS.length >= 10);
  assert.ok(APP_CONFIG.WELFARE_KEYWORDS.includes('福祉'));
  assert.ok(APP_CONFIG.WELFARE_KEYWORDS.includes('介護'));
  assert.ok(APP_CONFIG.WELFARE_KEYWORDS.includes('デイサービス'));
  assert.ok(APP_CONFIG.WELFARE_KEYWORDS.includes('老健'));
});

test('APP_CONFIG: サンプル地点の定義検証 (4地点)', () => {
  assert.strictEqual(APP_CONFIG.SAMPLE_LOCATIONS.length, 4);
  for (const sample of APP_CONFIG.SAMPLE_LOCATIONS) {
    assert.ok(sample.name, 'nameが存在すること');
    assert.strictEqual(typeof sample.lat, 'number');
    assert.strictEqual(typeof sample.lng, 'number');
    assert.ok(['flood', 'sediment', 'tsunami'].includes(sample.activeHazard));
    assert.strictEqual(typeof sample.prefCode, 'string');
    assert.strictEqual(sample.prefCode.length, 2);
  }
});
