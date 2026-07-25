"""shadowverse-reference.com (非公式ファンサイト) から選手単位の指標をスクレイピングする。

取得する指標 (typeパラメータ):
  - followers            : Xフォロワー数（periodは"current"のみ、過去分は持っていない）
  - stream_duration       : 配信時間（隔週期間ごと）
  - watch_time            : 視聴時間（隔週期間ごと）
  - video_view_count      : 再生回数（隔週期間ごと）
  - video_upload_count    : 動画本数（隔週期間ごと）

期間(period)の選択肢はサイト側のUIから動的に取得する（隔週で増えていくため、ハードコードしない）。

出力: data/snapshots/reference_{today}.json に生データを保存し、
      戻り値として history.csv 用の行リスト [{date, team_tag, player_name, metric, period, value, unit}, ...] を返す。

注意: このサイトはSPA（JS描画）のため、単純なHTTP GETではデータが取れない。Playwrightでのレンダリングが必須。
"""
import re
import sys

from playwright.sync_api import sync_playwright

from common import today_str, save_snapshot, parse_number

BASE = "https://shadowverse-reference.com/"

# 期間選択のいらない（=現在値のみの）指標
CURRENT_ONLY_METRICS = ["followers"]
# 隔週期間で履歴が選べる指標
PERIOD_METRICS = ["stream_duration", "watch_time", "video_view_count", "video_upload_count"]

# 1行分のデータブロックを抽出する正規表現。
# 実データ例:
#   "1\nMRG\nもっちゃま\n\n82.5\n時間\n"          (配信時間)
#   "1\nRC\nぱらちゃん\n\n34,703\n人\n"            (フォロワー数)
# rank, team_tag, player_name, (空行), value, unit の並びで出現する。
ROW_RE = re.compile(
    r"(?P<rank>\d+T?)\n(?P<tag>[A-Za-z]{2,5})\n(?P<name>[^\n]+)\n\n(?P<value>[\d,]+(?:\.\d+)?)\n(?P<unit>[^\n]{1,4})"
)


def get_period_options(page, metric):
    """type=metric のページを開き、期間セレクトボックスの選択肢(value一覧)を取得する。"""
    page.goto(f"{BASE}?type={metric}&unit=player", wait_until="networkidle")
    page.wait_for_timeout(800)
    selects = page.query_selector_all("select")
    if len(selects) < 2:
        return ["current"]
    options = selects[1].query_selector_all("option")
    values = [o.get_attribute("value") for o in options]
    return [v for v in values if v]


def scrape_metric_period(page, metric, period):
    url = f"{BASE}?type={metric}&period={period}&unit=player"
    page.goto(url, wait_until="networkidle")
    page.wait_for_timeout(800)
    text = page.inner_text("main")
    rows = []
    for m in ROW_RE.finditer(text):
        rows.append(
            {
                "rank": m.group("rank"),
                "team_tag": m.group("tag").upper(),
                "player_name": m.group("name").strip(),
                "value": parse_number(m.group("value")),
                "unit": m.group("unit").strip(),
                "metric": metric,
                "period": period,
            }
        )
    return rows


def main():
    date_str = today_str()
    all_rows = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(locale="ja-JP")

        for metric in CURRENT_ONLY_METRICS:
            rows = scrape_metric_period(page, metric, "current")
            print(f"[reference] {metric}/current: {len(rows)} rows")
            all_rows.extend(rows)

        for metric in PERIOD_METRICS:
            periods = get_period_options(page, metric)
            print(f"[reference] {metric}: periods = {periods}")
            for period in periods:
                rows = scrape_metric_period(page, metric, period)
                print(f"[reference] {metric}/{period}: {len(rows)} rows")
                all_rows.extend(rows)

        browser.close()

    for r in all_rows:
        r["date"] = date_str
        r["source"] = "shadowverse-reference.com"

    save_snapshot("reference", all_rows)
    return all_rows


if __name__ == "__main__":
    rows = main()
    if not rows:
        print("WARNING: no rows scraped. Site structure may have changed.", file=sys.stderr)
        sys.exit(1)
