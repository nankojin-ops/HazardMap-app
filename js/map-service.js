/**
 * @file map-service.js
 * @description Leaflet.jsを用いた地図描画、ハザードレイヤーの動的重畳、現在地マーカーおよび避難所マーカー群の制御を行うモジュール
 */

import { APP_CONFIG } from './config.js';

export class MapService {
  /** @type {any} Leaflet Map インスタンス */
  static map = null;

  /** @type {string} 現在設定されているJIS都道府県コード (2桁) */
  static currentPrefCode = APP_CONFIG.DEFAULT_PREF_CODE;

  /** @type {Record<string, any>} ハザードレイヤーインスタンス */
  static hazardLayers = {
    flood: null,
    sediment: null,
    tsunami: null
  };

  /** @type {Record<string, boolean>} ハザードレイヤーの表示状態 */
  static hazardVisibility = {
    flood: false,
    sediment: false,
    tsunami: false
  };

  /** @type {any} 中心地点（現在地・検索地点）マーカー */
  static centerMarker = null;

  /** @type {any} 避難所マーカーレイヤーグループ */
  static shelterMarkerGroup = null;

  /** @type {Map<string, any>} 避難所識別キーからマーカーへのマッピング */
  static shelterMarkerMap = new Map();

  /**
   * Leaflet地図インスタンスを初期化する
   * @param {string} containerId - 地図表示要素のDOM ID ('map')
   * @param {[number, number]} initialCoords - 初期表示座標 [緯度, 経度]
   * @param {number} [initialZoom=APP_CONFIG.DEFAULT_ZOOM] - 初期ズームレベル
   */
  static initMap(containerId, initialCoords, initialZoom = APP_CONFIG.DEFAULT_ZOOM) {
    if (typeof window === 'undefined' || typeof window.L === 'undefined') {
      console.warn('Leaflet (L) がロードされていません。');
      return;
    }

    const L = window.L;

    // 既に初期化済みの場合は削除して再作成
    if (this.map) {
      this.map.remove();
      this.map = null;
    }

    this.map = L.map(containerId, {
      zoomControl: true,
      maxZoom: 18,
      minZoom: 5
    }).setView(initialCoords, initialZoom);

    // 国土地理院標準地図ベースレイヤーの追加
    L.tileLayer(APP_CONFIG.TILE_URLS.std, {
      attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener noreferrer">国土地理院</a>',
      maxZoom: 18,
      minZoom: 5
    }).addTo(this.map);

    // ハザードレイヤーの初期化（透過率 0.75）
    this.hazardLayers.flood = L.tileLayer(APP_CONFIG.TILE_URLS.flood, {
      attribution: '<a href="https://disaportal.gsi.go.jp/hazardmap/copyright/opendata.html" target="_blank" rel="noopener noreferrer">国土地理院ハザードポータル</a>',
      opacity: 0.75,
      maxZoom: 17,
      minZoom: 2
    });

    const sedimentUrl = APP_CONFIG.TILE_URLS.sediment.replace('{pref}', this.currentPrefCode);
    this.hazardLayers.sediment = L.tileLayer(sedimentUrl, {
      attribution: '<a href="https://disaportal.gsi.go.jp/hazardmap/copyright/opendata.html" target="_blank" rel="noopener noreferrer">国土地理院ハザードポータル</a>',
      opacity: 0.75,
      maxZoom: 17,
      minZoom: 2
    });

    const tsunamiUrl = APP_CONFIG.TILE_URLS.tsunami.replace('{pref}', this.currentPrefCode);
    this.hazardLayers.tsunami = L.tileLayer(tsunamiUrl, {
      attribution: '<a href="https://disaportal.gsi.go.jp/hazardmap/copyright/opendata.html" target="_blank" rel="noopener noreferrer">国土地理院ハザードポータル</a>',
      opacity: 0.75,
      maxZoom: 17,
      minZoom: 2
    });

    // 避難所マーカーレイヤーグループの生成・追加
    this.shelterMarkerGroup = L.layerGroup().addTo(this.map);
  }

