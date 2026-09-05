# Links-System マニュアル（HTML）

| ファイル | 対象 |
|----------|------|
| [`index.html`](index.html) | 利用者向け。全画面の「すると → どうなる」 |
| [`developer.html`](developer.html) | 開発者向け。機能説明・設定の入力方法・記入例（3件以上） |

どちらも同じ [`manual.css`](manual.css) で画面閲覧と **A4印刷** ができます。画像は [`screenshots/`](screenshots/)（現行SPA）。

## 開き方

ブラウザで HTML を開きます（Chrome / Edge 推奨）。アプリ本体へのログインは不要です。

## 印刷（A4）

左メニューの「A4で印刷」または `Ctrl+P`。用紙は A4。章ごとに改ページします。

## 現行画面の再撮影

```bash
cd backend
npx playwright install chromium   # 初回のみ
UI_BASE_URL=http://127.0.0.1:8080 npm run capture:manual
```

Cloud Agent ではポートが `3000` です。実顧客データはリポジトリへ入れないでください。
