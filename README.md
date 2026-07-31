# Links-System（運送業務基幹システム）

Excel管理の運送業務（案件・パートナー・収支）をWeb化する社内システムです。
詳細な業務・画面仕様は [`仕様MD/`](./仕様MD/) を参照してください。

## 技術スタック

| 層 | 技術 |
|----|------|
| フロントエンド | HTML5 / CSS / JavaScript（SPA） |
| バックエンド | Node.js 20+ / Express |
| データベース | MariaDB 10.11 |
| 配備 | Docker Compose（QNAP Container Station） |

現状は仕様 §8 の第一段階「基盤（Docker Compose + DBスキーマ + 認証API）＋最小SPA」を実装しています。
実装済み機能: 簡易ログイン（JWT）と企業マスタ（一覧・登録、楽観的ロック対応）。

## ディレクトリ構成

```text
├── 仕様MD/            # 業務・画面仕様
├── backend/           # Node.js + Express API
├── frontend/          # SPA（HTML/CSS/JS）
├── db/                # 初期SQL（スキーマ）
├── docker-compose.yml # DB/アプリ配備
├── Dockerfile         # アプリ容器
└── .env.example       # 環境変数テンプレート
```

## ローカル開発の始め方

### 1. データベースを起動

Docker を使う場合:

```bash
docker compose up -d db
```

ネイティブ MariaDB を使う場合は、`links_system` データベースと `links` ユーザーを用意してください
（Cursor Cloud 環境での手順は `AGENTS.md` を参照）。

### 2. 環境変数を用意

```bash
cp .env.example .env
```

### 3. バックエンド（API + SPA配信）を起動

```bash
cd backend
npm install
npm run dev        # ホットリロード（node --watch）
```

起動後、ブラウザで <http://localhost:3000> を開きます。
初期管理者は `admin` / `admin123`（`.env` で変更可）。

## 本番（NAS）配備

```bash
docker compose up -d --build
```

`http://<NASのIP>:8080` でアクセスします（仕様 §5）。