  /**
   * 都道府県コードに応じてハザードレイヤー（土砂・津波）を再構築する
   * @param {string} prefCode - JIS都道府県コード2桁
   */
  static updateHazardLayers(prefCode) {
    if (!prefCode || this.currentPrefCode === prefCode) {
      return;
    }

    this.currentPrefCode = prefCode;

    const sedimentUrl = APP_CONFIG.TILE_URLS.sediment.replace('{pref}', prefCode);
    if (this.hazardLayers.sediment && typeof this.hazardLayers.sediment.setUrl === 'function') {
      this.hazardLayers.sediment.setUrl(sedimentUrl);
    }

    const tsunamiUrl = APP_CONFIG.TILE_URLS.tsunami.replace('{pref}', prefCode);
    if (this.hazardLayers.tsunami && typeof this.hazardLayers.tsunami.setUrl === 'function') {
      this.hazardLayers.tsunami.setUrl(tsunamiUrl);
    }
  }

  /**
   * ハザードレイヤーの表示/非表示を切り替える
   * @param {'flood' | 'sediment' | 'tsunami'} type - レイヤー種別
   * @param {boolean} visible - 表示フラグ
   */
  static toggleHazardLayer(type, visible) {
    if (!this.map || !this.hazardLayers[type]) {
      return;
    }

    this.hazardVisibility[type] = visible;
    const layer = this.hazardLayers[type];

    if (visible) {
      if (!this.map.hasLayer(layer)) {
        layer.addTo(this.map);
        if (typeof layer.bringToFront === 'function') {
          layer.bringToFront();
        }
      }
    } else {
      if (this.map.hasLayer(layer)) {
        this.map.removeLayer(layer);
      }
    }
  }

