/**
 * @file app.js
 * @description メインオーケストレータ。各サービスおよびUIコントローラーを統合し、ライフサイクルとイベントを管理する
 */

import { APP_CONFIG } from './config.js';
import { GeocodingService } from './geocoding-service.js';
import { ShelterService } from './shelter-service.js';
import { MapService } from './map-service.js';
import { UIController } from './ui-controller.js';

export class App {
  /** @type {number} レースコンディション防止用の世代管理リクエストカウンタ (位置更新用) */
  static currentRequestId = 0;

  /** @type {number} レースコンディション防止用の世代管理リクエストカウンタ (住所検索用) */
  static currentSearchRequestId = 0;

  /** @type {boolean} 住所検索の多重送信防止フラグ */
  static isSearching = false;

  /**
   * アプリケーション初期化エントリポイント
   */
  static async init() {
    try {
      // 1. 地図の初期化 (新大阪駅を初期中心に設定)
      MapService.initMap('map', [APP_CONFIG.DEFAULT_LAT, APP_CONFIG.DEFAULT_LNG], APP_CONFIG.DEFAULT_ZOOM);

      // 2. UIイベントリスナーの登録
      this.setupEventListeners();

      // 3. 初期位置・URLクエリパラメータの評価
      await this.handleInitialLocation();
    } catch (error) {
      console.error('アプリケーション初期化エラー:', error);
      UIController.showToast('初期化中にエラーが発生しました', true);
    }
  }

