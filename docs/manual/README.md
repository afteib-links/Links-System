# Links-System 操作マニュアル（HTML）

社内向けの使い方です。機能ごとにHTMLを分け、一覧と詳細がある機能はページを分けます。実画面の切り抜きを手順の横に置いてあります。

入口は [`index.html`](index.html)。各機能は [`pages/`](pages/) です。開発者向けは [`developer.html`](developer.html)。

## 開き方

Chrome または Edge で `index.html` を開きます。アプリへのログインは不要です。

## ページの書き方

短い文章で画面を見せ、表は「ここ / 何をするか」にします。計算式の詳細は仕様書側です。

## 印刷

左の「印刷する」または `Ctrl+P`。用紙は A4。

## 画面の再撮影

```bash
cd backend
npx playwright install chromium
UI_BASE_URL=http://127.0.0.1:8080 npm run capture:manual
```
