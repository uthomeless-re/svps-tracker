"""svlabo.jp（個人運営のShadowverse分析ブログ）の「CRランキングまとめ」から、
選手ごとのランクマッチ最高順位・最高レート（クラス別・期間別）をスクレイピングする。

対象ページ: https://svlabo.jp/blog-entry-1608.html
「選手ごとに集計したデータ」表示（デフォルトのview=nam）を使う。
順位(以上)フィルタは100に設定している（=ランク100位以内に一度でも入った選手のみ表示される仕様）。
これより順位が低い選手はこのサイトの集計対象外になる点に注意（既知の制約。README参照）。

出力: data/snapshots/svlabo_{today}.json に生データを保存し、
      history.csv 用の行リスト [{date, team_tag, player_name, metric, period, class, rank, rating}, ...] を返す。

注意: SPAのためPlaywrightでのレンダリングが必須。個人サイトのため構造変更リスクがある
（README参照。取得失敗時はdata/snapshotsの生データで原因調査すること）。
"""
import re
import sys

from playwright.sync_api import sync_playwright

from common import today_str, save_snapshot, load_players, build_name_index, normalize_name, TEAM_TAG_ALIASES

URL = (
    "https://svlabo.jp/blog-entry-1608.html"
    "?start=0&end=9&cls=&min=100&name=&ps=0&rk=rank&view=nam&sort=colA&asc=0"
)

# 1選手分のブロック: "TAG｜名前" -> "N回" -> "最高順位" -> 詳細テキスト（次の選手のTAG｜名前の直前まで）
ROW_RE = re.compile(
    r"(?P<tag>[A-Za-z]{2,5})｜(?P<name>[^\n]+?)\s*\n+(?P<count>\d+)回\s*\n+(?P<best>\d+)\s*\n+(?P<detail>.*?)(?=\n[A-Za-z]{2,5}｜|\Z)",
    re.DOTALL,
)

# 詳細テキストは "[期間名] クラスA順位(レート)、クラスB順位(レート)、[次の期間名] ..." のように、
# 同じ期間の複数クラスが "[期間名]" を省略してカンマ区切りで並ぶ。単純な正規表現の繰り返しマッチだと
# 2つ目以降のクラス（[期間名]なし）を取りこぼすため、直前に見た期間名を引き継ぐ簡易ステートマシンで処理する。
PERIOD_PREFIX_RE = re.compile(r"^\[(?P<period>[^\]]+)\]\s*(?P<rest>.*)$")
ENTRY_RE = re.compile(r"^(?P<class>\D+?)(?P<rank>\d+)位\((?P<rating>\d+)\)$")


def parse_detail(detail_text: str):
    """"[期間] クラス順位(レート)、クラス順位(レート)、[次の期間] ..." 形式の詳細テキストを分解する。"""
    results = []
    current_period = None
    for chunk in (c.strip() for c in detail_text.split("、")):
        if not chunk:
            continue
        pm = PERIOD_PREFIX_RE.match(chunk)
        if pm:
            current_period = pm.group("period").strip()
            chunk = pm.group("rest").strip()
        em = ENTRY_RE.match(chunk)
        if em and current_period:
            results.append(
                {
                    "period": current_period,
                    "class": em.group("class").strip(),
                    "rank": int(em.group("rank")),
                    "rating": int(em.group("rating")),
                }
            )
    return results


def scrape():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(locale="ja-JP", viewport={"width": 1400, "height": 2000})
        page.goto(URL, wait_until="networkidle")
        # FC2ブログ側のウィジェットがnetworkidle後もJSで描画を続けるケースに備えて、
        # "｜"（選手行の区切り文字）が出現するまで少し待つ。出なければタイムアウトして先に進む。
        try:
            page.wait_for_selector("text=｜", timeout=15000)
        except Exception as e:
            print(f"[svlabo] wait_for_selector('｜') timed out: {e}", file=sys.stderr)
        page.wait_for_timeout(2000)
        text = page.inner_text("body")
        browser.close()

    print(f"[svlabo] raw text length={len(text)}")
    print("[svlabo] --- raw text (first 800 chars) ---")
    print(text[:800])
    print("[svlabo] --- end raw text sample ---")

    players = load_players()
    name_index = build_name_index(players)

    rows = []
    for m in ROW_RE.finditer(text):
        raw_name = m.group("name").strip()
        norm = normalize_name(raw_name)
        player = name_index.get(norm)
        detail = m.group("detail")

        base = {
            "team_tag_site": m.group("tag").upper(),
            "player_name_site": raw_name,
            "matched_player": player["player_name"] if player else None,
            "team_tag": player["team_tag"] if player else m.group("tag").upper(),
            "top100_count": int(m.group("count")),
            "best_rank_overall": int(m.group("best")),
        }

        base["breakdown"] = parse_detail(detail)
        rows.append(base)

    return rows, text


def main():
    date_str = today_str()
    rows, raw_text = scrape()
    for r in rows:
        r["date"] = date_str
        r["source"] = "svlabo.jp"

    unmatched = [r["player_name_site"] for r in rows if r["matched_player"] is None]
    if unmatched:
        print(f"[svlabo] WARNING: {len(unmatched)} names did not match players.csv: {unmatched}", file=sys.stderr)

    save_snapshot("svlabo", rows)
    # パースが0件でも原因調査できるよう、生テキストを常に保存する（うまくいったら消してOK）
    save_snapshot("svlabo_debug", [{"text_len": len(raw_text), "text": raw_text}])
    return rows


if __name__ == "__main__":
    rows = main()
    if not rows:
        print("WARNING: no rows scraped. Site structure may have changed.", file=sys.stderr)
        sys.exit(1)
