/**
 * @file initial-location.test.js
 * @description 初回アクセス時の自動位置情報取得およびフォールバック（使わないモード）の動作検証テスト
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { App } from '../js/app.js';
import { APP_CONFIG } from '../js/config.js';
import { UIController } from '../js/ui-controller.js';

function setMockNavigator(mockNav) {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    value: mockNav,
    configurable: true,
    writable: true
  });
  return () => {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'navigator', originalDescriptor);
    } else {
      delete globalThis.navigator;
    }
  };
}

test('InitialLocation: URLパラメータなしの場合にモーダルを出さず自動で位置情報取得を開始する', async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalUpdateLocation = App.updateLocation;
  const originalShowWelcomeModal = UIController.showWelcomeModal;
  const originalShowLoading = UIController.showLoading;
  const originalHideLoading = UIController.hideLoading;

  let welcomeModalCalled = false;
  let updateLocationArgs = null;

  const restoreNavigator = setMockNavigator({
    geolocation: {
      getCurrentPosition: (success) => {
        success({
          coords: {
            latitude: 35.6812,
            longitude: 139.7671
          }
        });
      }
    }
  });

  try {
    UIController.showWelcomeModal = () => {
      welcomeModalCalled = true;
    };
    UIController.showLoading = () => {};
    UIController.hideLoading = () => {};

    App.updateLocation = async (...args) => {
      updateLocationArgs = args;
    };

    globalThis.window = {
      location: {
        search: ''
      }
    };
    globalThis.document = {
      getElementById: () => null
    };

    await App.handleInitialLocation();

    assert.strictEqual(welcomeModalCalled, false, 'ウェルカムモーダルは呼び出されないこと');
    assert.ok(updateLocationArgs, 'updateLocationが呼び出されていること');
    assert.strictEqual(updateLocationArgs[0], 35.6812, '現在地の緯度が渡されていること');
    assert.strictEqual(updateLocationArgs[1], 139.7671, '現在地の経度が渡されていること');
    assert.strictEqual(updateLocationArgs[2], '現在地');
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    restoreNavigator();
    App.updateLocation = originalUpdateLocation;
    UIController.showWelcomeModal = originalShowWelcomeModal;
    UIController.showLoading = originalShowLoading;
    UIController.hideLoading = originalHideLoading;
  }
});

test('InitialLocation: 位置情報取得拒否時に初期地点（新大阪駅周辺）でフォールバック動作する', async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalUpdateLocation = App.updateLocation;
  const originalShowToast = UIController.showToast;
  const originalShowLoading = UIController.showLoading;
  const originalHideLoading = UIController.hideLoading;

  let toastMessages = [];
  let updateLocationArgs = null;

  const restoreNavigator = setMockNavigator({
    geolocation: {
      getCurrentPosition: (success, error) => {
        const err = new Error('User denied Geolocation');
        err.code = 1; // PERMISSION_DENIED
        err.PERMISSION_DENIED = 1;
        err.POSITION_UNAVAILABLE = 2;
        err.TIMEOUT = 3;
        error(err);
      }
    }
  });

  try {
    UIController.showToast = (msg, isError) => {
      toastMessages.push({ msg, isError });
    };
    UIController.showLoading = () => {};
    UIController.hideLoading = () => {};

    App.updateLocation = async (...args) => {
      updateLocationArgs = args;
    };

    globalThis.window = {
      location: {
        search: ''
      }
    };
    globalThis.document = {
      getElementById: () => null
    };

    await App.handleInitialLocation();

    assert.ok(updateLocationArgs, 'updateLocationがフォールバック地点で呼び出されていること');
    assert.strictEqual(updateLocationArgs[0], APP_CONFIG.DEFAULT_LAT, 'デフォルト緯度');
    assert.strictEqual(updateLocationArgs[1], APP_CONFIG.DEFAULT_LNG, 'デフォルト経度');
    assert.strictEqual(updateLocationArgs[2], '新大阪駅周辺 (初期地点)');
    assert.strictEqual(updateLocationArgs[3], APP_CONFIG.DEFAULT_ZOOM);
    assert.strictEqual(updateLocationArgs[4], APP_CONFIG.DEFAULT_PREF_CODE);

    // フォールバックのトースト通知が出ているか
    const hasFallbackToast = toastMessages.some(t => t.msg.includes('初期地点（新大阪駅周辺）で開始します'));
    assert.ok(hasFallbackToast, 'フォールバック通知トーストが表示されること');
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    restoreNavigator();
    App.updateLocation = originalUpdateLocation;
    UIController.showToast = originalShowToast;
    UIController.showLoading = originalShowLoading;
    UIController.hideLoading = originalHideLoading;
  }
});

test('InitialLocation: navigator.geolocation非対応環境で初期地点フォールバックする', async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalUpdateLocation = App.updateLocation;
  const originalShowToast = UIController.showToast;
  const originalShowLoading = UIController.showLoading;
  const originalHideLoading = UIController.hideLoading;

  let toastMessages = [];
  let updateLocationArgs = null;

  const restoreNavigator = setMockNavigator({});

  try {
    UIController.showToast = (msg, isError) => {
      toastMessages.push({ msg, isError });
    };
    UIController.showLoading = () => {};
    UIController.hideLoading = () => {};

    App.updateLocation = async (...args) => {
      updateLocationArgs = args;
    };

    globalThis.window = {
      location: {
        search: ''
      }
    };
    globalThis.document = {
      getElementById: () => null
    };

    await App.handleInitialLocation();

    assert.ok(updateLocationArgs, 'updateLocationが初期地点で呼び出されていること');
    assert.strictEqual(updateLocationArgs[0], APP_CONFIG.DEFAULT_LAT);
    assert.strictEqual(updateLocationArgs[1], APP_CONFIG.DEFAULT_LNG);
    assert.strictEqual(updateLocationArgs[2], '新大阪駅周辺 (初期地点)');

    const hasToast = toastMessages.some(t => t.msg.includes('位置情報に対応していないため、初期地点（新大阪駅周辺）で開始します'));
    assert.ok(hasToast, '非対応時のフォールバック通知トーストが表示されること');
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    restoreNavigator();
    App.updateLocation = originalUpdateLocation;
    UIController.showToast = originalShowToast;
    UIController.showLoading = originalShowLoading;
    UIController.hideLoading = originalHideLoading;
  }
});

test('ManualLocation: ユーザー手動操作時の位置情報エラーでは自動フォールバックせずエラー案内を行う', async () => {
  const originalDocument = globalThis.document;
  const originalUpdateLocation = App.updateLocation;
  const originalShowToast = UIController.showToast;
  const originalShowLoading = UIController.showLoading;
  const originalHideLoading = UIController.hideLoading;

  let toastMessages = [];
  let updateLocationCalled = false;

  const restoreNavigator = setMockNavigator({
    geolocation: {
      getCurrentPosition: (success, error) => {
        const err = new Error('Permission denied');
        err.code = 1;
        err.PERMISSION_DENIED = 1;
        err.POSITION_UNAVAILABLE = 2;
        err.TIMEOUT = 3;
        error(err);
      }
    }
  });

  try {
    UIController.showToast = (msg, isError) => {
      toastMessages.push({ msg, isError });
    };
    UIController.showLoading = () => {};
    UIController.hideLoading = () => {};

    App.updateLocation = async () => {
      updateLocationCalled = true;
    };

    globalThis.document = {
      getElementById: () => null
    };

    // ユーザー手動操作: isUserInitiated = true
    await App.getCurrentLocation(true);

    assert.strictEqual(updateLocationCalled, false, '手動操作時のエラーでは勝手に地点更新を行わないこと');
    const hasErrorToast = toastMessages.some(t => t.isError && t.msg.includes('設定をご確認ください'));
    assert.ok(hasErrorToast, '設定確認エラーメッセージが表示されること');
  } finally {
    globalThis.document = originalDocument;
    restoreNavigator();
    App.updateLocation = originalUpdateLocation;
    UIController.showToast = originalShowToast;
    UIController.showLoading = originalShowLoading;
    UIController.hideLoading = originalHideLoading;
  }
});
