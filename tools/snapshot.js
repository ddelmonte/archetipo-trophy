// Salva in data/sleeper/ le stagioni Sleeper già concluse, così il sito
// non deve riscaricarle ogni volta. Da rilanciare a fine stagione:
//   node tools/snapshot.js
const fs = require("fs");
const path = require("path");
const { api, loadSleeperSeason } = require("../sleeper.js");

const LEAGUE_ID = "1355323885268013056"; // lega 2026, punto di partenza
const OUT = path.join(__dirname, "..", "data", "sleeper");

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  // eventuali leghe più recenti del 2026
  const ids = [];
  let id = LEAGUE_ID;
  const state = await api("state/nfl");
  const first = await api("league/" + LEAGUE_ID);
  const owner = (await api("league/" + LEAGUE_ID + "/users"))[0].user_id;
  for (let y = +first.season + 1, last = LEAGUE_ID; y <= +state.season; y++) {
    const next = (await api("user/" + owner + "/leagues/nfl/" + y)).find((l) => l.previous_league_id === last);
    if (!next) break;
    last = next.league_id;
    id = next.league_id;
  }

  // risale la catena delle stagioni precedenti
  while (id && id !== "0") {
    const l = await api("league/" + id);
    if (!l) break;
    if (l.status === "complete") ids.push(id);
    id = l.previous_league_id;
  }

  const index = [];
  for (const leagueId of ids) {
    const s = await loadSleeperSeason(leagueId);
    fs.writeFileSync(path.join(OUT, s.year + ".json"), JSON.stringify(s));
    index.push({ year: s.year, leagueId });
    console.log("salvata stagione", s.year, "(" + Object.keys(s.teams).length + " squadre)");
  }
  index.sort((a, b) => a.year - b.year);
  fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index, null, 1));
})();
