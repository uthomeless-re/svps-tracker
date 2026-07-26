// 全ページ共通のデータ読み込み・表示ヘルパー。
// history.csv / players.csv / player_images.json を読み込んで各ページのJSに渡す。

const DATA_URL = "data/history.csv";
const PLAYERS_URL = "data/players.csv";
const IMAGES_MANIFEST_URL = "data/player_images.json";
const MATCHES_URL = "data/match_results.csv";
const RESULT_JSON_URL = "data/result.json";
const SVLABO_URL = "data/svlabo_leaderboards.csv";
// CR(ランクマッチ)順位の「TOP N入り回数」ランキングで選べるしきい値の候補
const CR_TOPN_THRESHOLDS = [10, 30, 50, 100];

// data/result.json の id (1〜8) と team_tag の対応。teams.json由来の並び順に合わせている。
const RESULT_ID_TO_TAG = {
  1: "CR", 2: "ZETA", 3: "DFM", 4: "VRL", 5: "MRG", 6: "RC", 7: "RDL", 8: "LVH",
};

// クラス名 → アイコンファイル名（アップロードされた公式クラスアイコンを使用）
const CLASS_ICONS = {
  "エルフ": "class_elf.svg",
  "ロイヤル": "class_royal.svg",
  "ウィッチ": "class_witch.svg",
  "ドラゴン": "class_dragon.svg",
  "ナイトメア": "class_nightmare.svg",
  "ビショップ": "class_bishop.svg",
  "ネメシス": "class_nemesis.svg",
  "ニュートラル": "class_neutral.svg",
};

function classIconHTML(className, size) {
  size = size || 20;
  const file = CLASS_ICONS[className];
  if (!file) return `<span style="font-size:12px;color:var(--text-muted);">${className || "-"}</span>`;
  return `<img src="images/classes/${file}" width="${size}" height="${size}" alt="${className}" title="${className}" style="vertical-align:middle;">`;
}

const TEAM_COLORS = {
  CR: "#e11d48", ZETA: "#7c3aed", DFM: "#f97316", VRL: "#eab308",
  MRG: "#10b981", RC: "#be123c", RDL: "#6366f1", LVH: "#0891b2",
};

// compare.htmlで複数選手を重ねて表示する時の系列カラーパレット（順番に割り当てる）
const SERIES_COLORS = ["#2f6fed", "#e11d48", "#10b981", "#f59e0b", "#7c3aed", "#0891b2", "#be123c", "#eab308", "#6366f1", "#059669"];

const METRIC_LABELS = {
  followers: "Xフォロワー数",
  youtube_subscribers: "YouTube登録者数",
  stream_duration: "配信時間 (h)",
  stream_duration_cumulative: "累積配信時間 (h)",
  watch_time: "視聴時間 (h)",
  video_view_count: "動画再生回数",
  video_upload_count: "動画本数",
  ps_win: "PS公式戦 勝敗",
  ps_point: "PS公式戦 獲得ポイント",
  cr_best_rank_overall: "ランクマッチ最高順位（全クラス）",
  cr_top100_count: "ランクマッチ TOP100入り回数",
};

function metricLabel(m) {
  if (METRIC_LABELS[m]) return METRIC_LABELS[m];
  let mm = m.match(/^cr_rank_(.+)$/);
  if (mm) return `ランクマッチ順位（${mm[1]}）`;
  mm = m.match(/^cr_rating_(.+)$/);
  if (mm) return `ランクマッチレート（${mm[1]}）`;
  return m;
}

function isLowerBetter(m) { return /rank/.test(m); }

function fmtNum(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return v;
  return n.toLocaleString("ja-JP");
}

function parseCSV(text) {
  // svlabo_leaderboards.csv などUTF-8 BOM付きで保存されているファイルがあるため、
  // 先頭のBOMを除去してからパースする（除去しないと1列目のヘッダ名が「﻿period」の
  // ようになり、その列だけ参照できなくなる）。
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const lines = text.replace(/\r/g, "").split("\n").filter(l => l.length > 0);
  const headers = lines[0].split(",");
  return lines.slice(1).map(line => {
    const cols = line.split(",");
    const row = {};
    headers.forEach((h, i) => row[h] = cols[i]);
    return row;
  });
}

// history.csv / players.csv / player_images.json をまとめて読み込む。
// 画像マニフェストが無い（scrape_player_images.pyをまだ一度も実行していない）場合も
// 致命的エラーにはせず、空のマッピングとして扱う。
async function loadData() {
  const [histText, playersText] = await Promise.all([
    fetch(DATA_URL).then(r => r.ok ? r.text() : Promise.reject(new Error(`history.csv fetch failed: ${r.status}`))),
    fetch(PLAYERS_URL).then(r => r.ok ? r.text() : Promise.reject(new Error(`players.csv fetch failed: ${r.status}`))),
  ]);
  let images = {};
  try {
    const imgResp = await fetch(IMAGES_MANIFEST_URL);
    if (imgResp.ok) images = await imgResp.json();
  } catch (e) { /* 画像マニフェストが無くても致命的ではない */ }

  return {
    history: parseCSV(histText),
    players: parseCSV(playersText),
    images,
  };
}

