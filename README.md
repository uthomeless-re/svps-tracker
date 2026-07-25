# Shadowverse Premier Series 26-27 選手データトラッカー

Xフォロワー数・配信時間・視聴時間・動画本数・ランクマッチ最高順位・PS戦績を毎日自動取得し、
GitHub Pagesで折れ線グラフとして公開するためのリポジトリ一式です。

## 構成

```
svps-tracker/
├── .github/workflows/daily-update.yml   毎日実行されるGitHub Actions
├── scripts/
│   ├── common.py            共通処理（選手マスタ読み込み、CSV書き出しなど）
│   ├── scrape_reference.py  shadowverse-reference.com から フォロワー数・配信関連 を取得
│   ├── scrape_svlabo.py     svlabo.jp から ランクマッチ最高順位・レート を取得
│   ├── scrape_ps_results.py ps.shadowverse-wb.com から PS戦績（個人） を取得
│   ├── update_history.py    上記3つのスナップショットを data/history.csv に統合
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

## 既知の制約・注意点

- **3サイトとも非公式・個人/ファン運営のサイト**です（shadowverse-reference.com, svlabo.jp）。
  仕様変更やサイト停止のリスクは常にあります。各スクリプトは失敗しても他のスクリプトの実行を
  妨げないように `continue-on-error: true` にしていますが、パースが崩れた場合は
  `data/snapshots/*_raw*.json` や各スナップショットJSONを見て正規表現を調整してください。
- **svlabo.jp**: 順位フィルタを「100位以上」に固定しています。ランクマッチで100位以内に
  一度も入っていない選手はこのサイトの集計対象外になり、データが取得できません。
- **shadowverse-reference.com**: Xフォロワー数は「現在値」のみが取得できます（このサイト自体に
  過去の履歴はない）。そのため、フォロワー数の推移グラフは このスクリプトを動かし始めた日から
  蓄積されていきます。配信時間・視聴時間・再生回数・動画本数は隔週の期間集計を過去分までさかのぼって
  取得できます。
- **ps.shadowverse-wb.com（PS戦績）**: 「試合結果詳細」モーダルのテキストレイアウトは
  ブラウザでの目視確認までしかできておらず、`scrape_ps_results.py` の正規表現（`BATTLE_RE`）は
  実際のHTML構造で微調整が必要になる可能性が高いです。初回実行時は必ず
  `data/snapshots/ps_results_raw_modals_*.json` を確認してください。
- **開発環境での制約**: このリポジトリのコードは、Claudeの実行サンドボックス環境ではネットワーク制限により
  Playwrightのブラウザバイナリをダウンロードできず、実際にスクリプトを動かしての動作確認は
  できていません（GitHub Actionsのランナーでは通常通りダウンロードできるはずです）。
  初回はActionsで手動実行し、`data/snapshots/` の中身と `data/history.csv` を確認しながら
  数回チューニングすることを想定しています。

## history.csv のスキーマ

| 列 | 内容 |
|---|---|
| date | 取得日（JST） |
| team_tag | チーム略称（CR/ZETA/DFM/VRL/MRG/RC/RDL/LVH） |
| player_name | 選手名（players.csv基準） |
| metric | 指標名（followers, stream_duration, cr_rank_エルフ, ps_win など） |
| period | 期間キー（current, jul_early_2026, cumulative_to_date, 節ラベルなど） |
| value | 数値 |

## 次にやると良さそうなこと

- 過去分のバックフィル（shadowverse-reference.comの隔週データは4月前半まで遡れるので、
  初回だけ手動でperiodループを回して過去分を先に埋めておくと、公開初日からグラフに厚みが出る）
- PS戦績のクラス別勝率など、history.csvを使った追加集計ページ
- svlabo.jpの詳細パースの精度向上（現状は正規表現ベースの簡易パース）
