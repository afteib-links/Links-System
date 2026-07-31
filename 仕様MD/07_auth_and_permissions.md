# 運送業務基幹システム：ログイン・認証の実装メモ

詳細な正式仕様は **`Login.md`** を正とする。  
本ファイルは実装上の参照用サマリである。

* 認証方式: ログインID + パスワード（セッションCookie）
* 権限: `Login.md` の複数権限（admin / system / executive / soumu / sales / partner / company）
* ユーザー項目: No, ID, 名, 権限, パスワード, 所属部署, 所属エリア, 有効フラグ
* API: `/api/auth/*`, `/api/users/*`
* 仕様変更時は必ず `Login.md` を更新する
