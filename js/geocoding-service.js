/**
 * @file geocoding-service.js
 * @description 国土地理院の住所検索APIおよび逆ジオコーダAPIと通信し、住所から座標への変換、および座標からJIS都道府県コードへの変換を行うモジュール
 */

import { APP_CONFIG } from './config.js';

export class GeocodingService {
  /**
   * 住所・ランドマーク名から座標および都道府県コードを取得する
   * @param {string} address - 検索クエリ文字列
   * @returns {Promise<{ lat: number, lng: number, title: string, prefCode: string } | null>} 検索結果、未検出時は null
   */
  static async geocode(address) {
    if (!address || typeof address !== 'string' || address.trim() === '') {
      return null;
    }

    const trimmed = address.trim();
    const url = `${APP_CONFIG.API_ENDPOINTS.addressSearch}?q=${encodeURIComponent(trimmed)}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`住所検索APIエラー: HTTP ${response.status}`);
        return null;
      }

      const data = await response.json();
      if (!Array.isArray(data) || data.length === 0) {
        return null;
      }

      const firstHit = data[0];
      if (!firstHit.geometry || !Array.isArray(firstHit.geometry.coordinates)) {
        return null;
      }

      // 国土地理院住所検索APIは GeoJSON 形式のため [経度, 緯度] の順
      const [lng, lat] = firstHit.geometry.coordinates;
      if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
        return null;
      }

      const title = firstHit.properties?.title || trimmed;

      // 住所文字列から都道府県コードの逆引きを試行
      let prefCode = this.findPrefCodeFromText(title);

      // 文字列から特定できない場合は逆ジオコーダで座標から判定
      if (!prefCode) {
        prefCode = await this.reverseGeocodePrefCode(lat, lng);
      }

      return {
        lat,
        lng,
        title,
        prefCode: prefCode || APP_CONFIG.DEFAULT_PREF_CODE
      };
    } catch (error) {
      console.warn('ジオコーディング通信失敗:', error);
      return null;
    }
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
