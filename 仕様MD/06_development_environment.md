# 運送業務基幹システム：開発環境・実行基盤仕様書

## 1. 本ドキュメントの目的

現行の個別機能仕様書は「HTML5 SPA + IndexedDB（ブラウザ内ローカル保存）」を前提としている。  
一方、実運用では次の条件がある。

* 約4名が同時にアクセスし、データを変更する
* Asustor NAS 上で常時稼働させる

この条件では **IndexedDB / LocalStorage だけではデータ共有・同時更新が成立しない**。  
本ドキュメントは、仕様の画面・業務ロジックを維持したまま、NAS運用に耐える開発・実行基盤を定義する。

---

## 2. 現行仕様からの変更判断（重要）

| 項目 | 現行仕様 | 本基盤での方針 |
|------|----------|----------------|
| UI形態 | HTML5 SPA | **維持**（画面構成・操作感はそのまま） |
| データ保存 | IndexedDB / LocalStorage | **NAS上の共有データベースへ変更** |
| 通信 | ブラウザ内のみ | **REST API（または同等のHTTP API）経由** |
| 同時更新 | 想定なし | **楽観的ロック（optimistic locking）で制御** |
| 配布形態 | 単体HTML想定 | **Docker Compose でNASへ配備** |

> 結論：フロントは「HTML5 SPA」のまま。データ層だけを「端末ローカル」から「NAS共有DB」へ移す。

---

## 3. 推奨アーキテクチャ概要

```text
[ブラウザ × 最大4名]
        │  HTTP (社内LAN)
        ▼
[Asustor NAS]
  ┌─────────────────────────────────────┐
  │  Docker Compose                     │
  │  ┌──────────────┐  ┌─────────────┐ │
  │  │ App容器       │  │ DB容器       │ │
  │  │ - SPA静的配信 │→│ MariaDB     │ │
  │  │ - APIサーバー │  │ (永続Volume) │ │
  │  └──────────────┘  └─────────────┘ │
  └─────────────────────────────────────┘
```

### 3.1 構成コンポーネント

| 層 | 技術 | 役割（日本語の説明） |
|----|------|----------------------|
| フロントエンド | HTML5 / CSS3 / JavaScript（SPA） | 画面表示・入力・即時計算プレビュー |
| バックエンド | Node.js + Express（または Fastify） | API提供、権限・締め処理・帳票生成のサーバ側固定 |
| DB | MariaDB 10.11系（Docker） | 共有データ保存、同時書き込み耐性 |
| 配備 | Docker Compose | NAS再起動後も自動起動、バックアップしやすい構成 |
| リバースプロキシ | 任意（Nginx / ADMのWeb機能） | HTTPS化や社内ドメイン割り当て時に使用 |

### 3.2 なぜこの構成か（4名・NAS前提）

1. **Asustorは Docker Engine（Compose含む）に対応**しており、アプリをコンテナで安定稼働させやすい。  
2. **4名同時更新**ではブラウザ内DBは不可。共有DBが必須。  
3. MariaDBは同時書き込みに強く、締め処理・承認フローのトランザクション（一連の更新をまとめて確定する処理）に向く。  
4. SPAを維持すれば、既存の画面仕様書をほぼそのまま実装指示に使える。  
5. MVP（最小限で動く初期版）として1週間稼働を目指す現行方針とも整合する。

### 3.3 採用しない案と理由

| 案 | 理由 |
|----|------|
| IndexedDBのみ | 端末ごとにデータが分かれ、他ユーザーと共有できない |
| 静的HTML + JSONファイル直書き | 同時保存で破損・上書き競合が起きやすい |
| 重いクラウドBaaS依存 | NAS内完結・オフライン/社内LAN運用の前提と合わない |
| 巨大フレームワーク全面採用 | MVP期間とNAS資源を圧迫しやすい（必要最小限に留める） |

---

## 4. 開発環境仕様（ローカル）

### 4.1 必須ツール

| ツール | 想定バージョン | 用途 |
|--------|----------------|------|
| Node.js | 20 LTS 以上 | API開発・フロントビルド |
| npm または pnpm | 最新安定版 | 依存パッケージ管理 |
| Docker Desktop / Docker Engine | Compose v2対応 | ローカルでNAS相当の構成を再現 |
| Git | 2.x | ソース管理 |
| ブラウザ | Chrome / Edge 最新 | 画面確認（スマホ表示もDevToolsで確認） |

### 4.2 推奨ディレクトリ構成

```text
Links-System/
├── 仕様MD/                 # 業務・画面仕様（既存）
├── docs/                   # 開発メモ・運用手順（任意）
├── frontend/               # SPA（HTML/CSS/JS）
├── backend/                # Node.js API
├── db/                     # 初期SQL・マイグレーション
├── docker-compose.yml      # 開発・本番共通の骨格
├── .env.example            # 環境変数テンプレート
└── README.md
```

### 4.3 ローカル起動の基本方針

1. `docker compose up -d` で MariaDB を起動  
2. backend でマイグレーション（DB構造の適用）を実行  
3. backend API を `http://localhost:3000` で起動  
4. frontend を同一オリジン、または開発用プロキシ経由で配信  
5. ブラウザから画面操作 → API → DB の経路を常に確認する

> 開発中も「IndexedDBに逃がさない」。最初からAPI経由に統一し、NAS配備時の手戻りを防ぐ。

### 4.4 環境変数（例）

