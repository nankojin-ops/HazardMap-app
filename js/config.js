/**
 * @file config.js
 * @description アプリケーション全体で使用する共通設定、定数、URLテンプレート、マッピングを定義するモジュール
 */

export const APP_CONFIG = Object.freeze({
  /** 徒歩移動速度 (メートル/分) - 不動産表記基準 80m/分 */
  WALKING_SPEED_MPM: 80,

  /** 道なり推定迂回係数 (直線距離に対する倍率) */
  CIRCUITY_FACTOR: 1.25,

  /** デフォルト初期緯度 (新大阪駅周辺) */
  DEFAULT_LAT: 34.72631588753036,

  /** デフォルト初期経度 (新大阪駅周辺) */
  DEFAULT_LNG: 135.49736241752382,

  /** デフォルト初期ズームレベル */
  DEFAULT_ZOOM: 14,

  /** デフォルト都道府県コード (大阪府: 27) */
  DEFAULT_PREF_CODE: '27',

  /** 周辺避難所の最大検索半径 (km) */
  MAX_SEARCH_RADIUS_KM: 5,

  /** リスト表示する最大避難所件数 */
  MAX_SHELTER_DISPLAY_COUNT: 50,

  /** タイルURLテンプレート定義 */
  TILE_URLS: Object.freeze({
    // 国土地理院 標準地図タイル
    std: 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',
    // 国土地理院 洪水浸水想定区域（想定最大規模・浸水深）
    flood: 'https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png',
    // 国土地理院 土砂災害警戒区域（土石流）都道府県別
    sediment: 'https://disaportaldata.gsi.go.jp/raster/05_dosekiryukeikaikuiki_data/{pref}/{z}/{x}/{y}.png',
    // 国土地理院 津波浸水想定 都道府県別
    tsunami: 'https://disaportaldata.gsi.go.jp/raster/04_tsunami_newlegend_pref_data/{pref}/{z}/{x}/{y}.png',
    // 国土地理院 指定緊急避難場所 GeoJSON タイル (Zoom 10固定)
    shelterGeoJson: 'https://cyberjapandata.gsi.go.jp/xyz/{code}/10/{x}/{y}.geojson'
  }),

  /** 国土地理院 外部APIエンドポイント */
  API_ENDPOINTS: Object.freeze({
    // 逆ジオコーダAPI (LonLatToAddress)
    reverseGeocode: 'https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress',
    // 住所検索API (AddressSearch)
    addressSearch: 'https://msearch.gsi.go.jp/address-search/AddressSearch'
  }),

  /** 指定緊急避難場所の災害種別コード一覧 (6種別) */
  HAZARD_CATEGORIES: Object.freeze([
    { type: '洪水', code: 'skhb01' },
    { type: '土砂', code: 'skhb02' },
    { type: '高潮', code: 'skhb03' },
    { type: '地震', code: 'skhb04' },
    { type: '津波', code: 'skhb05' },
    { type: '火事', code: 'skhb06' }
  ]),

  /** 都道府県名からJIS都道府県コード(2桁文字列)へのマッピング */
  PREFECTURE_CODE_MAP: Object.freeze({
    '北海道': '01', '青森県': '02', '岩手県': '03', '宮城県': '04', '秋田県': '05',
    '山形県': '06', '福島県': '07', '茨城県': '08', '栃木県': '09', '群馬県': '10',
    '埼玉県': '11', '千葉県': '12', '東京都': '13', '神奈川県': '14', '新潟県': '15',
    '富山県': '16', '石川県': '17', '福井県': '18', '山梨県': '19', '長野県': '20',
    '岐阜県': '21', '静岡県': '22', '愛知県': '23', '三重県': '24', '滋賀県': '25',
    '京都府': '26', '大阪府': '27', '兵庫県': '28', '奈良県': '29', '和歌山県': '30',
    '鳥取県': '31', '島根県': '32', '岡山県': '33', '広島県': '34', '山口県': '35',
    '徳島県': '36', '香川県': '37', '愛媛県': '38', '高知県': '39', '福岡県': '40',
    '佐賀県': '41', '長崎県': '42', '熊本県': '43', '大分県': '44', '宮崎県': '45',
    '鹿児島県': '46', '沖縄県': '47'
  }),

  /** 福祉避難所・要配慮者向け施設と判定するためのキーワード一覧 */
  WELFARE_KEYWORDS: Object.freeze([
    '福祉', '介護', '特別養護', '養護', 'デイサービス', 'ケアセンター',
    '障害', '障がい', '老健', '老人保健', 'グループホーム', '老人ホーム',
    '養護老人ホーム', '支援学校'
  ]),

  /** 動作確認・デモ用サンプル地点定義 */
  SAMPLE_LOCATIONS: Object.freeze([
    {
      name: '大阪淀川 (洪水)',
      lat: 34.7130,
      lng: 135.4880,
      activeHazard: 'flood',
      prefCode: '27',
      icon: 'fa-water',
      bgClass: 'bg-blue-50 hover:bg-blue-100',
      borderClass: 'border-blue-300',
      textClass: 'text-blue-800'
    },
    {
      name: '北海道札幌 (土砂)',
      lat: 43.1180,
      lng: 141.2250,
      activeHazard: 'sediment',
      prefCode: '01',
      icon: 'fa-mountain',
      bgClass: 'bg-amber-50 hover:bg-amber-100',
      borderClass: 'border-amber-300',
      textClass: 'text-amber-800'
    },
    {
      name: '広島八木 (土砂)',
      lat: 34.4600,
      lng: 132.4830,
      activeHazard: 'sediment',
      prefCode: '34',
      icon: 'fa-mountain',
      bgClass: 'bg-amber-50 hover:bg-amber-100',
      borderClass: 'border-amber-300',
      textClass: 'text-amber-800'
    },
    {
      name: '静岡三保 (津波)',
      lat: 34.9960,
      lng: 138.5220,
      activeHazard: 'tsunami',
      prefCode: '22',
      icon: 'fa-house-tsunami',
      bgClass: 'bg-purple-50 hover:bg-purple-100',
      borderClass: 'border-purple-300',
      textClass: 'text-purple-800'
    }
  ])
});
