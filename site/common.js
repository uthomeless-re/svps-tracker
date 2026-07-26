// 全ページ共通のデータ読み込み・表示ヘルパー。
// history.csv / players.csv / player_images.json を読み込んで各ページのJSに渡す。

const DATA_URL = "data/history.csv";
const PLAYERS_URL = "data/players.csv";
const IMAGES_MANIFEST_URL = "data/player_images.json";

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
