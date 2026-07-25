"""公式サイト ps.shadowverse-wb.com の「SCHEDULE & RESULTS」から、
選手個人の試合結果（使用クラス・勝敗・獲得ポイント）をスクレイピングする。

対象ページ: https://ps.shadowverse-wb.com/26-27/schedule-results/
消化済みの各試合カードにある「試合結果詳細」ボタンをクリックするとモーダルが開き、
選手ごとの対戦（BATTLE 1, 2, ...）の勝敗・使用クラス・獲得ポイントが表示される。
このデータはJS実行後に描画される（生HTMLには入っていない）ため、Playwrightでのクリック操作が必須。

出力: data/snapshots/ps_results_{today}.json に生データを保存し、
      history.csv用の行リスト [{date, round, team1, team2, player_name, class, result, point}, ...] を返す。

注意: モーダル内テキストの正確なレイアウトは実ブラウザでの目視確認（スクリーンショット）でしか
確認できておらず、inner_text()の改行パターンまでは検証できていない。
初回実行時は必ず data/snapshots/ps_results_*.json を確認し、
parse_battle_text() の正規表現がズレていないか確認すること（README参照）。
"""
import re
import sys

from playwright.sync_api import sync_playwright

from common import today_str, save_snapshot

URL = "https://ps.shadowverse-wb.com/26-27/schedule-results/"

# 1バトル分: 選手名 → クラス → (+N pt) → BATTLE n → WIN/LOSE → VS → WIN/LOSE → 選手名 → クラス
# 対戦カードのテキストは概ね「左選手ブロック」「中央(pt/BATTLE/WIN-VS-LOSE)」「右選手ブロック」の順。
# サイト構造が変わった場合はここを要調整（生スナップショットJSONを見て再調整すること）。
BATTLE_RE = re.compile(
    r"(?P<p1>[^\n]+)\n[^\n]*\n(?P<p1_class>[^\n]+)\n\+?(?P<point>\d+)pt\nBATTLE\s*\d+\n"
    r"(?P<p1_result>WIN|LOSE)\nVS\n(?P<p2_result>WIN|LOSE)\n"
    r"(?P<p2>[^\n]+)\n[^\n]*\n(?P<p2_class>[^\n]+)",
)


def parse_battle_text(modal_text, round_label, team1, team2):
    battles = []
    for m in BATTLE_RE.finditer(modal_text):
        p1_win = m.group("p1_result") == "WIN"
        battles.append(
            {
                "round": round_label,
                "team1": team1,
                "team2": team2,
                "player_name": m.group("p1").strip(),
                "class": m.group("p1_class").strip(),
                "result": "WIN" if p1_win else "LOSE",
                "point": int(m.group("point")) if p1_win else 0,
            }
        )
        battles.append(
            {
                "round": round_label,
                "team1": team1,
                "team2": team2,
                "player_name": m.group("p2").strip(),
                "class": m.group("p2_class").strip(),
                "result": "LOSE" if p1_win else "WIN",
                "point": 0 if p1_win else int(m.group("point")),
            }
        )
    return battles


def scrape():
    all_rows = []
    raw_modals = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(locale="ja-JP")
        page.goto(URL, wait_until="networkidle")
        page.wait_for_timeout(1500)

        buttons = page.query_selector_all("text=試合結果詳細")
        print(f"[ps_results] found {len(buttons)} completed-match detail buttons")

        for i in range(len(buttons)):
            # DOM再取得のたびにindexがずれる可能性があるので都度クエリし直す
            buttons = page.query_selector_all("text=試合結果詳細")
            if i >= len(buttons):
                break
            btn = buttons[i]
            try:
                btn.click()
                page.wait_for_timeout(800)
                modal_text = page.inner_text("body")
                raw_modals.append(modal_text)

                # モーダル冒頭の日付・チーム名を軽く抜き出す（詳細フォーマットは要検証）
                header_match = re.search(r"(\d{4}\.\d{2}\.\d{2}\([A-Z]+\)[^\n]*)", modal_text)
                round_label = header_match.group(1) if header_match else f"match_{i}"

                teams_match = re.findall(r"^[A-Za-z].{2,20}$", modal_text, re.MULTILINE)
                team1 = teams_match[0] if len(teams_match) > 0 else "?"
                team2 = teams_match[1] if len(teams_match) > 1 else "?"

                rows = parse_battle_text(modal_text, round_label, team1, team2)
                print(f"[ps_results] match {i}: parsed {len(rows)} player-battles")
                all_rows.extend(rows)

                # モーダルを閉じる（×ボタン想定、無ければEscape）
                close_btn = page.query_selector("button[aria-label='close'], .modal-close, [class*=close]")
                if close_btn:
                    close_btn.click()
                else:
                    page.keyboard.press("Escape")
                page.wait_for_timeout(400)
            except Exception as e:
                print(f"[ps_results] failed on match {i}: {e}", file=sys.stderr)
                page.keyboard.press("Escape")
                page.wait_for_timeout(400)

        browser.close()

    return all_rows, raw_modals


def main():
    date_str = today_str()
    rows, raw_modals = scrape()
    for r in rows:
        r["date"] = date_str
        r["source"] = "ps.shadowverse-wb.com"

    save_snapshot("ps_results", rows)
    # パース失敗時の調査用に、モーダルの生テキストも別途保存する
    save_snapshot("ps_results_raw_modals", [{"index": i, "text": t} for i, t in enumerate(raw_modals)])
    # ファイルを開かなくても確認できるよう、最初のモーダルの生テキストをログにも直接出す。
    # body全体を取っているため冒頭はナビ等の可能性が高く、"BATTLE"や"WIN"という文字列の
    # 周辺だけを切り出して表示する（モーダル本体がどこにあってもヒットしやすいように）。
    if raw_modals:
        t = raw_modals[0]
        idx = t.find("BATTLE")
        if idx == -1:
            idx = t.find("WIN")
        if idx == -1:
            idx = 0
        start = max(0, idx - 300)
        print(f"[ps_results] --- first modal raw text around 'BATTLE/WIN' (total length={len(t)}) ---")
        print(t[start:start + 1500])
        print("[ps_results] --- end raw text sample ---")
    return rows


if __name__ == "__main__":
    rows = main()
    if not rows:
        print(
            "WARNING: no rows parsed. Either no matches finished yet, or BATTLE_RE needs adjusting "
            "against data/snapshots/ps_results_raw_modals_*.json",
            file=sys.stderr,
        )
