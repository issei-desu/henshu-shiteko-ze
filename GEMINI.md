# プロジェクト開発・運用ルール (Project Rules)

## コミット・プッシュ時の必須ルール
コミットやプッシュ（`git commit` / `git push`）を行う際は、**毎回必ず**以下の手順を実施すること：

1. **`index.html` 内の最終更新日時を現在の日時（分単位まで）に更新する**
   - 対象箇所: `<span class="build-timestamp">最終更新: YYYY/MM/DD HH:MM</span>`
   - 例: `最終更新: 2026/10/22 17:05`
2. **CSSやJSを変更した場合は、キャッシュバスティング（クエリパラメータ）をインクリメント・更新する**
   - 例: `<link rel="stylesheet" href="style.css?v=YYYYMMDD_XX" />`
   - 必要に応じて `sw.js` のキャッシュバージョン（`CACHE_NAME`）も更新する
