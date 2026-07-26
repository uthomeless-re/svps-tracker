# Shadowverse Premier Series 26-27 選手データトラッカー

Xフォロワー数・YouTube登録者数・配信時間・視聴時間・動画本数・PS戦績を毎日自動取得し、
GitHub Pagesで折れ線グラフとして公開するためのリポジトリ一式です。表示側（`site/`）は
選手一覧・選手詳細（折れ線グラフ）・ランキングの3ページ構成で、単にデータを溜めるだけでなく
表示まで一体になっています。

ランクマッチ最高順位（svlabo.jp由来）は自動取得から外し、手動運用にしています
（理由は「なぜsvlabo.jpだけ手動にしたか」を参照）。

## 構成

```
svps-tracker/
├── .github/workflows/daily-update.yml   毎日実行されるGitHub Actions（スクレイピング〜データ更新〜Pages公開）
├── .github/workflows/deploy-pages.yml   site/やdata/history.csv・players.csv・player_images.jsonを
│                                          pushした時だけ動く、スクレイピングを伴わない即時デプロイ用ワークフロー
├── scripts/
│   ├── common.py               共通処理（選手マスタ読み込み、CSV書き出しなど）
│   ├── scrape_reference.py     shadowverse-reference.com から フォロワー数・配信関連 を取得（毎日自動）
│   ├── scrape_ps_results.py    ps.shadowverse-wb.com から PS戦績（個人） を取得（毎日自動）
│   ├── scrape_youtube.py       各選手のYouTubeチャンネル登録者数を取得（毎日自動、API/スクレイピング併用）
│   ├── scrape_player_images.py ps.shadowverse-wb.comから選手写真を取得（毎日自動。既にある選手はスキップ）
│   ├── scrape_svlabo.py        svlabo.jp から ランクマッチ最高順位・レート を取得（★自動実行からは除外。手動で使う用に残してあるだけ）
│   ├── update_history.py       上記のスナップショットを data/history.csv に統合
│   └── requirements.txt
├── data/
│   ├── players.csv             選手マスタ（8チーム37名。youtube_url/twitch_url/ps_slugを保持。
│   │                            詳細は「players.csvについて」参照）
│   ├── history.csv              蓄積される日次データ（ロング形式）
│   ├── player_images.json      選手名→写真パスのマッピング（scrape_player_images.pyが自動生成）
│   ├── svlabo_leaderboards.csv  svlabo.jpの全ユーザー分を一括取得した手動作業の成果物
│   │                             （period, class, rank, team_tag, player_name, rating の列。history.csvとは別管理・自動更新はされない）
│   └── snapshots/               日次の生スクレイピング結果（デバッグ用、実行のたびに増える）
└── site/                        表示用ページ。ページごとにファイルを分けており、今後ページを
    ├── style.css                  増やしたり構成を変えたりしやすい作りにしてある
    ├── common.js                共通ロジック（データ読み込み・CSVパース・指標ラベル・アバター表示など）
    ├── index.html               選手一覧（トップページ）。写真付きカードから各選手ページへ
    ├── player.html              選手詳細（写真・現在値・折れ線グラフ、?name=選手名 で表示選手を切替）
    ├── ranking.html             ランキング（指標×期間で選手を順位付け表示）
    └── images/players/          ダウンロードした選手写真（scrape_player_images.pyが生成、初回pushには含まれない）
```

## セットアップ手順

1. このフォルダの中身を、あなたのGitHubリポジトリのルートにそのままコピーしてpushする
2. リポジトリの Settings → Pages → Source を「GitHub Actions」に設定する
3. Actionsタブで `Daily stats update` を一度 `Run workflow`（手動実行）して、正常に動くか確認する
4. 以降は毎日 22:00 JST に自動実行される（`.github/workflows/daily-update.yml` の cron で変更可能）
5. 公開URLは `https://<ユーザー名>.github.io/<リポジトリ名>/` になる

`daily-update.yml`は`schedule`と`workflow_dispatch`（手動実行）でしか動かないため、`site/`配下（表示用ページ）だけを直してpushしても、それだけではPagesは更新されない。この用途のために`deploy-pages.yml`を用意しており、`site/**`または`data/history.csv`・`data/players.csv`のpushをトリガーに、スクレイピングを挟まずサイトだけを即座に再デプロイする。

