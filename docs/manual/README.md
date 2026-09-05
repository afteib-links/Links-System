# Links-System 画面俯瞰マニュアル

利用者向けの **全体像確認用** HTML マニュアルです。詳細な運用手順ではなく、「どの画面で、何をすると何が起きるか」を全機能分まとめています。

画面画像は **現行SPA**（`localhost:8080` と同じフロント）を撮影したものです。旧 `仕様MD/画面一覧/` は使いません（第18章の未提供画面だけ例外）。

## 開き方

1. [`index.html`](index.html) をブラウザで開く（Chrome / Edge 推奨）
2. 画像は同じフォルダの [`screenshots/`](screenshots/) を相対参照します

アプリ本体とは別ファイルです。閲覧にログインは不要です。

## 印刷（A4）

1. 左メニューの「A4で印刷」または `Ctrl+P` / `Cmd+P`
2. 用紙: **A4**
3. 章ごとに改ページします

## 現行画面の再撮影

PC でシステムが `http://localhost:8080` で動いているとき:

```bash
cd backend
npx playwright install chromium   # 初回のみ
UI_BASE_URL=http://127.0.0.1:8080 npm run capture:manual
```

Cloud Agent 環境ではポートが `3000` です（中身は同じアプリ）。

撮影結果は `docs/manual/screenshots/*.png` を上書きします。匿名の検証データ推奨です。実顧客データはリポジトリへ入れないでください。

## 対象外

- NAS / Docker の起動手順
- 計算式の詳細
- 開発・AI 運用ルール
