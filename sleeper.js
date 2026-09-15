// Lettura di una stagione dall'API pubblica di Sleeper.
// Usato sia dal sito (browser) sia da tools/snapshot.js (Node 18+).

(function (root) {
  const API = "https://api.sleeper.app/v1/";

  async function api(path) {
    const r = await fetch(API + path);
    if (!r.ok) throw new Error("Sleeper " + r.status + " su " + path);
    return r.json();
  }

  async function loadSleeperSeason(leagueId) {
    const [league, users, rosters, bracket] = await Promise.all([
      api("league/" + leagueId),
      api("league/" + leagueId + "/users"),
      api("league/" + leagueId + "/rosters"),
      api("league/" + leagueId + "/winners_bracket").catch(() => []),
    ]);

    const regularWeeks = (league.settings.playoff_week_start || 15) - 1;
    const played = Math.max(0, ...rosters.map((r) => r.settings.wins + r.settings.losses + (r.settings.ties || 0)));
    const doneWeeks = ["post_season", "complete"].includes(league.status) ? regularWeeks : Math.min(played, regularWeeks);

    const weeks = await Promise.all(
      Array.from({ length: doneWeeks }, (_, i) => api("league/" + leagueId + "/matchups/" + (i + 1)))
    );

    const season = {
      leagueId,
      year: +league.season,
      status: league.status,
      previous: league.previous_league_id,
      regularWeeks,
      doneWeeks,
      divisions: {},
      teams: {}, // per roster_id
      weeks: [], // [{week, games:[{a,b,pa,pb}], mvp, mvpPoints}]
      playoff: [], // [{w, l, p, r}]
      playoffTeams: [],
    };

    const meta = league.metadata || {};
    for (let d = 1; d <= (league.settings.divisions || 0); d++) {
      season.divisions[d] = { name: meta["division_" + d] || "Division " + d, avatar: meta["division_" + d + "_avatar"] || null };
    }

    for (const r of rosters) {
      const u = users.find((x) => x.user_id === r.owner_id) || {};
      season.teams[r.roster_id] = {
        userId: r.owner_id,
        name: u.display_name || "Squadra " + r.roster_id,
        teamName: (u.metadata && u.metadata.team_name) || "",
        avatar: (u.metadata && u.metadata.avatar) || (u.avatar ? "https://sleepercdn.com/avatars/thumb/" + u.avatar : null),
        division: r.settings.division || null,
        w: 0, l: 0, t: 0, pf: 0, pa: 0, mvp: 0,
      };
    }

    weeks.forEach((list, i) => {
      const byMatch = {};
      for (const m of list) if (m.matchup_id != null) (byMatch[m.matchup_id] ||= []).push(m);
      const games = [];
      for (const pair of Object.values(byMatch)) {
        if (pair.length !== 2) continue;
        const [a, b] = pair;
        const ta = season.teams[a.roster_id], tb = season.teams[b.roster_id];
        ta.pf += a.points; ta.pa += b.points; tb.pf += b.points; tb.pa += a.points;
        if (a.points > b.points) { ta.w++; tb.l++; }
        else if (b.points > a.points) { tb.w++; ta.l++; }
        else { ta.t++; tb.t++; }
        games.push({ a: a.roster_id, b: b.roster_id, pa: a.points, pb: b.points });
      }
      const top = list.reduce((x, y) => (y.points > x.points ? y : x), list[0]);
      if (top && top.points > 0) season.teams[top.roster_id].mvp++;
      season.weeks.push({ week: i + 1, games, mvp: top ? top.roster_id : null, mvpPoints: top ? top.points : 0 });
    });

    for (const g of bracket || []) if (g.w && g.l) season.playoff.push({ w: g.w, l: g.l, p: g.p || null, r: g.r });
    season.playoffTeams = [...new Set((bracket || []).flatMap((g) => [g.t1, g.t2]).filter((x) => typeof x === "number"))];

    reconcileWithStandings(season, rosters);
    return season;
  }

  // I punteggi partita per partita vengono ricalcolati da Sleeper con le correzioni
  // statistiche successive, mentre la classifica (rosters.settings) resta quella
  // ufficiale di fine giornata. Record e punti si prendono dalla classifica; l'esito
  // delle singole partite viene riallineato ai record ufficiali ribaltando, se serve,
  // le partite con lo scarto più piccolo.
  function reconcileWithStandings(season, rosters) {
    const games = season.weeks.flatMap((wk) => wk.games);
    for (const g of games) g.win = g.pa > g.pb ? g.a : g.pb > g.pa ? g.b : null;

    const official = {};
    for (const r of rosters) {
      const s = r.settings;
      official[r.roster_id] = s.wins;
      Object.assign(season.teams[r.roster_id], {
        w: s.wins, l: s.losses, t: s.ties || 0,
        pf: (s.fpts || 0) + (s.fpts_decimal || 0) / 100,
        pa: (s.fpts_against || 0) + (s.fpts_against_decimal || 0) / 100,
      });
    }
    const wins = {};
    for (const g of games) if (g.win != null) wins[g.win] = (wins[g.win] || 0) + 1;
    const extra = (rid) => (wins[rid] || 0) - (official[rid] || 0);

    for (let guard = 0; guard < 50; guard++) {
      const candidates = games.filter((g) => {
        if (g.win == null) return false;
        const lose = g.win === g.a ? g.b : g.a;
        return extra(g.win) > 0 && extra(lose) < 0;
      });
      if (!candidates.length) break;
      const g = candidates.reduce((x, y) => (Math.abs(y.pa - y.pb) < Math.abs(x.pa - x.pb) ? y : x));
      const lose = g.win === g.a ? g.b : g.a;
      wins[g.win]--; wins[lose] = (wins[lose] || 0) + 1;
      g.win = lose;
      g.corrected = true;
    }
  }

  const lib = { api, loadSleeperSeason };
  if (typeof module !== "undefined" && module.exports) module.exports = lib;
  else root.Sleeper = lib;
})(this);
