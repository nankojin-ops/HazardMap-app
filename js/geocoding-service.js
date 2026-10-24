/**
 * @file geocoding-service.js
 * @description 国土地理院住所検索APIおよびOSM Nominatim APIと連携し、ハイブリッド住所・ランドマーク検索、
 * スマートリランキング、座標変換、逆ジオコーディングを提供するモジュール
 */

import { APP_CONFIG } from './config.js';

export class GeocodingService {
  /** 主要都市（政令指定都市・県庁所在地・東京23区）キーワード一覧 */
  static MAJOR_CITIES = Object.freeze([
    // 政令指定都市
    '札幌市', '仙台市', 'さいたま市', '千葉市', '横浜市', '川崎市', '相模原市',
    '新潟市', '静岡市', '浜松市', '名古屋市', '京都市', '大阪市', '堺市',
    '神戸市', '岡山市', '広島市', '北九州市', '福岡市', '熊本市',
    // 東京23区
    '千代田区', '中央区', '港区', '新宿区', '文京区', '台東区', '墨田区',
    '江東区', '品川区', '目黒区', '大田区', '世田谷区', '渋谷区', '中野区',
    '杉並区', '豊島区', '北区', '荒川区', '板橋区', '練馬区', '足立区',
    '葛飾区', '江戸川区',
    // その他県庁所在地
    '青森市', '盛岡市', '秋田市', '山形市', '福島市', '水戸市', '宇都宮市',
    '前橋市', '甲府市', '長野市', '富山市', '金沢市', '福井市', '岐阜市',
    '津市', '大津市', '奈良市', '和歌山市', '鳥取市', '松江市', '徳島市',
    '高松市', '松山市', '高知市', '佐賀市', '長崎市', '大分市', '宮崎市',
    '鹿児島市', '那覇市'
  ]);

  /**
   * クエリ文字列からスコアリング・ソート済みの候補リストを取得する
   * @param {string} query - 検索クエリ文字列
   * @param {Object} [options={}] - 検索オプション
   * @param {number} [options.centerLat] - 中心緯度
   * @param {number} [options.centerLng] - 中心経度
   * @param {number} [options.maxResults] - 最大候補数
   * @param {boolean} [options.enableFallback=true] - OSM補完検索の有効フラグ
   * @returns {Promise<Array<Object>>} ソート済み候補リスト (0件時は空配列)
   */
  static async search(query, options = {}) {
    if (!query || typeof query !== 'string') {
      return [];
    }

    const normalizedQuery = this.normalizeQuery(query);
    if (!normalizedQuery) {
      return [];
    }

    const maxResults = options.maxResults || APP_CONFIG.SEARCH_CONFIG.MAX_CANDIDATES;
    const centerLat = typeof options.centerLat === 'number' && !isNaN(options.centerLat) ? options.centerLat : null;
    const centerLng = typeof options.centerLng === 'number' && !isNaN(options.centerLng) ? options.centerLng : null;
    const enableFallback = options.enableFallback !== false;

    // 国土地理院住所検索API URL
    const gsiUrl = `${APP_CONFIG.API_ENDPOINTS.addressSearch}?q=${encodeURIComponent(normalizedQuery)}`;

    // OSM Nominatim API URL (日本国内限定、5件、JSON形式)
    const osmUrl = `${APP_CONFIG.API_ENDPOINTS.osmSearch}?q=${encodeURIComponent(normalizedQuery)}&countrycodes=jp&limit=5&format=json&addressdetails=1`;

    const fetchPromises = [
      this.fetchGsiCandidates(gsiUrl, normalizedQuery)
    ];

    if (enableFallback) {
      fetchPromises.push(this.fetchOsmCandidates(osmUrl, normalizedQuery));
    }

    // 片肺運転を保証するため Promise.allSettled で並行取得
    const results = await Promise.allSettled(fetchPromises);

    const rawCandidates = [];

    // GSI結果の収集
    if (results[0].status === 'fulfilled' && Array.isArray(results[0].value)) {
      rawCandidates.push(...results[0].value);
    } else if (results[0].status === 'rejected') {
      console.warn('国土地理院住所検索API取得失敗:', results[0].reason);
    }

    // OSM結果の収集
    if (enableFallback && results[1]) {
      if (results[1].status === 'fulfilled' && Array.isArray(results[1].value)) {
        rawCandidates.push(...results[1].value);
      } else if (results[1].status === 'rejected') {
        console.warn('OSM Nominatim検索API取得失敗:', results[1].reason);
      }
    }

    if (rawCandidates.length === 0) {
      return [];
    }

    // 重複候補の統合（近接座標かつ類似名称）
    const mergedCandidates = this.mergeDuplicateCandidates(rawCandidates);

    // スコアリングとソート
    const scoredCandidates = mergedCandidates.map((candidate) => {
      const { score, distanceKm, isHighConfidence } = this.calculateCandidateScore(
        candidate,
        normalizedQuery,
        centerLat,
        centerLng
      );

      return {
        id: candidate.id,
        title: candidate.title,
        address: candidate.address,
        lat: candidate.lat,
        lng: candidate.lng,
        prefCode: candidate.prefCode || this.findPrefCodeFromText(candidate.address || candidate.title) || APP_CONFIG.DEFAULT_PREF_CODE,
        source: candidate.source,
        distanceKm,
        score,
        isHighConfidence
      };
    });

    // 総合スコア降順でソート
    scoredCandidates.sort((a, b) => b.score - a.score);

    return scoredCandidates.slice(0, maxResults);
  }

