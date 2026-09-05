# Links-System — 全AI共通エントリ

Cursor、Antigravity、Codex、Cloud Agent、将来追加するAIが、同じ業務仕様・開発状況・Git運用で作業するための入口です。

## 作業開始時に必ず読む

1. [`仕様MD/00_現状スナップショット.md`](仕様MD/00_現状スナップショット.md) — 現在地、未完了、ブランチ方針
2. [`仕様MD/00_AI共通_開発ガイド.md`](仕様MD/00_AI共通_開発ガイド.md) — 詳細な開発・Git・検証ルール
3. 変更対象の仕様MD

日報・請求・支払・前払・分割・帳票・入出金管理・FBに触れる場合は、加えて次を必ず読む。

- [`仕様MD/09_日報・精算・帳票_業務要件.md`](仕様MD/09_日報・精算・帳票_業務要件.md)
- [`仕様MD/10_入出金管理・FB_業務要件.md`](仕様MD/10_入出金管理・FB_業務要件.md)
- [`仕様MD/05_project_price_relationship.md`](仕様MD/05_project_price_relationship.md)

機械確認（利用可能な環境のみ）:

```bash
git fetch origin
git status -sb
git log origin/main -1 --oneline
./scripts/print-project-status.sh
```

## 仕様の優先順位

1. ユーザーが明示的に合意し、`仕様MD/` と `05_decision_log.md` に記録した内容
2. `09_日報・精算・帳票_業務要件.md`、`10_入出金管理・FB_業務要件.md` と対象の個別機能仕様書
3. `仕様MD/計画/` の合意済み計画
4. 現行コードと `html_prototypes/`（実装の事実・UI参考。業務仕様そのものではない）
5. `仕様MD/旧システム設計/` と旧Excel（再利用候補の資料。単独では新仕様にしない）

同じ論点で資料が矛盾し、優先順位で解消できない場合は、推測で実装しない。`仕様MD/05_decision_log.md` に論点を残し、ユーザーへ確認する。

## 複数AIでの作業単位

- **1作業 = 1 GitHub Issue（または事前に合意した作業ID）= 1ブランチ = 1 Draft PR** を原則とする。
- Issue / Draft PR に、担当AI、変更可能なファイル範囲、完了条件、未完了、検証結果、次の作業を記載する。テンプレートは [`.github/`](.github/) と [`docs/development/AI_WORK_REQUEST_TEMPLATE.md`](docs/development/AI_WORK_REQUEST_TEMPLATE.md)。
- 同じIssue・同じブランチ・同じファイル群を複数AIが同時編集しない。並行作業は、Issueと編集範囲が分離できる場合だけ行う。
- 作業中の状態は共有Markdownを直接書き換える「ロック」ではなく、GitHub Issue と Draft PR を正本にする。これにより端末・AIが替わっても引き継げる。

## 変更の安全ルール

- `main` へ直接pushしない。`origin/main` から `cursor/<英語短名>-148a` を作り、PRでマージする。`cursor/` は歴史的な接頭辞であり、Cursor専用ではない。
- 既適用の `db/migrations/*.sql`、`data/`、実DB、`.env`、バックアップを削除・書換えしない。DB変更は新しい連番migrationにする。
- 顧客・パートナーの個人情報、口座情報、実Excel、PDF帳票、FAX画像、FBファイル、DBダンプをリポジトリへ追加しない。テストには匿名化した最小データだけを使う（詳細: [`docs/development/TEST_DATA_AND_SECRETS.md`](docs/development/TEST_DATA_AND_SECRETS.md)）。
- 金額計算、控除、税、帳票、認証、権限、Docker/NAS、依存関係を変えるPRには、影響範囲・移行/復旧手順・検証結果を必ず書く。
- 業務仕様を変える場合は、コードより先に該当の仕様MDと決定ログを更新する。
- 実装後は変更規模に応じて静的確認、API/画面確認、`docker compose up --build -d`、`/api/health` を実施し、未実施なら理由をPRに残す。

## AIごとの補助ファイル

- Cursor: `.cursor/rules/ai-shared-entry.mdc`
- Antigravity: `ANTIGRAVITY.md`
- Codex: この `AGENTS.md` を直接読む

これらは補助入口であり、業務仕様と開発ルールの正本は上記の `仕様MD/` と本ファイルに置く。内容を複製して別の正本を作らない。

## Docker更新の自動実行

- ユーザーが「Docker更新」「Dockerを更新」等を依頼した場合は、`.cursor/skills/docker-update/SKILL.md` を読み、必ずリポジトリ管理の更新ツールを実行する。手動のComposeコマンドへ置き換えない。
- 環境指定がなければ現在の作業環境だけを更新する。Windowsは `pwsh -NoProfile -File scripts/docker-update.ps1`、Linux/macOSは `bash scripts/docker-update.sh` を使う。
- NAS、ASUSTOR、QNAPが明示された場合だけ、対象環境で `bash scripts/docker-update.sh --nas --backup` を使う。
- `/api/health` が `db: "up"` を返して初めて成功とする。通常更新でDBボリュームや `data/mysql` を削除しない。

## 言語

- ユーザー向け返答、コミット、PR、Issue、`仕様MD/`、開発運用文書: 日本語
- コード、パス、コマンド、識別子、ログ: 英語のまま