```bash
# .env.example
APP_PORT=3000
DB_HOST=db
DB_PORT=3306
DB_NAME=links_system
DB_USER=links
DB_PASSWORD=changeme
SESSION_SECRET=changeme
TZ=Asia/Tokyo
```

---

## 5. Asustor NAS 実行環境仕様

### 5.1 NAS側の前提

* App Central から **Docker Engine** を導入（Compose v2利用）
* 必要に応じて **Portainer** でコンテナ管理
* データ永続化用に共有フォルダを用意（例: `/volume1/Docker/links-system`）
* 社内LANからのHTTPアクセスを許可（Firewall設定）

### 5.2 配備イメージ

```yaml
# docker-compose.yml（概念）
services:
  db:
    image: mariadb:10.11
    restart: unless-stopped
    environment:
      MYSQL_DATABASE: links_system
      MYSQL_USER: links
      MYSQL_PASSWORD: ${DB_PASSWORD}
      MYSQL_ROOT_PASSWORD: ${DB_ROOT_PASSWORD}
      TZ: Asia/Tokyo
    volumes:
      - ./data/mysql:/var/lib/mysql
    ports:
      - "3306:3306"   # 本番では社外公開しない

  app:
    build: .
    restart: unless-stopped
    depends_on:
      - db
    environment:
      DB_HOST: db
      DB_PORT: 3306
      DB_NAME: links_system
      DB_USER: links
      DB_PASSWORD: ${DB_PASSWORD}
      TZ: Asia/Tokyo
    ports:
      - "8080:3000"   # http://NASのIP:8080 でアクセス
    volumes:
      - ./data/uploads:/app/uploads   # 将来のスキャン画像など
```

### 5.3 運用上の最低ライン（4名同時利用）

* 同時接続: 4〜10程度を想定（それ以上は要スケール検討）
* CPU/メモリ: 小型Asustorでも可。ただしDBとAppは永続Volume必須
* バックアップ: MariaDBデータディレクトリ、または `mysqldump` をNASのバックアップ機能へ組み込む
* 時刻: `TZ=Asia/Tokyo` を統一（締日・勤務日計算のズレ防止）

---

## 6. 同時更新・データ整合性ルール

仕様上、日報承認・請求締め・支払締めは「確定後ロック」が重要。  
複数人が触る前提で、次を必須とする。

### 6.1 楽観的ロック（optimistic locking）

* 各更新対象テーブルに `updated_at` または `version` を持つ  
* 更新時に「取得時の版」と一致する場合のみ保存成功  
* 不一致なら「他のユーザーが先に更新しました。再読み込みしてください」を返す  

### 6.2 締め処理はサーバ側トランザクション

* 請求締め・支払締めは **API内の1トランザクション** で実行  
* スナップショット保存と日報ステータス更新を同時確定  
* 途中失敗時は全部ロールバック（一部だけ確定しない）

### 6.3 権限の最小分割（MVP）

| ロール | できること |
|--------|------------|
| 事務担当 | マスタ参照、日報入力・確定 |
| 管理者 | 承認、締め、帳票発行、マスタ編集 |
| （将来）閲覧専用 | 参照のみ |

> MVPでは「簡易ログイン（ユーザーID + パスワード）」で十分。社内LAN前提でも、無認証の全開放は避ける。

---

## 7. 既存仕様書との読み替えルール

個別機能仕様書の次の文言は、実装時に以下へ読み替える。

| 仕様書の表記 | 実装時の読み替え |
|--------------|------------------|
| IndexedDB（またはLocalStorage）へ保存 | API経由でMariaDBへ保存 |
| ブラウザ内で完結 | SPA + API。計算プレビューはフロントでも可、確定値はサーバで再計算・保存 |
| 単体HTMLで動作 | 開発時は分割可。本番は `app` 容器が静的ファイルとAPIを同居配信してよい |
| `extra_data` JSON領域 | MariaDBの JSON型、または TEXT で保持 |

計算ロジック（超過時間、定額控除、先払い差引、消費税切り捨て）は  
`04_calculation_logic.md` および各画面仕様を正とし、**確定処理時はサーバ側でも再計算して固定化**する。

---

## 8. MVP開発の進め方（推奨順）

1. **基盤**: Docker Compose + DBスキーマ + 認証API  
2. **マスタ**: 企業 → パートナー → 案件（改定履歴含む）  
3. **日報**: 登録・一覧・承認フロー  
4. **金流**: 先払い → 請求締め → 支払締め・帳票  
5. **NAS配備**: 社内IPで4名試験運用、バックアップ確認  

---

## 9. 未確定事項（次に決めること）

実装着手前に、次を確定する。

1. Asustorの機種（CPUアーキテクチャ: x86_64 / ARM）とADMバージョン  
2. 社内アクセス方法（`http://192.168.x.x:8080` でよいか、ドメイン/HTTPSが必要か）  
3. ユーザー認証の方式（簡易ID/パスワードでよいか）  
4. 帳票は「ブラウザ印刷CSS」優先か、「サーバPDF生成」優先か  
5. 将来のスキャン画像保存先（NAS共有フォルダのパス）

---

## 10. 決定事項（本ドキュメント時点）

* UIは HTML5 SPA を維持する  
* データ保存は IndexedDB ではなく、NAS上の共有DB（MariaDB）とする  
* 実行基盤は Docker Compose を標準とする  
* 同時更新は楽観的ロック + 締め処理のトランザクションで担保する  
* ローカル開発も最初から API + DB 構成で行う（後から載せ替えない）
