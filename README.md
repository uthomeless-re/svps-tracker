# Shadowverse Premier Series 26-27 選手データトラッカー

Xフォロワー数・配信時間・視聴時間・動画本数・PS戦績を毎日自動取得し、
GitHub Pagesで折れ線グラフとして公開するためのリポジトリ一式です。

ランクマッチ最高順位（svlabo.jp由来）は自動取得から外し、手動運用にしています
（理由は「なぜsvlabo.jpだけ手動にしたか」を参照）。

## 構成

```
svps-tracker/
├── .github/workflows/daily-update.yml   毎日実行されるGitHub Actions
├── scripts/
│   ├── common.py            共通処理（選手マスタ読み込み、CSV書き出しなど）
│   ├── scrape_reference.py  shadowverse-reference.com から フォロワー数・配信関連 を取得（毎日自動）
│   ├── scrape_ps_results.py ps.shadowverse-wb.com から PS戦績（個人） を取得（毎日自動）
│   ├── scrape_svlabo.py     svlabo.jp から ランクマッチ最高順位・レート を取得（★自動実行からは除外。手動で使う用に残してあるだけ）
│   ├── update_history.py    上記のスナップショットを data/history.csv に統合
│   └── requirements.txt
├── data/
│   ├── players.csv          選手マスタ（2026ps-fixedのteams.jsonから抽出、8チーム37名）
│   ├── history.csv          蓄積される日次データ（ロング形式）
│   └── snapshots/           日次の生スクレイピング結果（デバッグ用、実行のたびに増える）
└── site/
    └── index.html           表示用ページ（Chart.js、個人別/チーム別・指標切替）
```

## セットアップ手順

1. このフォルダの中身を、あなたのGitHubリポジトリのルートにそのままコピーしてpushする
2. リポジトリの Settings → Pages → Source を「GitHub Actions」に設定する
3. Actionsタブで `Daily stats update` を一度 `Run workflow`（手動実行）して、正常に動くか確認する
4. 以降は毎日 22:00 JST に自動実行される（`.github/workflows/daily-update.yml` の cron で変更可能）
5. 公開URLは `https://<ユーザー名>.github.io/<リポジトリ名>/` になる

認証について: pushやPages公開は GitHub Actions が自動発行する `GITHUB_TOKEN` を使うので、
リポジトリのSecretsなどにあなた自身のトークンを登録する必要はありません
（workflow内の `permissions: contents: write / pages: write / id-token: write` だけで完結します）。

## なぜGitHub Actions方式にしたか

Cowork（Claude）側のスケジュール機能で毎日実行することも技術的には可能ですが、その場合
「GitHubに公開する」ためには結局GitHubへのpush用トークンをClaude側の実行環境に渡す必要があります。
認証情報をチャット上でやり取りしたり、外部の実行環境に持たせたりするのは避けたい方式のため、
スクレイピング〜データ更新〜コミット〜Pages公開まで**すべてGitHubのインフラ内で完結する**
GitHub Actions方式を採用しています。Claude側では初期セットアップ（このリポジトリ一式の作成）だけを行いました。

## なぜsvlabo.jpだけ手動にしたか

svlabo.jp（ランクマッチ最高順位）は当初、毎日自動取得→毎月1日のみ自動取得、と段階的に
自動化しようとしていましたが、以下の理由で完全に自動化対象から外し、手動運用に変更しました。

- 元々ランクマッチの最高順位は月1回程度しか動かないデータで、頻繁な自動更新の必要性が薄い
- 3サイトの中で唯一FC2側のボット検知に引っかかり、User-Agent偽装等の対策が必要だった
  （個人運営のFC2ブログなので、今後も同様の検知強化が入るリスクがある）
- テーブルの区切り文字（タブか改行か）が実際に動かすまで分からず、他の2サイトより
  デバッグに時間がかかった
- 取得したデータをそのまま使うのではなく手元で加工したい、という利用イメージだったため、
  自動でhistory.csvに混ぜ込む設計自体が過剰だった

`scripts/scrape_svlabo.py` 自体は動作する状態で残してあります。使いたくなったら
`cd scripts && python scrape_svlabo.py && python update_history.py` を手元やActionsの
手動実行で叩けば、今まで通り `data/history.csv` に取り込めます。使わないなら
`scripts/scrape_svlabo.py` を削除しても他のスクリプトには影響しません。

## 既知の制約・注意点

- **shadowverse-reference.comは非公式のファンサイトです**（ps.shadowverse-wb.comは公式サイト）。
  仕様変更やサイト停止のリスクは常にあります。各スクリプトは失敗しても他のスクリプトの実行を
  妨げないように `continue-on-error: true` にしていますが、パースが崩れた場合は
  `data/snapshots/*_debug*.json` や `*_raw*.json` を見て正規表現/パーサーを調整してください。
  （各スクリプトは失敗時もこのデバッグ用の生テキストを必ず保存し、ログにも直接出力するようにしています）
- **shadowverse-reference.com**: Xフォロワー数は「現在値」のみが取得できます（このサイト自体に
  過去の履歴はない）。そのため、フォロワー数の推移グラフは このスクリプトを動かし始めた日から
  蓄積されていきます。配信時間・視聴時間・再生回数・動画本数は隔週の期間集計を過去分までさかのぼって
  取得できます。なお実データ確認の結果、各行の順位・選手名の後ろに単独のタブ文字だけの行が
  挟まっていたため、パース前にタブ文字を除去する処理を入れています。
- **ps.shadowverse-wb.com（PS戦績）**: 「試合結果詳細」モーダルは実際にGitHub Actions上で
  取得した生テキストを元に、「BATTLE Nトークンの前後を選手名/クラス/勝敗/獲得ポイントとして
  読み取る」ロジックに書き換え済みです（`parse_battles()`）。「チームバトル」という
  個人に紐づかない対戦枠は成績から除外しています。
- **開発環境での制約**: このリポジトリのコードは、Claudeの実行サンドボックス環境ではネットワーク制限により
  Playwrightのブラウザバイナリをダウンロードできず、実際にブラウザを起動しての動作確認はできません。
  そのため、GitHub Actions上で実際に取得された生ログ（タイムスタンプ付きログファイル）を
  ダウンロードして送ってもらい、そのテキストに対してパース処理を書いて検証する、というやり方で
  デバッグしています。今後もエラーが出た場合は、Actionsの実行結果ページ右上の「...」から
  「Download log archive」でログ一式をダウンロードし、このチャットに添付してもらえれば
  同じ方法で調査できます。

## history.csv のスキーマ

| 列 | 内容 |
|---|---|
| date | 取得日（JST） |
| team_tag | チーム略称（CR/ZETA/DFM/VRL/MRG/RC/RDL/LVH） |
| player_name | 選手名（players.csv基準） |
| metric | 指標名（followers, stream_duration, ps_win など。svlabo.jpを手動で取り込んだ場合は cr_rank_エルフ 等も入る） |
| period | 期間キー（current, jul_early_2026, cumulative_to_date, 節ラベルなど） |
| value | 数値 |

## 次にやると良さそうなこと

- 過去分のバックフィル（shadowverse-reference.comの隔週データは4月前半まで遡れるので、
  初回だけ手動でperiodループを回して過去分を先に埋めておくと、公開初日からグラフに厚みが出る）
- PS戦績のクラス別勝率など、history.csvを使った追加集計ページ