認証について: pushやPages公開は GitHub Actions が自動発行する `GITHUB_TOKEN` を使うので、
リポジトリのSecretsなどにあなた自身のトークンを登録する必要はありません
（workflow内の `permissions: contents: write / pages: write / id-token: write` だけで完結します）。
ただし、YouTube登録者数を1万人超でも端数まで正確に取得したい場合だけ、別途YouTube Data APIキーが
必要です（後述の「YouTube Data APIキーの取得方法」参照）。このキーはあなた自身がGoogleで発行し、
GitHubリポジトリのSecretsに直接登録するものなので、Claude側やこのチャット上でキーを
やり取りすることはありません。キーを登録しなくても`scrape_youtube.py`は動作しますが、その場合は
チャンネルページのスクレイピングにフォールバックするため、1万人超のチャンネルは概算値になります
（詳細は「YouTube Data APIキーの取得方法」末尾およびYouTube登録者数の既知の制約を参照）。

## YouTube Data APIキーの取得方法

登録者数を1万人未満まで含めて正確な数字で取得するため、YouTubeチャンネルページの
スクレイピングではなく公式のYouTube Data API v3を使っています。無料枠（1日10,000ユニット）
の範囲内で十分足ります（このリポジトリの規模なら1日1ユニットも使いません）。

1. https://console.cloud.google.com/ にアクセスし、適当な名前で新しいプロジェクトを作成する
2. 「APIとサービス」→「ライブラリ」で「YouTube Data API v3」を検索し、有効にする
3. 「APIとサービス」→「認証情報」→「認証情報を作成」→「APIキー」でキーを発行する
   （必要なら「APIの制限」で YouTube Data API v3 のみに絞っておくと安全）
4. あなたのGitHubリポジトリの Settings → Secrets and variables → Actions →
   「New repository secret」で、Name: `YOUTUBE_API_KEY` / Secret: 発行したキー を登録する
5. これで `daily-update.yml` の `scrape_youtube.py` ステップが自動的にこのSecretを読み込みます

このキーを設定していない場合や、キーが無効・クォータ超過などでAPI呼び出しそのものが失敗した場合は、
`scrape_youtube.py` は自動的に旧来のチャンネルページスクレイピング方式にフォールバックします
（エラーにはならず、登録者数の取得自体がスキップされることはありません）。ただしフォールバック時は
登録者数が概ね1万人を超えるチャンネル（12チャンネル）はYouTube側の表示自体が「1.35万人」のように
丸められるため、端数までの正確な数字は取れません。端数まで必要な場合はAPIキーの設定が必須です。
その日どちらの方式で取得されたかは `data/snapshots/youtube_*.json`（history.csv取り込み前の
生データ）の各行の `via`（"api" または "scrape"）フィールドで確認できます。

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
- **YouTube登録者数（scrape_youtube.py）**: メインはYouTube Data API（`channels.list`）による
  取得で、`YOUTUBE_API_KEY`が設定されていれば端数まで正確な登録者数が取れます。APIキーの
  取得方法は上記「YouTube Data APIキーの取得方法」を参照してください。
  キーが未設定の場合、またはAPI呼び出し自体が失敗した場合（キー無効・クォータ超過など）は、
  自動的にチャンネルページ（/about）のHTMLをスクレイピングする旧方式にフォールバックします。
  37チャンネル全部を実際に確認したところ、この旧方式では登録者数が概ね1万人を超えるチャンネル
  （12チャンネル）はYouTube側の表示自体が「1.35万人」のように丸められてしまい、端数まで
  取得できません（これがそもそもAPI方式に切り替えた理由です）。端数まで必要なチャンネルが
  含まれる場合は、APIキーの設定を推奨します。
  Chappyのみ、shadowverse-reference.com上でもYouTubeチャンネルが確認できず（Twitchのみで
  配信）、両方式とも対象外になります。
  このサイト自体には登録者数の推移データはなく「現在値」しか取れないため、Xフォロワー数と同様、
  このスクリプトを動かし始めた日からhistory.csvに蓄積されていきます。
- **Twitchのフォロワー数は今のところ自動取得していません**: 37名中8名
  （ねぎま、glory、Toby、もっちゃま、ぱらちゃん、折り紙、Chappy、Stylish_deko）は
  Twitchでも配信しており、players.csvにtwitch_url列として保持していますが、フォロワー数の
  自動取得はまだ実装していません。理由は2つあります。
  1. Twitchの公式Helix APIでフォロワー数を取得する`Get Channel Followers`エンドポイントは、
     配信者本人（またはそのモデレーター）のOAuthトークンでのアクセスしか許可されておらず、
     アプリ側の資格情報だけでは他人のチャンネルのフォロワー数を取得できない仕様になっている
     （2023年のAPI変更以降）。
  2. 非公式のGraphQL API（`gql.twitch.tv`）経由で取得する方法も試したが、フォロワー数を含む
     クエリの正しいpersisted queryハッシュ値を特定できなかった（Twitchの公式Webクライアントの
     内部実装に依存しており、頻繁に変わる可能性が高く、svlabo.jpよりもさらに壊れやすい）。
  もしTwitchのフォロワー数も追跡したい場合は、8名それぞれに自分のチャンネルでこのツール用の
  アプリを認可してもらう（現実的に厳しい）か、GraphQLの正しいクエリを別途調査する必要がある。
