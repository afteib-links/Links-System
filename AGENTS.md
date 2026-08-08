# Links-System — AI 共通エントリ（Cursor / Antigravity）

**作業を始める前に、必ず次を読む。**

| 順 | ファイル | 内容 |
|----|----------|------|
| 1 | [`仕様MD/00_現状スナップショット.md`](仕様MD/00_現状スナップショット.md) | **いまのブランチ・進捗・未完了**（要更新日付の確認） |
| 2 | [`仕様MD/00_AI共通_開発ガイド.md`](仕様MD/00_AI共通_開発ガイド.md) | ツール役割・Git・仕様の正・衝突回避 |
| 3 | [`仕様MD/README.md`](仕様MD/README.md) | 仕様フォルダの索引 |

## クイック確認コマンド（リポジトリ直下）

```bash
git fetch origin
git status -sb
git log origin/main -1 --oneline
./scripts/print-project-status.sh   # あれば実行
```

## リポジトリ

- GitHub: `afteib-links/Links-System`
- 配布の正: **`main`** → NAS は `git pull origin main` + [`scripts/nas-sync.sh`](scripts/nas-sync.sh)

## Cursor

- 追加ルール: `.cursor/rules/`
- 作業ブランチ: `cursor/<英語短名>-148a`（Cloud Agent も同様）

## Antigravity

- **この `AGENTS.md` と `仕様MD/00_*` をワークスペースに常時含める**
- 開発も行う場合: **実装前に `git fetch` と現状スナップショットを確認**し、ブランチを Cursor と重複させない（ガイド §4）
- 仕様・レビュー中心ブランチ: `Antigravity-making`（docs / 試験的変更）

## 言語

- ユーザー向け返答・コミット・PR・`仕様MD/`: 日本語
- コード・パス・コマンド: 英語のまま
