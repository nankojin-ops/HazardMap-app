/**
 * @file ui-controller.js
 * @description UIコンポーネント（ローディング、トースト、モーダル、サイドバー、避難所リストカード、
 * 検索候補ドロップダウン、検索ローディング表示）のDOM制御を一元管理するモジュール
 */

export class UIController {
  /** @type {any} トースト自動非表示タイマーID */
  static toastTimeoutId = null;

  /**
   * 全画面ローディングオーバーレイを表示する
   * @param {string} [message='ハザード情報・避難所を検索中...'] - 表示メッセージ
   */
  static showLoading(message = 'ハザード情報・避難所を検索中...') {
    const overlay = document.getElementById('loading-overlay');
    const msgEl = document.getElementById('loading-message');
    if (msgEl) {
      msgEl.textContent = message;
    }
    if (overlay) {
      overlay.classList.remove('hidden');
      overlay.classList.add('flex');
    }
  }

  /**
   * 全画面ローディングオーバーレイを非表示にする
   */
  static hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
      overlay.classList.add('hidden');
      overlay.classList.remove('flex');
    }
  }

  /**
   * トースト通知を表示する
   * @param {string} message - 通知メッセージ
   * @param {boolean} [isError=false] - エラー表示フラグ
   * @param {number} [autoHideMs=5000] - 自動非表示ミリ秒 (0で非自動非表示)
   */
  static showToast(message, isError = false, autoHideMs = 5000) {
    const toast = document.getElementById('toast-container');
    const toastIcon = document.getElementById('toast-icon');
    const toastMessage = document.getElementById('toast-message');

    if (!toast || !toastMessage) {
      return;
    }

    if (this.toastTimeoutId) {
      clearTimeout(this.toastTimeoutId);
      this.toastTimeoutId = null;
    }

    toastMessage.textContent = message;

    if (isError) {
      toast.className = 'fixed bottom-5 right-5 z-50 flex items-center gap-3 px-4 py-3 bg-red-600 text-white rounded-lg shadow-xl transition-all duration-300 transform translate-y-0 opacity-100 max-w-md';
      if (toastIcon) {
        toastIcon.className = 'fa-solid fa-circle-exclamation text-xl shrink-0';
      }
    } else {
      toast.className = 'fixed bottom-5 right-5 z-50 flex items-center gap-3 px-4 py-3 bg-gray-900 text-white rounded-lg shadow-xl transition-all duration-300 transform translate-y-0 opacity-100 max-w-md';
      if (toastIcon) {
        toastIcon.className = 'fa-solid fa-circle-info text-xl text-blue-400 shrink-0';
      }
    }

    toast.classList.remove('hidden');

    if (autoHideMs > 0) {
      this.toastTimeoutId = setTimeout(() => {
        this.dismissToast();
      }, autoHideMs);
    }
  }

  /**
   * トースト通知を即時閉じる
   */
  static dismissToast() {
    const toast = document.getElementById('toast-container');
    if (toast) {
      toast.classList.add('hidden');
    }
    if (this.toastTimeoutId) {
      clearTimeout(this.toastTimeoutId);
      this.toastTimeoutId = null;
    }
  }

  /**
   * 初回ウェルカムモーダルを表示する
   */
  static showWelcomeModal() {
    const modal = document.getElementById('welcome-modal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }
  }

  /**
   * 初回ウェルカムモーダルを非表示にする
   */
  static hideWelcomeModal() {
    const modal = document.getElementById('welcome-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
  }

  /**
   * サイドバーを開閉トグルする（モバイル用）
   */
  static toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-backdrop');
    if (!sidebar) {
      return;
    }

    const isHidden = sidebar.classList.contains('-translate-x-full');
    if (isHidden) {
      sidebar.classList.remove('-translate-x-full');
      if (overlay) overlay.classList.remove('hidden');
    } else {
      sidebar.classList.add('-translate-x-full');
      if (overlay) overlay.classList.add('hidden');
    }
  }

  /**
   * サイドバーを閉じる（モバイル用）
   */
  static closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-backdrop');
    if (sidebar) {
      sidebar.classList.add('-translate-x-full');
    }
    if (overlay) {
      overlay.classList.add('hidden');
    }
  }

  /**
   * 周辺避難所リストカード群を描画する
   * @param {Array<Object>} shelters - 避難所データリスト
   * @param {(shelter: Object) => void} onCardClick - カードクリック時コールバック
   */
  static renderShelterList(shelters, onCardClick) {
    const container = document.getElementById('shelter-list');
    const countBadge = document.getElementById('shelter-count');

    if (!container) {
      return;
    }

    container.innerHTML = '';

    const count = Array.isArray(shelters) ? shelters.length : 0;
    if (countBadge) {
      countBadge.textContent = `${count}件`;
    }

    if (count === 0) {
      container.innerHTML = `
        <div class="p-6 text-center text-gray-500">
          <i class="fa-solid fa-triangle-exclamation text-3xl mb-2 text-amber-500"></i>
          <p class="font-medium text-sm">半径 5km 以内に指定緊急避難場所が見つかりませんでした。</p>
          <p class="text-xs text-gray-400 mt-1">別の地点を検索するか、地図を移動してください。</p>
        </div>
      `;
      return;
    }

    // 各避難所カード要素の生成
    shelters.forEach((shelter, index) => {
      const card = document.createElement('div');
      card.className = 'shelter-card p-3 rounded-lg border border-gray-200 hover:border-blue-500 bg-white hover:bg-blue-50/50 shadow-sm transition cursor-pointer mb-2.5';
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');

      // 一意な避難所識別IDを属性として付与
      const shelterId = `${shelter.name}_${shelter.lat.toFixed(5)}_${shelter.lng.toFixed(5)}`;
      card.setAttribute('data-shelter-id', shelterId);

      const isWelfare = shelter.isWelfare;
      const badgeClass = isWelfare
        ? 'bg-purple-100 text-purple-700 border-purple-200'
        : 'bg-blue-100 text-blue-700 border-blue-200';
      const iconClass = isWelfare ? 'fa-wheelchair' : 'fa-person-shelter';
      const typeLabel = isWelfare ? '要配慮者優先' : '一般避難場所';

      card.innerHTML = `
        <div class="flex items-start justify-between gap-2 mb-1.5">
          <h4 class="font-bold text-sm text-gray-800 leading-snug hover:text-blue-600 transition">
            ${index + 1}. ${this.escapeHtml(shelter.name)}
          </h4>
          <span class="inline-flex items-center text-xs font-bold text-gray-700 bg-gray-100 px-2 py-0.5 rounded whitespace-nowrap shrink-0">
            約${shelter.walkingMinutes}分
          </span>
        </div>
        <div class="flex flex-wrap items-center gap-1.5 mb-2">
          <span class="inline-flex items-center text-[11px] px-2 py-0.5 rounded-full font-semibold border ${badgeClass}">
            <i class="fa-solid ${iconClass} mr-1"></i>${typeLabel}
          </span>
          <span class="text-[11px] text-gray-500">
            直線 ${shelter.directDistance}km / 徒歩約 ${shelter.walkingDistance}km
          </span>
        </div>
        <div class="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded mb-1.5 flex items-center gap-1">
          <i class="fa-solid fa-shield text-[10px] shrink-0"></i>
          <span class="truncate">${this.escapeHtml(shelter.category)}</span>
        </div>
        <p class="text-xs text-gray-500 truncate">
          <i class="fa-solid fa-location-dot mr-1 text-gray-400"></i>${this.escapeHtml(shelter.address || '住所情報なし')}
        </p>
      `;

      card.addEventListener('click', () => {
        // カードのアクティブハイライト
        const prevActive = container.querySelectorAll('.shelter-card-active');
        prevActive.forEach(el => {
          el.classList.remove('shelter-card-active', 'ring-2', 'ring-blue-500', 'bg-blue-50');
        });
        card.classList.add('shelter-card-active', 'ring-2', 'ring-blue-500', 'bg-blue-50');

        if (typeof onCardClick === 'function') {
          onCardClick(shelter);
        }

        // スマホ画面幅時はカードクリック時にサイドバーを自動で閉じる
        if (window.innerWidth < 1024) {
          this.closeSidebar();
        }
      });

      container.appendChild(card);
    });
  }

  /**
   * マーカー選択時等に該当する避難所カードをハイライトし、可視位置へスクロールする
   * @param {Object} shelter - 避難所データ
   */
  static highlightShelterCard(shelter) {
    if (!shelter) {
      return;
    }

    const container = document.getElementById('shelter-list');
    if (!container) {
      return;
    }

    const shelterId = `${shelter.name}_${shelter.lat.toFixed(5)}_${shelter.lng.toFixed(5)}`;

    // 既存アクティブハイライトの解除
    const prevActive = container.querySelectorAll('.shelter-card-active');
    prevActive.forEach(el => {
      el.classList.remove('shelter-card-active', 'ring-2', 'ring-blue-500', 'bg-blue-50');
    });

    // 一致するカード要素の検索
    const cards = container.querySelectorAll('.shelter-card');
    for (const card of cards) {
      if (card.getAttribute('data-shelter-id') === shelterId) {
        card.classList.add('shelter-card-active', 'ring-2', 'ring-blue-500', 'bg-blue-50');
        if (typeof card.scrollIntoView === 'function') {
          card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        break;
      }
    }
  }

  /**
   * ハザードチェックボックスのON/OFF状態をUIに反映する
   * @param {'flood' | 'sediment' | 'tsunami'} type - レイヤー種別
   * @param {boolean} checked - チェック状態
   */
  static setHazardCheckbox(type, checked) {
    const cb = document.getElementById(`chk-${type}`);
    if (cb) {
      cb.checked = checked;
    }
  }

  /**
   * 検索候補一覧およびバックドロップを表示する（改訂）
   * @param {Array<Object>} candidates - 表示候補一覧
   * @param {(candidate: Object) => void} onSelect - 選択時コールバック
   */
  static showSearchResults(candidates, onSelect) {
    const dropdown = document.getElementById('search-results-dropdown');
    const backdrop = document.getElementById('search-backdrop');
    const searchInput = document.getElementById('search-input');

    if (!dropdown) {
      return;
    }

    dropdown.innerHTML = '';

    if (!Array.isArray(candidates) || candidates.length === 0) {
      this.hideSearchResults();
      return;
    }

    if (searchInput) {
      searchInput.setAttribute('aria-expanded', 'true');
    }

    candidates.forEach((candidate) => {
      const item = document.createElement('div');
      item.className = 'search-result-item p-3.5 hover:bg-blue-50 active:bg-blue-100 cursor-pointer transition select-none flex flex-col justify-center min-h-[48px]';
      item.setAttribute('role', 'option');
      item.setAttribute('tabindex', '0');

      // 提供元バッジ
      const sourceBadge = candidate.source === 'osm'
        ? '<span class="inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 border border-blue-200 shrink-0">OSM</span>'
        : '<span class="inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200 shrink-0">国土地理院</span>';

      // 直線距離 (計算されている場合) - BUG-009是正: 数値検証およびサニタイズ
      const distanceHtml = (typeof candidate.distanceKm === 'number' && Number.isFinite(candidate.distanceKm))
        ? `<span class="text-[11px] text-gray-500 font-medium shrink-0 flex items-center gap-1"><i class="fa-solid fa-route text-gray-400 text-[10px]"></i>約${candidate.distanceKm}km</span>`
        : (candidate.distanceKm ? `<span class="text-[11px] text-gray-500 font-medium shrink-0 flex items-center gap-1"><i class="fa-solid fa-route text-gray-400 text-[10px]"></i>約${this.escapeHtml(String(candidate.distanceKm))}km</span>` : '');

      const escapedTitle = this.escapeHtml(candidate.title);
      const escapedAddress = this.escapeHtml(candidate.address);

      item.innerHTML = `
        <div class="flex items-center justify-between gap-2 mb-1">
          <div class="flex items-center gap-1.5 min-w-0">
            ${sourceBadge}
            <span class="font-bold text-xs sm:text-sm text-gray-900 truncate">${escapedTitle}</span>
          </div>
          ${distanceHtml}
        </div>
        <div class="text-[11px] sm:text-xs text-gray-500 truncate" title="${escapedAddress}">
          <i class="fa-solid fa-location-dot mr-1 text-gray-400 text-[10px] shrink-0"></i>${escapedAddress}
        </div>
      `;

      // クリックイベント
      item.addEventListener('click', () => {
        this.hideSearchResults();
        if (typeof onSelect === 'function') {
          onSelect(candidate);
        }
      });

      // キーボード操作サポート (EnterまたはSpaceで選択)
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.hideSearchResults();
          if (typeof onSelect === 'function') {
            onSelect(candidate);
          }
        }
      });

      dropdown.appendChild(item);
    });

    dropdown.classList.remove('hidden');
    if (backdrop) {
      backdrop.classList.remove('hidden');
    }
  }

  /**
   * 候補一覧ドロップダウンおよびバックドロップを非表示にし、DOMをクリアする（改訂）
   */
  static hideSearchResults() {
    const dropdown = document.getElementById('search-results-dropdown');
    const backdrop = document.getElementById('search-backdrop');
    const searchInput = document.getElementById('search-input');

    if (searchInput) {
      searchInput.setAttribute('aria-expanded', 'false');
    }

    if (dropdown) {
      dropdown.classList.add('hidden');
      dropdown.innerHTML = '';
    }

    if (backdrop) {
      backdrop.classList.add('hidden');
    }
  }

  /**
   * 検索ボタン・入力欄のローディング状態（スピナー表示・ボタン無効化）を切り替える (新規メソッド)
   * @param {boolean} isLoading
   */
  static setSearchLoading(isLoading) {
    const searchBtn = document.getElementById('search-btn');
    const searchSpinner = document.getElementById('search-spinner');
    const searchBtnText = document.getElementById('search-btn-text');

    if (searchBtn) {
      searchBtn.disabled = isLoading;
    }

    if (searchSpinner) {
      if (isLoading) {
        searchSpinner.classList.remove('hidden');
      } else {
        searchSpinner.classList.add('hidden');
      }
    }

    if (searchBtnText) {
      searchBtnText.textContent = isLoading ? '検索中' : '検索';
    }
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
