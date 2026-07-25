"""players.csv の youtube_url から、選手ごとのチャンネル登録者数を取得する。

対象: 各選手のYouTubeチャンネル「概要」ページ (URL + "/about")。
チャンネルページのHTMLに埋め込まれたJSON文字列
    "subscriberCountText":"チャンネル登録者数 8010人"
から登録者数を正規表現で抜き出す（実際に2チャンネルで確認済み。
channel/UC... 形式・@handle 形式のどちらのURLでも同じ形で埋め込まれていた）。
JSの実行完了を待たなくてもdomcontentloaded時点のHTMLに含まれている値なので、
待ち時間は他のスクリプトより短めで済む。

このサイト自体には登録者数の推移データはないため（現在値のみ取得できる）、
shadowverse-reference.comのXフォロワー数と同じ扱いで、
このスクリプトを動かし始めた日からhistory.csvに蓄積していく（period="current"）。

出力: data/snapshots/youtube_{today}.json に生データを保存し、
      history.csv用の行リスト [{date, team_tag, player_name, metric, period, value}, ...] を返す。

注意:
- players.csvのyoutube_urlが空の選手（Mishadow51, monakawan, 山田レクイエム, Chappy, Stylish_deko）は
  そもそも対象外としてスキップする。
- GitHub ActionsのランナーはUS等のIPのため、Googleの「Cookieに関する選択」同意画面が
  挟まる可能性がある（日本からのアクセスでは今回確認できなかったため、実際にActions上で
  発生するかは未確認）。念のためCONSENT cookieを事前設定して回避を試みているが、
  もしこれでも0件になった場合はdata/snapshots/youtube_debug_*.jsonの生テキスト
  （またはActionsログの標準出力に出す先頭部分）を見て、同意画面のHTML構造に合わせて
  自動クリック処理を追加する必要がある。
"""
import re
import sys

from playwright.sync_api import sync_playwright

from common import today_str, save_snapshot, load_players

SUB_RE = re.compile(r'"subscriberCountText":"チャンネル登録者数\s*([\d,]+(?:\.\d+)?)\s*(万)?人"')


def parse_subscriber_count(text: str):
    m = SUB_RE.search(text)
    if not m:
        return None
    num_str, man = m.groups()
    num = float(num_str.replace(",", ""))
    if man:
        num *= 10000
    return int(num)


def scrape():
    players = load_players()
    targets = [p for p in players if p.get("youtube_url")]
    skipped = [p["player_name"] for p in players if not p.get("youtube_url")]

    rows = []
    debug_entries = []

    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(
            locale="ja-JP",
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
            ),
        )
        # Googleの同意確認画面をなるべく回避する（US等のデータセンターIPで出ることがあるため）
        context.add_cookies([{
            "name": "CONSENT",
            "value": "YES+1",
            "domain": ".youtube.com",
            "path": "/",
        }])
        page = context.new_page()

        for player in targets:
            url = player["youtube_url"].rstrip("/") + "/about"
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=45000)
                page.wait_for_timeout(1000)
                text = page.content()
            except Exception as e:
                print(f"[youtube] failed to load {player['player_name']} ({url}): {e}", file=sys.stderr)
                debug_entries.append({"player_name": player["player_name"], "url": url, "error": str(e)})
                continue

            count = parse_subscriber_count(text)
            debug_entries.append({
                "player_name": player["player_name"],
                "url": url,
                "text_len": len(text),
                "parsed": count,
            })

            if count is None:
                print(f"[youtube] WARNING: could not find subscriber count for {player['player_name']} ({url})", file=sys.stderr)
                continue

            rows.append({
                "team_tag": player["team_tag"],
                "player_name": player["player_name"],
                "value": count,
            })

        browser.close()

    if skipped:
        print(f"[youtube] skipped (no youtube_url in players.csv): {skipped}")
    print(f"[youtube] {len(rows)}/{len(targets)} channels scraped successfully")

    return rows, debug_entries


def main():
    date_str = today_str()
    rows, debug_entries = scrape()
    for r in rows:
        r["date"] = date_str
        r["source"] = "youtube"

    save_snapshot("youtube", rows)
    # パースが0件でも原因調査できるよう、各チャンネルの取得結果を常に保存する
    save_snapshot("youtube_debug", debug_entries)
    return rows


if __name__ == "__main__":
    rows = main()
    if not rows:
        print("WARNING: no rows scraped. YouTube's page structure may have changed, or a consent/bot-check page was shown.", file=sys.stderr)
        sys.exit(1)
