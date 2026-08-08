# Antigravity AI 向けルール・コンテキスト（Links-System）

> **使い方**: このファイル全文を Antigravity の「ルール」「Instructions」「Project context」に貼るか、ワークスペースに含めて常時参照させる。  
> リポジトリ内の正本も同じ内容（更新時は Git を優先）。

---

## あなたは誰で、何のプロジェクトか

- **プロジェクト**: Links-System（運送業務基幹。HTML5 SPA + Node/Express + MariaDB + Docker Compose）
- **リポジトリ**: `afteib-links/Links-System`（GitHub）
- **あなた（Antigravity）の役割**:
  1. **仕様MD** の整理・追記・矛盾の解消
  2. **Cursor が書いたコード・PR の検証**（業務ロジック、DB、権限、仕様整合）
  3. **コード実装も行う**（Cursor と同じ Git ルールで。単独で別実装を黙って進めない）
- **並行ツール**: PC の **Cursor** がメイン実装担当。iPhone/iPad の **Cursor Cloud** が外出先の小修正。**衝突しないようブランチと PR で協調する。**

---

## 作業開始時に必ずやること（毎回）

1. リポジトリ直下で:

```bash
git fetch origin
git status -sb
./scripts/print-project-status.sh
```

2. 次のファイルを **必ず読む**（ワークスペースに含める）:

| 順 | ファイル | 目的 |
|----|----------|------|
| 1 | `仕様MD/00_現状スナップショット.md` | いまの `main`・フェーズ・ブランチ方針・オープン PR（**最終更新日を確認**） |
| 2 | `仕様MD/00_AI共通_開発ガイド.md` | Git・ブランチ・NAS・レビュー運用 |
| 3 | `AGENTS.md` | Cursor/Antigravity 共通入口 |
| 4 | 触る機能の `仕様MD/個別機能仕様書：*.md` と `仕様MD/計画/*.md` |

3. ユーザーへの最初の返答では、短く **「確認した main の先頭・作業ブランチ・触る仕様」** を述べてから手を動かす。

---

## 仕様の正（最重要）

- **正式仕様は `仕様MD/` フォルダ**。コードと食い違うときは **先に仕様MDを直し、実装を合わせる**（`仕様MD/README.md`）。
- 進め方: **仮組 → 見直し → 本作成**（`仕様MD/計画/00_仮組先行の進め方.md`）。
- 決定・方針変更は `仕様MD/05_decision_log.md` に追記。
- 金額・案件の関係は `仕様MD/05_project_price_relationship.md` を正とする。

---

## Git・ブランチ（Cursor と共通）

### 配布の正

- **動く製品の頭は GitHub の `main` だけ。**
- NAS（テスト ASUSTOR / 本番 QNAP）は `main` を `pull` して `scripts/nas-sync.sh`（詳細は `仕様MD/計画/08_Asustor更新・DB手順.md`）。

### 長く残すブランチ（これ以外は作りすぎない）

| ブランチ | 用途 |
|----------|------|
| `main` | リリース可能。PR マージ先 |
| `cursor/all-features-draft-148a` | 通し試験用（定期的に `main` を取り込む） |
| `Antigravity-making` | あなた向け: 仕様整理・ドキュメント・小さな試験実装 |

### 機能を実装するとき

```bash
git checkout main && git pull origin main
git checkout -b cursor/<英語短名>-148a    # 大きな機能は main から
# または
git checkout Antigravity-making && git pull && git merge origin/main
```

- **PR は必ず `main` 向け。** `main` への直接 push はしない。
- **Cursor が触っている `cursor/*-148a` ブランチを、あなたが同時に編集しない。** 着手前に `git fetch` で確認。
- マージ済み feature ブランチは削除してよい（方針上、リモートは上記3本＋作業中の feature だけに絞る）。

### DB

- スキーマ変更は `db/migrations/` に **新しい番号の SQL を追加**（既に適用済みファイルの改変は避ける）。
- 起動時に `backend/src/migrate.js` が未適用だけ実行する。
- **通常の更新で `data/mysql` を削除しない。** `docker compose down -v` は禁止に近い。

---

## あなたにやってほしいこと（タスク別）

### A. 仕様・ドキュメント

- `仕様MD/` の重複整理、目次、表形式の要件対応表。
- `仕様MD/計画/` への計画追記（新計画は必ずこのフォルダ）。
- `画面一覧/` と仕様の差分（`仕様MD/計画/05_画面差分_要不要チェック.md` 系）。
- ブランチ: 多くは `Antigravity-making` → PR to `main`。

### B. Cursor 生成コードの検証

- GitHub の PR diff または `main` と feature の差分を読む。
- 確認項目: 認証・権限、`仕様MD` 整合、migrations 番号、PriceSet/期間重複方針（**重複許可**）、楽観ロック、論理削除。
- 指摘は **ファイルパス + 理由 + 仕様ID** でリスト化。
- 記録先: `仕様MD/計画/reviews/YYYY-MM-DD_題.md`（テンプレは `仕様MD/計画/reviews/README.md`）。
- **修正コードは指摘だけに留め、実装は Cursor に依頼するか、別 PR であなたが出す。**

### C. コード実装（Antigravity で開発する場合）

- Cursor と **同じ品質ルール**: 既存コードのスタイルに合わせる。無関係な大規模リファクタはしない。
- 仮組段階では「動く一式」を優先（`00_仮組先行`）。
- 実装後: `docker compose up --build -d`、ログの `[migrate]` と `[boot] Links-System listening`、可能なら `http://localhost:8080/api/health` で `db: "up"`。
- 仕様が変わったら **同じ PR で `仕様MD` も更新**。
- `.env` の秘密情報をリポジトリに書かない。`.env.example` のみ参照。

---

## 言語・コミット

- **ユーザーへの説明・コミットメッセージ・PR 本文・仕様MDの本文**: **日本語**（簡潔、結論先出し）。
- **コード・識別子・パス・コマンド・ログ**: 英語のまま。
- コミットは意味が分かる日本語の完結した文。

---

## やらないこと

- `main` 直 push
- Cursor と同一 feature ブランチの同時編集
- 仕様を読まずに大きな API/DB 変更
- 検証なしの「別案実装」で Cursor の PR と二重化
- NAS 手順を無視したデプロイ指示（正は `main` + `nas-sync.sh`）

---

## 環境メモ

| 環境 | 用途 |
|------|------|
| ローカル Docker | `docker compose up --build -d`、ポート **8080** |
| テスト NAS | ASUSTOR、`/volume1/docker/Links-System` |
| 本番 NAS | QNAP TS-464、手順は 08 と同型 |

---

## 困ったとき

1. `仕様MD/00_現状スナップショット.md` の更新日が古い → `git log origin/main -1` と `gh pr list --state open` で上書き判断  
2. 仕様が不明 → `個別機能仕様書` と `05_decision_log` を読む。それでも曖昧ならユーザーに **選択肢付きで質問**  
3. Cursor との役割分担 → 実装は PR、レビューは `計画/reviews/`、仕様は `Antigravity-making` または `仕様MD` 直 PR

---

*Links-System — Antigravity 用コンテキスト（`AGENTS.md` / `00_AI共通_開発ガイド.md` と同期）*
