# Links-System 操作マニュアル（HTML）

社内向けの使い方です。機能ごとにHTMLを分け、一覧と詳細入力がある機能はページを分けます。画面の切り抜きを手順の横に置いてあります。

| ファイル | 対象 |
|----------|------|
| [`index.html`](index.html) | ポータル。システムの考え方と目次 |
| [`pages/daily-reports-list.html`](pages/daily-reports-list.html) | 日報一覧（確認用見本） |
| [`pages/daily-reports-input.html`](pages/daily-reports-input.html) | 日報入力（確認用見本） |
| [`developer.html`](developer.html) | 開発者向け。起動・設定・記入例 |

## 開き方

1. [`index.html`](index.html) を Chrome または Edge で開く
2. または NAS の共有フォルダから `docs/manual/index.html` を開く

アプリ本体（`:8080`）へのログインは不要です。計算の詳細は [`仕様MD/09_日報・精算・帳票_業務要件.md`](../../仕様MD/09_日報・精算・帳票_業務要件.md) を参照します。

## ページの約束

各機能ページは次の順で書きます。

1. この画面の役割
2. 誰が・いつ使うか
3. 具体例
4. 画面イメージと番号コールアウト
5. 何をどこに入れるか
6. 操作手順
7. 注釈・注意
8. 前後の画面リンク

画像は [`screenshots/`](screenshots/) の現行SPAキャプチャです。番号はCSSで重ねます。実顧客データは載せません。

## 印刷（A4）

左メニューの「A4で印刷」または `Ctrl+P`。用紙は A4。章ごとに改ページします。

## 現行画面の再撮影

```bash
cd backend
npx playwright install chromium   # 初回のみ
UI_BASE_URL=http://127.0.0.1:8080 npm run capture:manual
```

Cloud Agent ではポートが `3000` です。
