# Links-System — Antigravity 用の補助入口

このファイルは Antigravity 固有の最小限の補助指示です。共通ルールをここへ複製しません。作業前に、同じワークスペースにある次の正本を読むこと。

1. `AGENTS.md`
2. `仕様MD/00_現状スナップショット.md`
3. `仕様MD/00_AI共通_開発ガイド.md`
4. 変更対象の仕様MD

日報・精算系の作業では、`仕様MD/09_日報・精算・帳票_業務要件.md` と `仕様MD/10_入出金管理・FB_業務要件.md` を必ず読む。

## Antigravity 固有の運用

- 最初に `git fetch origin`、`git status -sb`、`git log origin/main -1 --oneline` を確認する。
- 作業は Issue / Draft PR に記録された担当範囲だけに限定する。Cursor・Codexが同じ範囲を作業中なら編集しない。
- 仕様整理・レビュー・コード実装はいずれも可能。ただし仕様変更は `仕様MD/` と `05_decision_log.md` に記録してから実装する。
- `main` への直接push、既存migrationの書換え、`data/`・`.env`・実データの削除は禁止。
- PRレビューは `仕様MD/計画/reviews/` に保存し、実装作業は別PRへ分離する。

詳細は `AGENTS.md` と `仕様MD/00_AI共通_開発ガイド.md` を正とする。