  /**
   * 全体イベントリスナーのセットアップ
   */
  static setupEventListeners() {
    // 住所検索フォーム
    const searchForm = document.getElementById('search-form');
    const searchInput = document.getElementById('search-input');
    if (searchForm && searchInput) {
      searchForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const query = searchInput.value;
        await this.searchAddress(query);
      });
    }

    // ドロップダウン外側クリックで候補一覧を閉じる
    document.addEventListener('click', (e) => {
      const searchContainer = document.getElementById('search-container');
      if (searchContainer && !searchContainer.contains(e.target)) {
        UIController.hideSearchResults();
      }
    });

    // ESCキー押下で候補一覧を閉じる
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        UIController.hideSearchResults();
      }
    });

    // 現在地取得ボタン (ヘッダー)
    const btnLocation = document.getElementById('btn-current-location');
    if (btnLocation) {
      btnLocation.addEventListener('click', async () => {
        UIController.hideSearchResults();
        await this.getCurrentLocation(true);
      });
    }

    // モバイル用サイドバートグル
    const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
    if (btnToggleSidebar) {
      btnToggleSidebar.addEventListener('click', () => {
        UIController.toggleSidebar();
      });
    }

    // モバイル用背景オーバーレイクリックでサイドバーを閉じる
    const sidebarBackdrop = document.getElementById('sidebar-backdrop');
    if (sidebarBackdrop) {
      sidebarBackdrop.addEventListener('click', () => {
        UIController.closeSidebar();
      });
    }

    // トースト手動クローズ
    const btnToastClose = document.getElementById('toast-close');
    if (btnToastClose) {
      btnToastClose.addEventListener('click', () => {
        UIController.dismissToast();
      });
    }

    // ロゴクリックで初期位置に戻る
    const headerLogo = document.getElementById('header-logo');
    if (headerLogo) {
      headerLogo.addEventListener('click', async () => {
        if (searchInput) searchInput.value = '';
        UIController.hideSearchResults();
        await this.updateLocation(
          APP_CONFIG.DEFAULT_LAT,
          APP_CONFIG.DEFAULT_LNG,
          '新大阪駅周辺 (初期地点)',
          APP_CONFIG.DEFAULT_ZOOM,
          APP_CONFIG.DEFAULT_PREF_CODE
        );
      });
    }

    // ハザードレイヤーチェックボックス連携
    const hazardTypes = ['flood', 'sediment', 'tsunami'];
    for (const type of hazardTypes) {
      const cb = document.getElementById(`chk-${type}`);
      if (cb) {
        cb.addEventListener('change', (e) => {
          MapService.toggleHazardLayer(type, e.target.checked);
        });
      }
    }

    // サンプル地点ボタン連携
    const sampleButtons = document.querySelectorAll('.btn-sample');
    sampleButtons.forEach((btn) => {
      btn.addEventListener('click', async () => {
        const indexStr = btn.getAttribute('data-sample-index');
        const index = parseInt(indexStr, 10);
        if (!isNaN(index)) {
          UIController.hideSearchResults();
          await this.moveToSample(index);
          if (window.innerWidth < 1024) {
            UIController.closeSidebar();
          }
        }
      });
    });
  }

  /**
   * URLパラメータ（?address=... または ?lat=...&lng=...）の解析と初期位置決定
   */
  static async handleInitialLocation() {
    if (typeof window === 'undefined') {
      return;
    }

    const params = new URLSearchParams(window.location.search);

    // 1. 住所パラメータの指定がある場合 (?address=...)
    if (params.has('address')) {
      const address = params.get('address');
      const searchInput = document.getElementById('search-input');
      if (searchInput) {
        searchInput.value = address;
      }
      await this.searchAddress(address);
      return;
    }

    // 2. 緯度経度パラメータの直接指定がある場合 (?lat=...&lng=...)
    if (params.has('lat') && params.has('lng')) {
      const lat = parseFloat(params.get('lat'));
      const lng = parseFloat(params.get('lng'));
      const zoom = parseInt(params.get('zoom') || String(APP_CONFIG.DEFAULT_ZOOM), 10);

      if (!isNaN(lat) && !isNaN(lng)) {
        await this.updateLocation(lat, lng, '指定地点', zoom);
        return;
      }
    }

    // 3. パラメータ指定がない場合は自動で現在地取得を開始（取得不可時は初期地点へフォールバック）
    await this.getCurrentLocation(false);
  }

  /**
   * 住所・キーワード検索のオーケストレーション（改修）
   * @param {string} query - 住所または施設名
   */
  static async searchAddress(query) {
    // 多重送信ガード: 検索実行中は後続の送信要求を無視する
    if (this.isSearching) {
      return;
    }

    if (!query || typeof query !== 'string' || query.trim() === '') {
      UIController.showToast('住所またはキーワードを入力してください', true);
      return;
    }

    const trimmedQuery = query.trim();
    this.isSearching = true;
    const searchRequestId = ++this.currentSearchRequestId;
    UIController.setSearchLoading(true);

    try {
      let centerLat = null;
      let centerLng = null;
      if (MapService.map && typeof MapService.map.getCenter === 'function') {
        const center = MapService.map.getCenter();
        if (center) {
          centerLat = center.lat;
          centerLng = center.lng;
        }
      }

      const candidates = await GeocodingService.search(trimmedQuery, { centerLat, centerLng });

      // レースコンディション防止ガード: 非同期通信完了後に最新リクエストか検証
      if (this.currentSearchRequestId !== searchRequestId) {
        return;
      }

      if (!candidates || candidates.length === 0) {
        UIController.hideSearchResults();
        UIController.showToast('該当する場所が見つかりませんでした。市区町村名を追加して検索してみてください', true);
        return;
      }

      // 単一候補かつ高確度一致（完全一致かつスコア閾値以上）の場合はダイレクト移動
      if (candidates.length === 1 && candidates[0].isHighConfidence) {
        UIController.hideSearchResults();
        const top = candidates[0];
        await this.updateLocation(top.lat, top.lng, top.title, 15, top.prefCode);
        UIController.showToast(`「${top.title}」へ移動しました`);
        return;
      }

      // 複数候補または曖昧一致の場合はドロップダウン候補リストを表示
      UIController.showSearchResults(candidates, async (selected) => {
        if (this.currentSearchRequestId !== searchRequestId) {
          return;
        }
        await this.updateLocation(selected.lat, selected.lng, selected.title, 15, selected.prefCode);
        UIController.showToast(`「${selected.title}」へ移動しました`);
      });
    } catch (error) {
      if (this.currentSearchRequestId === searchRequestId) {
        console.error('住所検索処理エラー:', error);
        UIController.hideSearchResults();
        UIController.showToast('住所の検索中に通信エラーが発生しました', true);
      }
    } finally {
      this.isSearching = false;
      if (this.currentSearchRequestId === searchRequestId) {
        UIController.setSearchLoading(false);
      }
    }
  }

  /**
   * 現在地取得の実行フロー
   * @param {boolean} isUserInitiated - ユーザーの明示的操作（ボタン押下）かどうか
   */
  static async getCurrentLocation(isUserInitiated = true) {
    UIController.hideSearchResults();
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      if (isUserInitiated) {
        UIController.showToast('お使いのブラウザは位置情報取得に対応していません', true);
      } else {
        UIController.showToast('位置情報に対応していないため、初期地点（新大阪駅周辺）で開始します');
      }
      await this.updateLocation(
        APP_CONFIG.DEFAULT_LAT,
        APP_CONFIG.DEFAULT_LNG,
        '新大阪駅周辺 (初期地点)',
        APP_CONFIG.DEFAULT_ZOOM,
        APP_CONFIG.DEFAULT_PREF_CODE
      );
      return;
    }

    UIController.showLoading(isUserInitiated ? '現在地を取得中...' : '位置情報を取得中...');

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        await this.updateLocation(latitude, longitude, '現在地', 15);
        UIController.showToast('現在地を取得しました');
      },
      async (error) => {
        UIController.hideLoading();
        let errorMessage = '現在地を取得できませんでした。';
        switch (error.code) {
          case error.PERMISSION_DENIED:
            errorMessage = '位置情報の利用が許可されませんでした。';
            break;
          case error.POSITION_UNAVAILABLE:
            errorMessage = '端末の位置情報を特定できませんでした。';
            break;
          case error.TIMEOUT:
            errorMessage = '位置情報の取得がタイムアウトしました。';
            break;
        }

        if (isUserInitiated) {
          UIController.showToast(`${errorMessage}設定をご確認ください。`, true);
        } else {
          // 自動取得時：取得できない場合は使わないモード（初期地点）で動作
          UIController.showToast('位置情報が取得できなかったため、初期地点（新大阪駅周辺）で開始します');
          await this.updateLocation(
            APP_CONFIG.DEFAULT_LAT,
            APP_CONFIG.DEFAULT_LNG,
            '新大阪駅周辺 (初期地点)',
            APP_CONFIG.DEFAULT_ZOOM,
            APP_CONFIG.DEFAULT_PREF_CODE
          );
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000
      }
    );
  }

  /**
   * サンプル地点へのジャンプ実行フロー
   * @param {number} index - SAMPLE_LOCATIONS のインデックス
   */
  static async moveToSample(index) {
    const sample = APP_CONFIG.SAMPLE_LOCATIONS[index];
    if (!sample) {
      return;
    }

    UIController.showLoading(`${sample.name} へ移動中...`);

    // チェックボックス状態の更新
    UIController.setHazardCheckbox('flood', sample.activeHazard === 'flood');
    UIController.setHazardCheckbox('sediment', sample.activeHazard === 'sediment');
    UIController.setHazardCheckbox('tsunami', sample.activeHazard === 'tsunami');

    // 地図上のレイヤー表示/非表示の反映
    MapService.toggleHazardLayer('flood', sample.activeHazard === 'flood');
    MapService.toggleHazardLayer('sediment', sample.activeHazard === 'sediment');
    MapService.toggleHazardLayer('tsunami', sample.activeHazard === 'tsunami');

    await this.updateLocation(sample.lat, sample.lng, sample.name, 14, sample.prefCode);
  }

  /**
   * 座標の決定に伴う総合更新フロー（逆ジオコーダ -> レイヤー更新 -> 避難所計算 -> マーカー・リスト描画）
   * @param {number} lat - 緯度
   * @param {number} lng - 経度
   * @param {string} label - 表示ラベル
   * @param {number} [zoom=14] - ズームレベル
   * @param {string | null} [knownPrefCode=null] - 既知のJIS都道府県コード (省略時は逆ジオコーダで特定)
   */
  static async updateLocation(lat, lng, label, zoom = 14, knownPrefCode = null) {
    const requestId = ++this.currentRequestId;
    UIController.showLoading('ハザード情報・避難所を検索中...');

    try {
      // 1. 都道府県コードの特定
      const prefCode = knownPrefCode || (await GeocodingService.reverseGeocodePrefCode(lat, lng));
      if (this.currentRequestId !== requestId) {
        return;
      }

      // 2. ハザードレイヤーの都道府県URL更新
      MapService.updateHazardLayers(prefCode);

      // 3. 中心地点ピンの配置と地図移動 (labelはMapService内で確実にHTMLエスケープ)
      MapService.setLocationMarker(lat, lng, label, zoom);

      // 4. 周辺指定緊急避難場所の並行取得・計算 (Zoom 10 9タイル×6種別)
      const shelters = await ShelterService.getNearbyShelters(lat, lng);
      if (this.currentRequestId !== requestId) {
        return;
      }

      // 5. 地図上への避難所ピン描画（マーカークリック時にポップアップ展開＆該当カードハイライト＋スクロール）
      MapService.renderShelterMarkers(shelters, (shelter) => {
        MapService.focusShelter(shelter);
        UIController.highlightShelterCard(shelter);
      });

      // 6. サイドバーへの避難所リストカード描画（カードクリック時に地図フォーカス）
      UIController.renderShelterList(shelters, (shelter) => {
        MapService.focusShelter(shelter);
      });
    } catch (error) {
      if (this.currentRequestId === requestId) {
        console.error('位置更新フローエラー:', error);
        UIController.showToast('避難所データの取得中に問題が発生しました', true);
      }
    } finally {
      if (this.currentRequestId === requestId) {
        UIController.hideLoading();
      }
    }
  }
}

// ブラウザ環境でのDOMContentLoaded初期化
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    App.init();
  });
}