- **開発環境での制約**: このリポジトリのコードは、Claudeの実行サンドボックス環境ではネットワーク制限により
  Playwrightのブラウザバイナリをダウンロードできず、実際にブラウザを起動しての動作確認はできません。
  そのため、GitHub Actions上で実際に取得された生ログ（タイムスタンプ付きログファイル）を
  ダウンロードして送ってもらい、そのテキストに対してパース処理を書いて検証する、というやり方で
  デバッグしています。今後もエラーが出た場合は、Actionsの実行結果ページ右上の「...」から
  「Download log archive」でログ一式をダウンロードし、このチャットに添付してもらえれば
  同じ方法で調査できます。

## 選手写真について（scrape_player_images.py）

各選手のページ（`https://ps.shadowverse-wb.com/26-27/teams/{ps_slug}`）に掲載されている
プロフィール写真を取得し、`site/images/players/` にキャッシュして選手一覧・選手詳細ページに
表示しています。`ps_slug`は players.csv に列として持たせています（例: Atomなら`atom`）。

- 写真は基本的にシーズン中頻繁には変わらない想定のため、一度取得した選手はスキップし、
  再ダウンロードしません。差し替えたい場合は該当ファイルを`site/images/players/`から
  手動で削除してから`scrape_player_images.py`を再実行してください。
- 写真がまだ無い選手（初回push直後や、取得に失敗した選手）は、チームカラーの円に
  頭文字を表示するフォールバック表示になります（`site/common.js`の`avatarHTML()`）。
- **出典・権利について**: これらの写真は公式サイト（ps.shadowverse-wb.com、Cygames運営）に
  掲載されている選手プロフィール写真で、著作権は運営元に帰属します。本スクリプトは
  非商用の個人的なファントラッカー用途としてキャッシュ・表示するものです。公開する
  リポジトリ/サイトの性質によっては、権利者の意向を確認したり、キャッシュせず外部URLに
  直接リンクする形（写真を自分のリポジトリに置かない）に変更したりすることも検討してください。

## players.csvについて

もともとのplayers.csvは`2026ps-fixed/data/teams.json`（初期にいただいたファイル）から
抽出したものでしたが、そこに入っていたyoutube_urlは古い/一部欠落している状態でした
（Mishadow51, monakawan, 山田レクイエム, Stylish_dekoの4名は本来YouTubeチャンネルを
持っているのに空欄になっていた）。

現在のplayers.csvは、実際に配信活動状況をshadowverse-reference.comで全選手分確認し直し、
そこで使われているYouTubeチャンネルID（`/channel/UCxxxx`形式）に統一しています。
併せてtwitch_url列を新設し、Twitchでも配信している8名（ねぎま、glory、Toby、もっちゃま、
ぱらちゃん、折り紙、Chappy、Stylish_deko）のTwitch URLも入れてあります（Chappyのみ
YouTubeを持たずTwitchのみ）。

さらに`ps_slug`列を追加し、公式サイトの選手個人ページURL（`ps.shadowverse-wb.com/26-27/teams/{ps_slug}`）
のスラッグを37名分保持しています。`scrape_player_images.py`が選手写真を取得する際に使います。

## history.csv のスキーマ

| 列 | 内容 |
|---|---|
| date | 取得日（JST） |
| team_tag | チーム略称（CR/ZETA/DFM/VRL/MRG/RC/RDL/LVH） |
| player_name | 選手名（players.csv基準） |
| metric | 指標名（followers, youtube_subscribers, stream_duration, ps_win など。svlabo.jpを手動で取り込んだ場合は cr_rank_エルフ 等も入る） |
| period | 期間キー（current, jul_early_2026, cumulative_to_date, 節ラベルなど） |
| value | 数値 |

## 次にやると良さそうなこと

- 過去分のバックフィル（shadowverse-reference.comの隔週データは4月前半まで遡れるので、
  初回だけ手動でperiodループを回して過去分を先に埋めておくと、公開初日からグラフに厚みが出る）
- PS戦績のクラス別勝率など、history.csvを使った追加集計ページ