  /**
   * 後方互換メソッド: 最上位候補1件を返却する
   * @param {string} address - 検索クエリ
   * @returns {Promise<{ lat: number, lng: number, title: string, prefCode: string } | null>}
   */
  static async geocode(address) {
    if (!address || typeof address !== 'string' || address.trim() === '') {
      return null;
    }

    try {
      const candidates = await this.search(address);
      if (!Array.isArray(candidates) || candidates.length === 0) {
        return null;
      }

      const top = candidates[0];
      let prefCode = top.prefCode;

      // 都道府県コードの未特定補完
      if (!prefCode || prefCode === APP_CONFIG.DEFAULT_PREF_CODE) {
        const detected = this.findPrefCodeFromText(top.address || top.title);
        if (detected) {
          prefCode = detected;
        } else {
          prefCode = await this.reverseGeocodePrefCode(top.lat, top.lng);
        }
      }

      return {
        lat: top.lat,
        lng: top.lng,
        title: top.title,
        prefCode: prefCode || APP_CONFIG.DEFAULT_PREF_CODE
      };
    } catch (error) {
      console.warn('GeocodingService.geocode 処理失敗:', error);
      return null;
    }
  }

  /**
   * 国土地理院住所検索APIから候補を取得・正規化する内部ヘルパー
   * @param {string} url
   * @param {string} query
   * @returns {Promise<Array<Object>>}
   */
  static async fetchGsiCandidates(url, query) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      if (!Array.isArray(data)) {
        return [];
      }

      const candidates = [];
      data.forEach((item, index) => {
        if (!item || !item.geometry || !Array.isArray(item.geometry.coordinates)) {
          return;
        }

        // GSIは GeoJSON [lng, lat]
        const [rawLng, rawLat] = item.geometry.coordinates;
        const lng = parseFloat(rawLng);
        const lat = parseFloat(rawLat);

        if (isNaN(lat) || isNaN(lng)) {
          return;
        }

        const title = item.properties?.title || query;
        const address = title;
        const prefCode = this.findPrefCodeFromText(address);

        candidates.push({
          id: `gsi_${index}_${lat.toFixed(4)}_${lng.toFixed(4)}`,
          title,
          address,
          lat,
          lng,
          prefCode,
          source: 'gsi',
          rawImportance: 0.5
        });
      });

