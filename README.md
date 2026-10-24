# 防災ハザードマップ & 指定緊急避難場所ナビ（静的HTMLアプリケーション）

国土地理院のオープンデータ（タイル地図・ハザード情報・指定緊急避難場所GeoJSON）を活用し、ブラウザ単独で完全動作する防災Webアプリケーションです。

---

## 🌟 主な特徴

- **完全静的・サーバーレス**:
  - Google Apps Script (GAS) や外部バックエンドサーバーへの依存を完全に排除。
  - ユーザーマスター連携も撤廃し、GitHub Pages、AWS S3、Cloudflare Pages等の静的ホスティングで即座に公開可能。
- **安心のキーレス・完全無料運用**:
  - 商用APIキー（Google Maps Platform等）は一切不要。APIキー漏洩リスクがゼロです。
- **国土地理院オープンデータ連携**:
  - **ベースマップ**: 国土地理院標準地図タイル
  - **ハザードレイヤー**: 洪水浸水想定区域、土砂災害警戒区域、津波浸水想定区域（都道府県別自動特定）
  - **指定緊急避難場所**: 6つの災害種別（洪水・土砂・高潮・地震・津波・火事）のGeoJSONタイルを並行取得し、徒歩所要時間（80m/分、迂回係数1.25倍）を算出。
- **福祉避難所・要配慮者向け施設の識別**:
  - 要介護者・要配慮者優先施設（紫マーカー）と一般避難場所（青マーカー）を色分け・アイコン識別。
- **双方向インタラクション**:
  - 地図ピンクリック ⇄ サイドバー避難所カードのスムーズスクロール＆ハイライト連動。
  - 住所・ランドマーク検索機能（国土地理院住所検索API `msearch`）。
  - 代表的な災害リスク確認用サンプル地点移動（大阪淀川、北海道札幌、広島八木、静岡三保）。

---

## 🚀 ローカル起動方法

本アプリケーションは ES Modules（`import` / `export`）を使用しているため、ブラウザセキュリティの制約上、`file://` プロトコル（直接ダブルクリック）ではなく、**ローカルWebサーバー経由**で起動してください。

### 方法 1: Node.js (npx) を使用する場合（推奨）

```bash
# プロジェクト直下で実行
npx serve .
# または
npx http-server . -p 8000
```
起動後、ブラウザで表示されたURL（例: `http://localhost:3000` または `http://localhost:8000`）にアクセスします。

### 方法 2: Python を使用する場合

```bash
# Python 3
python -m http.server 8000
```
起動後、ブラウザで `http://localhost:8000` にアクセスします。

### 方法 3: VSCode Live Server を使用する場合

VSCode の拡張機能「Live Server」をインストールし、`index.html` を右クリックして「Open with Live Server」を選択します。

---

## 🧪 単体テスト・自動検証の実行

Node.js 組み込みのテストランナー（`node:test`）を採用しているため、追加のパッケージインストールなしで即座にテストを実行できます。

```bash
# 全テスト（単体・エッジケース・是正検証テスト計31件）を実行
node --test tests/*.test.js
```

---

## 📁 ディレクトリ構成

```text
HazardMap-app/
├── index.html                  # アプリケーション骨格DOM・UI
├── README.md                   # 本ドキュメント
├── css/
│   └── style.css               # カスタムレイアウト・ピンアニメーション
├── js/
│   ├── config.js               # システム定数・URL・ハザード定義
│   ├── geocoding-service.js    # 住所検索・逆ジオコーダ連携
│   ├── map-service.js          # Leaflet地図・レイヤー・ピン操作
│   ├── shelter-service.js      # タイル計算・GeoJSON取得・距離計算
│   ├── ui-controller.js        # DOM更新・トースト・ローディング制御
│   └── app.js                  # メインオーケストレータ・イベント調停
├── tests/
│   ├── config.test.js          # 設定・定数の健全性テスト
│   ├── geocoding.test.js       # ジオコーディング単体テスト
│   ├── shelter.test.js         # タイル計算・距離/徒歩時間計算テスト
│   └── qa-edge-cases.test.js   # QAエッジケース・耐障害性・セキュリティテスト
└── docs/
    ├── architecture.md         # システムアーキテクチャ設計書 (Phase 1)
    ├── implementation-plan.md  # 実装計画・タスク仕様書 (Phase 2)
    ├── implementation-report.md# 実装・検証完了報告書 (Phase 3)
    ├── qa-report.md            # QA検証レポート (Phase 4)
    └── audit-report.md         # ソフトウェア監査・最終レビュー報告書 (Phase 5)
```
