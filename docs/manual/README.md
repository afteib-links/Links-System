# Links-System マニュアル資料

利用者向けの正式なHTMLマニュアルは、リポジトリ直下の [`利用マニュアル/`](../../利用マニュアル/) にあります。システム稼働中は `/manual/` で開きます。

このフォルダには [`developer.html`](developer.html) と、その表示に必要な既存スタイル・開発用画面資料を残します。

## 開き方

利用者向けはChromeまたはEdgeで `利用マニュアル/index.html` を開くか、稼働中のシステム上部にある「利用マニュアル」を押します。アプリへのログインは不要です。

## 印刷

利用者向けマニュアルの「この章を印刷」または「全体を印刷」を使います。用紙はA4です。

## 画面の再撮影

```bash
cd backend
npx playwright install chromium
UI_BASE_URL=http://127.0.0.1:8080 npm run capture:manual
```

出力先は `利用マニュアル/screenshots/` です。匿名の検証データ環境だけで実行してください。