// 隔週などの期間ごとの値（例: stream_duration）は、そのまま折れ線にしても
// 「期間ごとにバラバラな値を単に線でつないだだけ」になり推移として意味を持たない。
// 期間を時系列順に並べて積み上げた累積値にすることで、初めて「増え続ける推移」として意味を持つ。
// 同じ期間が複数日にわたって観測される場合は、その期間の最新（最終）観測値を採用する。
function buildCumulativeSeries(history, playerName, metric) {
  const rows = history.filter(r => r.player_name === playerName && r.metric === metric);
  const byPeriod = {};
  rows.forEach(r => {
    if (!byPeriod[r.period] || byPeriod[r.period].date < r.date) byPeriod[r.period] = r;
  });
  const periodRows = Object.values(byPeriod).sort((a, b) => a.date < b.date ? -1 : (a.date > b.date ? 1 : 0));

  let cumulative = 0;
  const labels = [];
  const data = [];
  periodRows.forEach(r => {
    cumulative += parseFloat(r.value) || 0;
    labels.push(r.period);
    data.push(cumulative);
  });
  return { labels, data };
}

function latestValue(history, playerName, metric) {
  const rows = history.filter(r => r.player_name === playerName && r.metric === metric);
  if (!rows.length) return null;
  rows.sort((a, b) => a.date < b.date ? 1 : -1);
  return rows[0].value;
}

