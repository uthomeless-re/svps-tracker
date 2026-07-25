"""当日分の data/snapshots/*.json を読み込み、ロング形式の data/history.csv に正規化して追記する。

history.csv のスキーマ:
    date, team_tag, player_name, metric, period, value

metric一覧:
    followers            : Xフォロワー数（shadowverse-reference.com, periodは"current"）
    stream_duration       : 配信時間[h]（shadowverse-reference.com, periodは隔週キー）
    watch_time            : 視聴時間[h]（同上）
    video_view_count      : 再生回数（同上）
    video_upload_count    : 動画本数（同上）
    cr_rank_{class}       : クラス別ランクマッチ最高順位（svlabo.jp, periodは隔週シーズン名）
    cr_rating_{class}     : クラス別ランクマッチ最高レート（同上）
    cr_best_rank_overall  : 全クラス通算の最高順位（svlabo.jp, periodは"cumulative_to_date"）
    cr_top100_count       : 順位100位以内に入った回数（同上）
    ps_win                : PS公式戦での勝敗（1=勝ち/0=負け、periodは節・ラウンドのラベル）
    ps_point              : PS公式戦で獲得したポイント（同上）

同じ(date, team_tag, player_name, metric, period)の組み合わせが既に存在する場合は上書きする
（1日に複数回スクリプトを実行しても重複行にならないようにするため）。
"""
import csv
import glob
import json
import os
import sys

from common import DATA_DIR, SNAPSHOT_DIR, HISTORY_CSV, today_str, load_players, build_name_index, normalize_name

FIELDNAMES = ["date", "team_tag", "player_name", "metric", "period", "value"]


def latest_snapshot(source: str, date_str: str):
    path = os.path.join(SNAPSHOT_DIR, f"{source}_{date_str}.json")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def rows_from_reference(snapshot, name_index):
    rows = []
    for r in snapshot or []:
        norm = normalize_name(r["player_name"])
        player = name_index.get(norm)
        team_tag = player["team_tag"] if player else r["team_tag"]
        rows.append(
            {
                "date": r["date"],
                "team_tag": team_tag,
                "player_name": player["player_name"] if player else r["player_name"],
                "metric": r["metric"],
                "period": r["period"],
                "value": r["value"],
            }
        )
    return rows


def rows_from_svlabo(snapshot):
    rows = []
    for r in snapshot or []:
        if not r.get("matched_player"):
            continue  # players.csvにいない選手はスキップ（無関係選手のノイズを避ける）
        team_tag = r["team_tag"]
        name = r["matched_player"]
        date = r["date"]

        rows.append(
            {
                "date": date,
                "team_tag": team_tag,
                "player_name": name,
                "metric": "cr_best_rank_overall",
                "period": "cumulative_to_date",
                "value": r["best_rank_overall"],
            }
        )
        rows.append(
            {
                "date": date,
                "team_tag": team_tag,
                "player_name": name,
                "metric": "cr_top100_count",
                "period": "cumulative_to_date",
                "value": r["top100_count"],
            }
        )
        for b in r.get("breakdown", []):
            rows.append(
                {
                    "date": date,
                    "team_tag": team_tag,
                    "player_name": name,
                    "metric": f"cr_rank_{b['class']}",
                    "period": b["period"],
                    "value": b["rank"],
                }
            )
            rows.append(
                {
                    "date": date,
                    "team_tag": team_tag,
                    "player_name": name,
                    "metric": f"cr_rating_{b['class']}",
                    "period": b["period"],
                    "value": b["rating"],
                }
            )
    return rows


def rows_from_ps_results(snapshot, name_index):
    rows = []
    for r in snapshot or []:
        norm = normalize_name(r["player_name"])
        player = name_index.get(norm)
        team_tag = player["team_tag"] if player else "?"
        name = player["player_name"] if player else r["player_name"]
        rows.append(
            {
                "date": r["date"],
                "team_tag": team_tag,
                "player_name": name,
                "metric": "ps_win",
                "period": r["round"],
                "value": 1 if r["result"] == "WIN" else 0,
            }
        )
        rows.append(
            {
                "date": r["date"],
                "team_tag": team_tag,
                "player_name": name,
                "metric": "ps_point",
                "period": r["round"],
                "value": r["point"],
            }
        )
    return rows


def load_existing_history():
    if not os.path.exists(HISTORY_CSV):
        return []
    with open(HISTORY_CSV, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def merge(existing_rows, new_rows):
    key = lambda r: (r["date"], r["team_tag"], r["player_name"], r["metric"], r["period"])
    merged = {key(r): r for r in existing_rows}
    for r in new_rows:
        merged[key(r)] = {k: str(r[k]) for k in FIELDNAMES}
    # 日付→選手→指標の順で安定ソート
    return sorted(merged.values(), key=lambda r: (r["date"], r["team_tag"], r["player_name"], r["metric"], r["period"]))


def main():
    date_str = today_str()
    players = load_players()
    name_index = build_name_index(players)

    reference_snap = latest_snapshot("reference", date_str)
    svlabo_snap = latest_snapshot("svlabo", date_str)
    ps_snap = latest_snapshot("ps_results", date_str)

    new_rows = []
    new_rows += rows_from_reference(reference_snap, name_index)
    new_rows += rows_from_svlabo(svlabo_snap)
    new_rows += rows_from_ps_results(ps_snap, name_index)

    print(f"[update_history] {len(new_rows)} new rows from today's snapshots")
    if not new_rows:
        print("[update_history] nothing to merge (no snapshots found for today)", file=sys.stderr)

    existing = load_existing_history()
    merged = merge(existing, new_rows)

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(HISTORY_CSV, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(merged)

    print(f"[update_history] history.csv now has {len(merged)} rows")


if __name__ == "__main__":
    main()
