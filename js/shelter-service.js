/**
 * @file shelter-service.js
 * @description 国土地理院の指定緊急避難場所GeoJSONタイルを取得し、重複マージ、距離・徒歩時間の計算、福祉避難所判定、ソートを行うモジュール
 */

import { APP_CONFIG } from './config.js';

export class ShelterService {
  /**
   * タイルGeoJSONフィーチャのインメモリキャッシュ
   * @type {Map<string, Array<Object>>}
   */
  static _cache = new Map();

  /**
   * 指定座標の周辺指定緊急避難場所を取得・計算・ソートして返却する
   * @param {number} userLat - 中心緯度
   * @param {number} userLng - 中心経度
   * @param {number} [maxRadiusKm=APP_CONFIG.MAX_SEARCH_RADIUS_KM] - 検索半径上限(km)
   * @returns {Promise<Array<Object>>} 徒歩所要時間昇順の避難所データリスト (最大50件)
   */
  static async getNearbyShelters(userLat, userLng, maxRadiusKm = APP_CONFIG.MAX_SEARCH_RADIUS_KM) {
    if (typeof userLat !== 'number' || typeof userLng !== 'number' || isNaN(userLat) || isNaN(userLng)) {
      return [];
    }

    // Zoom 10 における中心タイルの計算
    const centerTile = this.getTileCoordinate(userLat, userLng, 10);

    // 中心＋周囲8タイルの計9タイル × 6種別 = 54リクエストのURLと種別マッピングを構築
    const requestList = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const tileX = centerTile.x + dx;
        const tileY = centerTile.y + dy;

        for (const cat of APP_CONFIG.HAZARD_CATEGORIES) {
          const url = APP_CONFIG.TILE_URLS.shelterGeoJson
            .replace('{code}', cat.code)
            .replace('{x}', String(tileX))
            .replace('{y}', String(tileY));

          requestList.push({ url, categoryName: cat.type });
        }
      }
    }

    // Promise.allSettled で全54リクエストを並行実行
    const results = await Promise.allSettled(
      requestList.map(req =>
        this.fetchTileFeatures(req.url).then(features => ({
          features,
          categoryName: req.categoryName
        }))
      )
    );

    // 避難所の重複統合用マップ (キー: 名称_緯度5桁_経度5桁)
    const shelterMap = new Map();

    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value) {
        continue;
      }

      const { features, categoryName } = result.value;
      if (!Array.isArray(features)) {
        continue;
      }

      for (const feature of features) {
        if (!feature || !feature.geometry) {
          continue;
        }

        const coords = this.parseFeatureCoordinates(feature.geometry);
        if (!coords) {
          continue;
        }

        const { lat, lng } = coords;
        const directDist = this.calculateDistanceKm(userLat, userLng, lat, lng);

        // 検索半径外はスキップ
        if (directDist > maxRadiusKm) {
          continue;
        }

        const props = feature.properties || {};
        const name = (props.name || props['施設・場所名'] || '無名避難場所').trim();
        const address = (props.address || props['所在地'] || '').trim();

        // 座標5桁精度（約1.1m）でグループ化キーを作成
        const key = `${name}_${lat.toFixed(5)}_${lng.toFixed(5)}`;

        if (shelterMap.has(key)) {
          const existing = shelterMap.get(key);
          if (!existing.categories.includes(categoryName)) {
            existing.categories.push(categoryName);
          }
          // propertiesの補足を必要に応じてマージ
          if (!existing.isWelfare && this.checkIsWelfare(props, name)) {
            existing.isWelfare = true;
          }
        } else {
          const isWelfare = this.checkIsWelfare(props, name);
          shelterMap.set(key, {
            name,
            address,
            lat,
            lng,
            directDistanceRaw: directDist,
            categories: [categoryName],
            isWelfare,
            rawProps: props
          });
        }
      }
    }

    // 距離・徒歩時間の計算とフォーマット
    const shelterList = [];
    for (const item of shelterMap.values()) {
      // 直線距離 (km, 小数第2位)
      const directDistance = Math.round(item.directDistanceRaw * 100) / 100;

      // 推定道なり距離 (km, 小数第2位): 直線距離 × 迂回係数 1.25
      const walkingDistance = Math.round(item.directDistanceRaw * APP_CONFIG.CIRCUITY_FACTOR * 100) / 100;

      // 推定徒歩所要時間 (分): 80m/分、分単位切り上げ
      const walkingMeters = item.directDistanceRaw * APP_CONFIG.CIRCUITY_FACTOR * 1000;
      const walkingMinutes = Math.max(1, Math.ceil(walkingMeters / APP_CONFIG.WALKING_SPEED_MPM));

      const targetNote = item.isWelfare
        ? '要介護者・要配慮者優先（福祉避難所等）'
        : '一般避難者対象';

      const category = `${item.categories.join('・')} 対応`;

      shelterList.push({
        name: item.name,
        address: item.address,
        lat: item.lat,
        lng: item.lng,
        directDistance,
        walkingDistance,
        walkingMinutes,
        category,
        categories: item.categories,
        isWelfare: item.isWelfare,
        targetNote
      });
    }

    // 徒歩所要時間昇順（同一所要時間の場合は徒歩距離昇順）でソート
    shelterList.sort((a, b) => {
      if (a.walkingMinutes !== b.walkingMinutes) {
        return a.walkingMinutes - b.walkingMinutes;
      }
      return a.walkingDistance - b.walkingDistance;
    });

    // 最大表示件数（50件）にスライス
    return shelterList.slice(0, APP_CONFIG.MAX_SHELTER_DISPLAY_COUNT);
  }

  /**
   * 緯度経度とズームレベルから国土地理院タイル座標 (X, Y) を算出する
   * @param {number} lat - 緯度
   * @param {number} lng - 経度
   * @param {number} zoom - ズームレベル (避難所タイルは固定で 10)
   * @returns {{ x: number, y: number, z: number }}
   */
  static getTileCoordinate(lat, lng, zoom) {
    const n = Math.pow(2, zoom);
    const x = Math.floor(((lng + 180) / 360) * n);
    const latRad = (lat * Math.PI) / 180;
    const y = Math.floor(
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
    );
    return { x, y, z: zoom };
  }

  /**
   * 2地点間の大円距離 (Haversine式) を計算する
   * @param {number} lat1 - 地点1緯度
   * @param {number} lon1 - 地点1経度
   * @param {number} lat2 - 地点2緯度
   * @param {number} lon2 - 地点2経度
   * @returns {number} 直線距離 (km)
   */
  static calculateDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // 地球半径 (km)
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const radLat1 = (lat1 * Math.PI) / 180;
    const radLat2 = (lat2 * Math.PI) / 180;

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(radLat1) * Math.cos(radLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * GeoJSON Featureのgeometryから緯度・経度を安全にパースする
   * @param {Object} geometry - GeoJSON geometry オブジェクト
   * @returns {{ lat: number, lng: number } | null}
   */
  static parseFeatureCoordinates(geometry) {
    if (!geometry || !geometry.type || !geometry.coordinates) {
      return null;
    }

    if (geometry.type === 'Point' && Array.isArray(geometry.coordinates)) {
      const [lng, lat] = geometry.coordinates;
      if (typeof lat === 'number' && typeof lng === 'number' && !isNaN(lat) && !isNaN(lng)) {
        return { lat, lng };
      }
    } else if (
      (geometry.type === 'Polygon' || geometry.type === 'MultiPoint') &&
      Array.isArray(geometry.coordinates) &&
      geometry.coordinates.length > 0
    ) {
      // 最初の頂点座標を代表点として取得
      const firstCoord = geometry.coordinates[0];
      if (Array.isArray(firstCoord) && firstCoord.length >= 2) {
        const lng = typeof firstCoord[0] === 'number' ? firstCoord[0] : firstCoord[0][0];
        const lat = typeof firstCoord[1] === 'number' ? firstCoord[1] : firstCoord[0][1];
        if (typeof lat === 'number' && typeof lng === 'number' && !isNaN(lat) && !isNaN(lng)) {
          return { lat, lng };
        }
      }
    }

    return null;
  }

  /**
   * 避難所フィーチャが福祉避難所・要配慮者向けであるかを判定する
   * @param {Object} props - Feature properties
   * @param {string} name - 避難所名称
   * @returns {boolean} 福祉避難所の場合 true
   */
  static checkIsWelfare(props, name) {
    if (!props) {
      props = {};
    }

    // 1. プロパティによる判定 (welfare, is_welfare)
    const welfareVal = props.welfare !== undefined ? props.welfare : props.is_welfare;
    if (welfareVal === '1' || welfareVal === 1 || welfareVal === true || welfareVal === 'true') {
      return true;
    }

    // 2. 備考や対象者属性文字列の確認
    const remarks = String(props.remarks || props['備考'] || props.target || props['対象'] || '');
    for (const keyword of APP_CONFIG.WELFARE_KEYWORDS) {
      if (remarks.includes(keyword)) {
        return true;
      }
    }

    // 3. 避難所名称に含まれるキーワード判定
    if (name && typeof name === 'string') {
      for (const keyword of APP_CONFIG.WELFARE_KEYWORDS) {
        if (name.includes(keyword)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * 単一のタイルGeoJSONを非同期取得する（キャッシュ対応・404許容）
   * @param {string} url - タイルURL
   * @returns {Promise<Array<Object>>} フィーチャ配列（存在しない場合は空配列）
   */
  static async fetchTileFeatures(url) {
    if (this._cache.has(url)) {
      return this._cache.get(url);
    }

    try {
      const response = await fetch(url);

      // 国土地理院タイルは避難所が存在しない地域で 404 Not Found を返す（正常系）
      if (response.status === 404) {
        this._cache.set(url, []);
        return [];
      }

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      const features = Array.isArray(data?.features) ? data.features : [];
      this._cache.set(url, features);
      return features;
    } catch (error) {
      // ネットワーク切断やパース失敗時も処理を止めずに空配列を返す
      return [];
    }
  }

  /**
   * インメモリキャッシュを全クリアする
   */
  static clearCache() {
    this._cache.clear();
  }
}
