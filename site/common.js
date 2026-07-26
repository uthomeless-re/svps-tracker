// 全ページ共通のデータ読み込み・表示ヘルパー。
// history.csv / players.csv / player_images.json を読み込んで各ページのJSに渡す。

const DATA_URL = "data/history.csv";
const PLAYERS_URL = "data/players.csv";
const IMAGES_MANIFEST_URL = "data/player_images.json";
const MATCHES_URL = "data/match_results.csv";
const RESULT_JSON_URL = "data/result.json";

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

const METRIC_LABELS = {
  followers: "Xフォロワー数",
  youtube_subscribers: "YouTube登録者数",
  stream_duration: "配信時間 (h)",
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

function latestValue(history, playerName, metric) {
  const rows = history.filter(r => r.player_name === playerName && r.metric === metric);
  if (!rows.length) return null;
  rows.sort((a, b) => a.date < b.date ? 1 : -1);
  return rows[0].value;
}

// 選手アバターのHTMLを返す。写真があれば<img>、無い/読み込み失敗時は
// チームカラーの円にイニシャルを表示するフォールバックに切り替える。
function avatarHTML(player, images, size) {
  const color = TEAM_COLORS[player.team_tag] || "#888";
  const initial = (player.player_name || "?").trim().charAt(0);
  const path = images[player.player_name];
  const fallback = `<div class="avatar-fallback" style="width:${size}px;height:${size}px;background:${color};font-size:${Math.round(size*0.42)}px;">${initial}</div>`;
  if (!path) return fallback;
  return `<img class="avatar" src="${path}" width="${size}" height="${size}" alt="${player.player_name}"
    onerror="this.outerHTML='${fallback.replace(/'/g, "\\'")}'">`;
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

  matches.forEach(m => {
    const t = teams[m.team_tag];
    if (!t) return;
    t.points += parseFloat(m.point) || 0;
    if (m.result === "WIN") t.wins++;
    else if (m.result === "LOSE") t.losses++;
  });
  const list = Object.values(teams);
  const hasMatches = matches.length > 0;
  if (hasMatches) {
    list.sort((a, b) => b.points - a.points || b.wins - a.wins);
  }
  return { list, source: hasMatches ? "match_results.csv" : "none" };
}