  /**
   * 中心地点マーカー（赤色パルスピン）を配置・移動し、地図をパンする
   * @param {number} lat - 緯度
   * @param {number} lng - 経度
   * @param {string} labelOrText - ポップアップ表示テキスト（自動エスケープされます）
   * @param {number} [zoom=APP_CONFIG.DEFAULT_ZOOM] - ズームレベル
   */
  static setLocationMarker(lat, lng, labelOrText, zoom = APP_CONFIG.DEFAULT_ZOOM) {
    if (!this.map || typeof window === 'undefined' || typeof window.L === 'undefined') {
      return;
    }

    const L = window.L;

    // パルスアニメーション付きカスタムアイコン
    const pulseIcon = L.divIcon({
      className: 'pulse-marker-wrapper',
      html: `
        <div class="relative flex items-center justify-center w-8 h-8">
          <span class="absolute w-8 h-8 rounded-full bg-red-500 opacity-75 animate-ping"></span>
          <span class="relative flex items-center justify-center w-7 h-7 rounded-full bg-red-600 text-white shadow-lg border-2 border-white">
            <i class="fa-solid fa-location-dot text-xs"></i>
          </span>
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
      popupAnchor: [0, -16]
    });

    // XSS対策: 渡されたテキストを安全にエスケープして太字タグで包む
    const rawText = typeof labelOrText === 'string'
      ? labelOrText.replace(/^<strong>(.*)<\/strong>$/s, '$1')
      : String(labelOrText || '');
    const safePopupContent = `<strong>${this.escapeHtml(rawText)}</strong>`;

    if (this.centerMarker) {
      this.centerMarker.setLatLng([lat, lng]);
      this.centerMarker.setIcon(pulseIcon);
      this.centerMarker.setPopupContent(safePopupContent);
    } else {
      this.centerMarker = L.marker([lat, lng], { icon: pulseIcon }).addTo(this.map);
      this.centerMarker.bindPopup(safePopupContent);
    }

    this.map.setView([lat, lng], zoom, { animate: true });
  }

  /**
   * 避難所マーカー群を描画する
   * @param {Array<Object>} shelters - 避難所データリスト
   * @param {(shelter: Object) => void} [onMarkerClick] - マーカークリック時コールバック
   */
  static renderShelterMarkers(shelters, onMarkerClick) {
    if (!this.map || !this.shelterMarkerGroup || typeof window === 'undefined' || typeof window.L === 'undefined') {
      return;
    }

    const L = window.L;

    this.shelterMarkerGroup.clearLayers();
    this.shelterMarkerMap.clear();

    if (!Array.isArray(shelters)) {
      return;
    }

    for (const shelter of shelters) {
      const icon = this.createShelterMarkerIcon(shelter.isWelfare);
      const marker = L.marker([shelter.lat, shelter.lng], { icon });

      // ポップアップコンテンツ生成 (XSS防止のテキストエスケープ配慮)
      const popupHtml = `
        <div class="p-1 max-w-xs font-sans text-gray-800">
          <div class="flex items-center gap-2 mb-1.5">
            <span class="text-xs px-2 py-0.5 rounded-full font-semibold ${
              shelter.isWelfare ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
            }">
              <i class="fa-solid ${shelter.isWelfare ? 'fa-wheelchair' : 'fa-person-shelter'} mr-1"></i>
              ${shelter.isWelfare ? '要配慮者・福祉' : '一般避難場所'}
            </span>
            <span class="text-xs font-bold text-gray-600 ml-auto">
              約${shelter.walkingMinutes}分 (${shelter.walkingDistance}km)
            </span>
          </div>
          <h4 class="font-bold text-sm text-gray-900 leading-snug mb-1">${this.escapeHtml(shelter.name)}</h4>
          <p class="text-xs text-gray-500 mb-1.5">${this.escapeHtml(shelter.address || '住所情報なし')}</p>
          <div class="text-xs text-emerald-700 bg-emerald-50 px-2 py-1 rounded mb-2 border border-emerald-200">
            <i class="fa-solid fa-shield mr-1"></i>${this.escapeHtml(shelter.category)}
          </div>
          <a href="https://www.google.com/maps/dir/?api=1&destination=${shelter.lat},${shelter.lng}"
             target="_blank" rel="noopener noreferrer"
             class="popup-gmap-btn inline-flex items-center justify-center w-full text-xs font-semibold bg-blue-700 hover:bg-blue-800 text-white py-1.5 px-3 rounded shadow-sm transition"
             style="color: #ffffff !important; text-decoration: none !important;">
            <i class="fa-solid fa-route mr-1.5" style="color: #ffffff !important;"></i>Googleマップで案内
          </a>
        </div>
      `;

      marker.bindPopup(popupHtml, { maxWidth: 320 });

      marker.on('click', () => {
        if (typeof onMarkerClick === 'function') {
          onMarkerClick(shelter);
        }
      });

      const key = `${shelter.name}_${shelter.lat.toFixed(5)}_${shelter.lng.toFixed(5)}`;
      this.shelterMarkerMap.set(key, marker);
      this.shelterMarkerGroup.addLayer(marker);
    }
  }

  /**
   * 特定の避難所に地図をフォーカスし、ポップアップを展開する
   * @param {Object} shelter - フォーカス対象避難所
   * @param {number} [zoom=16] - ズームレベル
   */
  static focusShelter(shelter, zoom = 16) {
    if (!this.map || !shelter) {
      return;
    }

    const key = `${shelter.name}_${shelter.lat.toFixed(5)}_${shelter.lng.toFixed(5)}`;
    const marker = this.shelterMarkerMap.get(key);

    this.map.setView([shelter.lat, shelter.lng], zoom, { animate: true });

    if (marker) {
      setTimeout(() => {
        marker.openPopup();
      }, 250);
    }
  }

  /**
   * 福祉避難所 / 一般避難所用のカスタム DivIcon を生成する
   * @param {boolean} isWelfare - 福祉避難所フラグ
   * @returns {any} Leaflet DivIcon
   */
  static createShelterMarkerIcon(isWelfare) {
    if (typeof window === 'undefined' || typeof window.L === 'undefined') {
      return null;
    }

    const L = window.L;

    if (isWelfare) {
      // 福祉避難所用アイコン (紫色、二重リングデザイン)
      return L.divIcon({
        className: 'shelter-marker-welfare',
        html: `
          <div class="relative flex items-center justify-center w-8 h-8 group cursor-pointer">
            <span class="absolute w-8 h-8 rounded-full bg-purple-400 opacity-60 border-2 border-purple-600"></span>
            <span class="relative flex items-center justify-center w-6 h-6 rounded-full bg-purple-700 text-white shadow-md border border-white">
              <i class="fa-solid fa-wheelchair text-xs"></i>
            </span>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -16]
      });
    }

    // 一般避難所用アイコン (青色、標準デザイン)
    return L.divIcon({
      className: 'shelter-marker-general',
      html: `
        <div class="relative flex items-center justify-center w-8 h-8 group cursor-pointer">
          <span class="relative flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-white shadow-md border-2 border-white">
            <i class="fa-solid fa-person-shelter text-xs"></i>
          </span>
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
      popupAnchor: [0, -16]
    });
  }

  /**
   * レンダリング済みのLeafletマップインスタンスを取得する
   * @returns {any}
   */
  static getMapInstance() {
    return this.map;
  }

  /**
   * HTMLエスケープ処理
   * @param {string} str - 文字列
   * @returns {string} エスケープ済み文字列
   */
  static escapeHtml(str) {
    if (!str || typeof str !== 'string') {
      return '';
    }
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