      return candidates;
    } catch (error) {
      console.warn('GSI API fetch error:', error);
      return [];
    }
  }

  /**
   * OSM Nominatim APIから候補を取得・正規化する内部ヘルパー
   * @param {string} url
   * @param {string} query
   * @returns {Promise<Array<Object>>}
   */
  static async fetchOsmCandidates(url, query) {
    try {
      const fetchOptions = {};
      // Node.js 等の非ブラウザ環境では Nominatim 利用規約遵守のため User-Agent を明示設定 (403防止)
      if (typeof window === 'undefined') {
        fetchOptions.headers = {
          'User-Agent': 'HazardMap-App/1.0 (Disaster-Prevention-Map)'
        };
      }

      const response = await fetch(url, fetchOptions);
      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      if (!Array.isArray(data)) {
        return [];
      }

      const candidates = [];
      data.forEach((item, index) => {
        if (!item || !item.lat || !item.lon) {
          return;
        }

        const lat = parseFloat(item.lat);
        const lng = parseFloat(item.lon);

        if (isNaN(lat) || isNaN(lng)) {
          return;
        }

        // 名称と住所の整理 (セミコロン区切り出入口名等の主要部抽出: 例: "新宿駅;3番出入口" -> "新宿駅")
        const displayName = item.display_name || '';
        const rawName = item.name || displayName.split(',')[0].trim() || query;
        const name = rawName.split(';')[0].trim() || rawName;
        const address = displayName;
        const prefCode = this.findPrefCodeFromText(address);
        const rawImportance = typeof item.importance === 'number' ? item.importance : parseFloat(item.importance) || 0.5;

        candidates.push({
          id: `osm_${item.osm_type || 'node'}_${item.osm_id || index}`,
          title: name,
          address,
          lat,
          lng,
          prefCode,
          source: 'osm',
          rawImportance
        });
      });

      return candidates;
    } catch (error) {
      console.warn('OSM API fetch error:', error);
      return [];
    }
  }

  /**
   * 近接・重複候補のマージ
   * @param {Array<Object>} candidates
   * @returns {Array<Object>}
   */
  static mergeDuplicateCandidates(candidates) {
    const merged = [];

    for (const c of candidates) {
      const duplicateIndex = merged.findIndex((m) => {
        // 同一名称かつ近接座標 (500m以内) または 100m以内の近傍地点
        const dist = this.calculateDistanceKm(c.lat, c.lng, m.lat, m.lng);
        const isSameTitle = c.title === m.title || (c.title.includes(m.title) || m.title.includes(c.title));
        return (isSameTitle && dist < 0.5) || dist < 0.1;
      });

      if (duplicateIndex === -1) {
        merged.push(c);
      } else {
        // 重複時はOSMのPOI詳細度またはより長い住所文字列を持つ方を優先
        const existing = merged[duplicateIndex];
        if (c.source === 'osm' && existing.source === 'gsi') {
          // OSMのタイトル（施設名・駅名など）を優先しつつ住所をマージ
          merged[duplicateIndex] = {
            ...existing,
            title: c.title,
            address: c.address.length > existing.address.length ? c.address : existing.address,
            rawImportance: Math.max(c.rawImportance, existing.rawImportance)
          };
        }
      }
    }

    return merged;
  }

  /**
   * 候補単体の総合スコアを算出する
   * @param {Object} candidate - 候補オブジェクト
   * @param {string} normalizedQuery - 正規化済みクエリ
   * @param {number|null} centerLat - 中心緯度
   * @param {number|null} centerLng - 中心経度
   * @returns {{ score: number, distanceKm: number|null, isHighConfidence: boolean }}
   */
  static calculateCandidateScore(candidate, normalizedQuery, centerLat, centerLng) {
    const weights = APP_CONFIG.SEARCH_CONFIG.WEIGHTS;
    const normalizedTitle = this.normalizeQuery(candidate.title || '');
    const normalizedAddress = this.normalizeQuery(candidate.address || '');

    // 1. 文字列マッチ度スコア [0, 100]
    let matchScore = 0;

    // クエリの基本語（「駅」「タワー」等のサフィックス除外語）
    const baseQuery = normalizedQuery.replace(/(駅|タワー|城|空港|港|役所|病院|学校)$/, '').trim();

    if (normalizedTitle === normalizedQuery) {
      // 完全一致
      matchScore = 100;
    } else if (baseQuery && normalizedTitle === baseQuery) {
      // 基本語の完全一致
      matchScore = 85;
    } else if (normalizedTitle.includes(normalizedQuery) || normalizedQuery.includes(normalizedTitle)) {
      // タイトル同士の包含
      matchScore = 70;
    } else if (normalizedAddress.includes(normalizedQuery)) {
      // アドレスにクエリ全体が含まれる
      matchScore = 50;
    } else if (baseQuery && normalizedAddress.includes(baseQuery)) {
      // アドレスに基本語が含まれる
      matchScore = 40;
    } else {
      // 構成語の部分一致
      matchScore = 20;
    }

    // 都道府県・市区名の一致ボーナス
    const prefCodeInQuery = this.findPrefCodeFromText(normalizedQuery);
    if (prefCodeInQuery && (candidate.prefCode === prefCodeInQuery || normalizedAddress.includes(normalizedQuery.slice(0, 3)))) {
      matchScore = Math.min(100, matchScore + 15);
    }

    // 2. 行政階層・主要度スコア [0, 30]
    let hierarchyScore = 0;
    const isMajorCity = this.MAJOR_CITIES.some(city => normalizedAddress.includes(city) || normalizedTitle.includes(city));

    if (isMajorCity || /(政令|特別区)/.test(normalizedAddress)) {
      hierarchyScore = 30;
    } else if (/市/.test(normalizedAddress) || /市/.test(normalizedTitle)) {
      hierarchyScore = 20;
    } else if (/(町|村)/.test(normalizedAddress) || /(町|村)/.test(normalizedTitle)) {
      hierarchyScore = 10;
    } else {
      hierarchyScore = 0;
    }

    // 3. 知名度スコア [0, 20]
    const rawImportance = typeof candidate.rawImportance === 'number' ? candidate.rawImportance : 0.5;
    const importanceScore = Math.min(20, Math.max(0, rawImportance * 20));

    // 4. 距離ペナルティ [0, 15]
    let distanceKm = null;
    let distancePenalty = 0;

    if (typeof centerLat === 'number' && typeof centerLng === 'number') {
      const d = this.calculateDistanceKm(centerLat, centerLng, candidate.lat, candidate.lng);
      distanceKm = Math.round(d * 10) / 10;
      // 1000kmで最大ペナルティ幅
      distancePenalty = Math.min(d / 1000, 1.0) * weights.DISTANCE_PENALTY_MAX;
    }

    // 総合スコア算出
    const totalScore = (matchScore * weights.MATCH) +
                       (hierarchyScore * weights.HIERARCHY) +
                       (importanceScore * weights.IMPORTANCE) -
                       distancePenalty;

    const finalScore = Math.round(totalScore * 10) / 10;

    // 高確度判定 (完全一致かつ総合スコアが閾値以上)
    const isExactMatch = normalizedTitle === normalizedQuery;
    const isHighConfidence = isExactMatch && finalScore >= APP_CONFIG.SEARCH_CONFIG.HIGH_CONFIDENCE_THRESHOLD;

    return {
      score: finalScore,
      distanceKm,
      isHighConfidence
    };
  }

  /**
   * クエリ文字列の正規化（全角英数・スペースの半角化、余分な空白のトリム）
   * @param {string} text
   * @returns {string}
   */
  static normalizeQuery(text) {
    if (!text || typeof text !== 'string') {
      return '';
    }

    return text
      // 全角英数字を半角に変換
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
      // 全角ダッシュ・マイナス・ハイフン記号の統一（カタカナ長音記号「ー」は保持）
      .replace(/[―−‐－]/g, '-')
      // 全角スペースおよび連続スペースを単一半角スペースに統一
      .replace(/[\s\u3000]+/g, ' ')
      .trim();
  }

  /**
   * 2点間の大円距離 (km) を算出する (Haversine式)
   * @param {number} lat1
   * @param {number} lon1
   * @param {number} lat2
   * @param {number} lon2
   * @returns {number} 距離 (km)
   */
  static calculateDistanceKm(lat1, lon1, lat2, lon2) {
    if (lat1 === lat2 && lon1 === lon2) {
      return 0;
    }

    const R = 6371; // 地球平均半径 (km)
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * 緯度経度からJIS都道府県コード(2桁)を取得する（逆ジオコーディング）
   * @param {number} lat - 緯度
   * @param {number} lng - 経度
   * @returns {Promise<string>} JIS都道府県コード（例: "27"）。取得失敗時は DEFAULT_PREF_CODE
   */
  static async reverseGeocodePrefCode(lat, lng) {
    if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
      return APP_CONFIG.DEFAULT_PREF_CODE;
    }

    const url = `${APP_CONFIG.API_ENDPOINTS.reverseGeocode}?lat=${lat}&lon=${lng}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        return APP_CONFIG.DEFAULT_PREF_CODE;
      }

      const data = await response.json();
      const muniCd = data?.results?.muniCd;
      if (!muniCd) {
        return APP_CONFIG.DEFAULT_PREF_CODE;
      }

      return this.extractPrefCodeFromMuniCd(muniCd);
    } catch (error) {
      console.warn('逆ジオコーダ取得失敗、デフォルトコードを適用:', error);
      return APP_CONFIG.DEFAULT_PREF_CODE;
    }
  }

  /**
   * 全国地方公共団体コード(muniCd)からJIS都道府県コード(2桁)を抽出する
   * @param {string|number} muniCd - 5桁の市区町村コード (例: "27100")
   * @returns {string} 2桁コード (例: "27")
   */
  static extractPrefCodeFromMuniCd(muniCd) {
    if (muniCd === null || muniCd === undefined) {
      return APP_CONFIG.DEFAULT_PREF_CODE;
    }

    const rawStr = String(muniCd).trim();
    if (!rawStr) {
      return APP_CONFIG.DEFAULT_PREF_CODE;
    }

    // 5桁未満の場合は先頭ゼロ埋め (例: 1100 -> "01100")
    const padded = rawStr.padStart(5, '0');
    const prefPart = padded.substring(0, 2);

    const num = parseInt(prefPart, 10);
    if (!isNaN(num) && num >= 1 && num <= 47) {
      return prefPart;
    }

    return APP_CONFIG.DEFAULT_PREF_CODE;
  }

  /**
   * 住所や文字列から都道府県名を検出し、都道府県コード(2桁)を返す補助メソッド
   * @param {string} text - 対象テキスト
   * @returns {string | null} JIS都道府県コード(2桁)または null
   */
  static findPrefCodeFromText(text) {
    if (!text || typeof text !== 'string') {
      return null;
    }

    for (const [prefName, code] of Object.entries(APP_CONFIG.PREFECTURE_CODE_MAP)) {
      if (text.includes(prefName)) {
        return code;
      }
    }

    return null;
  }
}