// HTML属性値として安全に埋め込むためのエスケープ（ダブルクォート・タグ壊れ対策）。
function escapeAttr(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// 選手アバターのHTMLを返す。写真があれば<img>、無い/読み込み失敗時は
// チームカラーの四角にイニシャルを表示するフォールバックに切り替える。
// 以前はonerror属性の中にHTML文字列（ダブルクォート込み）をそのまま埋め込んでいたため、
// 属性がそこで途切れてページ上に壊れたマークアップの断片（["> のような文字列）が
// そのまま表示されてしまう不具合があった。data属性+共通関数呼び出しの形にして回避する。
function avatarFallbackHTML(player, size) {
  const color = TEAM_COLORS[player.team_tag] || "#888";
  const initial = (player.player_name || "?").trim().charAt(0);
  return `<div class="avatar-fallback" style="width:${size}px;height:${size}px;background:${color};font-size:${Math.round(size * 0.42)}px;">${escapeAttr(initial)}</div>`;
}

function avatarHTML(player, images, size) {
  const path = images[player.player_name];
  if (!path) return avatarFallbackHTML(player, size);
  return `<img class="avatar" src="${escapeAttr(path)}" width="${size}" height="${size}" alt="${escapeAttr(player.player_name)}"
    data-fallback-name="${escapeAttr(player.player_name)}" data-fallback-team="${escapeAttr(player.team_tag)}" data-fallback-size="${size}"
    onerror="handleAvatarError(this)">`;
}

// avatarHTML()のimgタグが読み込み失敗した時に呼ばれる（onerrorから参照するのでグローバルに置く）。
function handleAvatarError(imgEl) {
  const size = imgEl.getAttribute("data-fallback-size");
  const player = { player_name: imgEl.getAttribute("data-fallback-name"), team_tag: imgEl.getAttribute("data-fallback-team") };
  imgEl.outerHTML = avatarFallbackHTML(player, size);
}

function teamBadgeHTML(teamTag) {
  const color = TEAM_COLORS[teamTag] || "#888";
  return `<span class="team-badge" style="background:${color}">${teamTag}</span>`;
}

// data/match_results.csv を読み込む（存在しない/まだ試合が無い場合は空配列を返す）。
async function loadMatches() {
  try {
    const resp = await fetch(MATCHES_URL);
    if (!resp.ok) return [];
    return parseCSV(await resp.text());
  } catch (e) {
    return [];
  }
}

// 選手の通算成績（勝数・敗数・勝率・獲得ポイント）を試合結果の配列から集計する。
function summarizeMatches(matches, playerName) {
  const rows = matches.filter(m => m.player_name === playerName);
  const wins = rows.filter(r => r.result === "WIN").length;
  const losses = rows.filter(r => r.result === "LOSE").length;
  const points = rows.reduce((sum, r) => sum + (parseFloat(r.point) || 0), 0);
  return { played: rows.length, wins, losses, points, winRate: rows.length ? wins / rows.length : null };
}

// data/svlabo_leaderboards.csv（svlabo.jpから一括取得したランクマッチ全ユーザー分の
// period × class 別リーダーボード）を読み込む。取得できない場合は空配列を返す。
async function loadSvlaboLeaderboard() {
  try {
    const resp = await fetch(SVLABO_URL);
    if (!resp.ok) return [];
    return parseCSV(await resp.text());
  } catch (e) {
    return [];
  }
}

// 選手ごとに「ランクマッチ順位がthreshold位以内だった回数」を数える。
// 1人の選手が複数の期間・複数のクラスでtop100入りしていれば、その分だけ加算される
// （＝「通算で何回入賞級の順位を取ったか」を表す回数ランキング）。
function crTopNCounts(leaderboard, threshold) {
  const counts = {};
  leaderboard.forEach(r => {
    const rank = parseInt(r.rank, 10);
    if (!Number.isNaN(rank) && rank <= threshold) {
      counts[r.player_name] = (counts[r.player_name] || 0) + 1;
    }
  });
  return counts;
}

function crTopNLabel(threshold) {
  return `CR順位 TOP${threshold}入り回数`;
}

// data/result.json を読み込む（手動更新される公式チーム順位。無ければnullを返す）。
async function loadResultJson() {
  try {
    const resp = await fetch(RESULT_JSON_URL);
    if (!resp.ok) return null;
    return await resp.json();
  } catch (e) {
    return null;
  }
}

// 8チームを「現在の順位」で並べる。
// 優先順位:
//   1. data/result.json に実データがあればそれを使う（手動更新される公式の勝敗・得失差・獲得ポイント）
//   2. まだ入力されていない場合は match_results.csv から自動集計した値にフォールバックする
//      （各選手の獲得ポイント[point]をチーム単位で合算。公式の対戦カードの点数と一致する値なので
//      近似として妥当）
// まだ試合が無い場合はplayers.csv記載順のまま返す。
function computeTeamStandings(players, matches, resultJson) {
  const teams = {};
  players.forEach(p => {
    if (!teams[p.team_tag]) teams[p.team_tag] = { team_tag: p.team_tag, team_name: p.team_name, players: [], points: 0, wins: 0, losses: 0, diff: 0 };
    teams[p.team_tag].players.push(p);
  });

  const resultTeams = resultJson && Array.isArray(resultJson.teams) ? resultJson.teams : [];
  const resultHasData = resultTeams.some(t => (t.win || 0) + (t.lose || 0) > 0);

  if (resultHasData) {
    resultTeams.forEach(t => {
      const tag = RESULT_ID_TO_TAG[t.id];
      if (!tag || !teams[tag]) return;
      teams[tag].points = t.battlepoint || 0;
      teams[tag].wins = t.win || 0;
      teams[tag].losses = t.lose || 0;
      teams[tag].diff = t.diff || 0;
    });
    const list = Object.values(teams);
    list.sort((a, b) => b.points - a.points || b.diff - a.diff || b.wins - a.wins);
    return { list, source: "result.json" };
  }

  // match_results.csvは「選手1人・個人戦1バトル」単位の行なので、そのままteam_tagごとに
  // win/loseを数えると「チームの試合単位の勝敗（2-0, 1-1など）」ではなく「個人戦バトルの
  // 勝敗数の合計」になってしまう（1つのチーム戦は複数バトルのベストオブなので数が水増しされる）。
  // round + 対戦カード（自チームと相手チームの組）でグルーピングして、チーム試合1つごとに
  // どちらが勝ったか（個人戦バトルを多く取った方）を判定し、そのチーム試合単位でwin/loseを数える。
  // battlepoint（points）はこれまで通り個人戦バトルの獲得数の合計（＝公式スコア表記と一致）。
  const cardMap = {}; // key: round + "|" + [tagA,tagB].sort().join("-")  -> { round, tagPoints: {tag: sum} }
  matches.forEach(m => {
    const t = teams[m.team_tag];
    if (!t) return;
    t.points += parseFloat(m.point) || 0;

    const oppTag = m.opponent_team_tag;
    if (!oppTag || oppTag === "?" || !teams[oppTag]) return; // 対戦相手が特定できない行は試合単位の勝敗集計からは除外
    const pairKey = m.round + "|" + [m.team_tag, oppTag].sort().join("-");
    if (!cardMap[pairKey]) cardMap[pairKey] = {};
    cardMap[pairKey][m.team_tag] = (cardMap[pairKey][m.team_tag] || 0) + (parseFloat(m.point) || 0);
  });

  Object.values(cardMap).forEach(tagPoints => {
    const tags = Object.keys(tagPoints);
    if (tags.length !== 2) return; // 想定外（相手不明の行が混ざっている等）はスキップ
    const [tagA, tagB] = tags;
    if (tagPoints[tagA] === tagPoints[tagB]) return; // 引き分けは想定していないのでスキップ
    const winner = tagPoints[tagA] > tagPoints[tagB] ? tagA : tagB;
    const loser = winner === tagA ? tagB : tagA;
    if (teams[winner]) teams[winner].wins++;
    if (teams[loser]) teams[loser].losses++;
  });

  const list = Object.values(teams);
  const hasMatches = matches.length > 0;
  if (hasMatches) {
    list.sort((a, b) => b.points - a.points || b.wins - a.wins);
  }
  return { list, source: hasMatches ? "match_results.csv" : "none" };
}
