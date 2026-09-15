// Archetipo Trophy — storico della lega
// 2020–2021: data/pre-sleeper.json (dal Foglio Google, solo bacheca).
// Dal 2022: Sleeper. Le stagioni concluse sono salvate in data/sleeper/
// (tools/snapshot.js), quella in corso viene letta dal vivo.

const LEAGUE_ID = "1355323885268013056"; // lega 2026
const CACHE_MINUTES = 10;

const app = document.getElementById("app");
let DB = null; // modello unico costruito da tutte le stagioni

/* ---------- utilità ---------- */

// formato italiano con il punto delle migliaia anche sotto 10.000 (es. 9.665,48)
const fmt = (n, dec = 2) => {
  const [int, frac] = Math.abs(Number(n)).toFixed(dec).split(".");
  return (Number(n) < 0 ? "-" : "") + int.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (frac ? "," + frac : "");
};
const pct = (w, l) => (w + l ? fmt((100 * w) / (w + l), 1) + "%" : "–");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const keyOf = (name) => String(name).trim().toLowerCase();
const signed = (n) => (n > 0 ? "+" + n : String(n));
const getJSON = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(url + " " + r.status); return r.json(); });

function cacheGet(k) {
  try {
    const raw = localStorage.getItem("at:" + k);
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    if (Date.now() - t < CACHE_MINUTES * 60000) return v;
  } catch (e) {}
  return null;
}
function cacheSet(k, v) {
  try { localStorage.setItem("at:" + k, JSON.stringify({ t: Date.now(), v })); } catch (e) {}
}

/* ---------- caricamento stagioni ---------- */

async function loadLiveSeason(leagueId) {
  const cached = cacheGet("season2:" + leagueId);
  if (cached) return cached;
  const s = await Sleeper.loadSleeperSeason(leagueId);
  cacheSet("season2:" + leagueId, s);
  return s;
}

async function loadSeasons() {
  const index = await getJSON("data/sleeper/index.json");
  const saved = await Promise.all(index.map((x) => getJSON("data/sleeper/" + x.year + ".json")));
  const savedIds = new Set(index.map((x) => x.leagueId));

  // lega 2026 e le eventuali successive (collegate da previous_league_id)
  const liveIds = [LEAGUE_ID];
  try {
    const [state, league, users] = await Promise.all([
      Sleeper.api("state/nfl"), Sleeper.api("league/" + LEAGUE_ID), Sleeper.api("league/" + LEAGUE_ID + "/users"),
    ]);
    let last = LEAGUE_ID;
    for (let y = +league.season + 1; y <= +state.season; y++) {
      const next = (await Sleeper.api("user/" + users[0].user_id + "/leagues/nfl/" + y)).find((l) => l.previous_league_id === last);
      if (!next) break;
      liveIds.push(next.league_id);
      last = next.league_id;
    }
  } catch (e) { /* se fallisce, restiamo sulla lega nota */ }

  const live = await Promise.all(liveIds.filter((id) => !savedIds.has(id)).map(loadLiveSeason));
  return [...saved, ...live].sort((a, b) => a.year - b.year);
}

/* ---------- modello unico ---------- */

// Conference champion: il primo di ogni division; se la lega non ha division (2022), il miglior record.
function divisionLeaders(S) {
  const all = Object.entries(S.teams);
  const rank = (list) => [...list].sort((a, b) => b[1].w - a[1].w || b[1].pf - a[1].pf);
  const divs = Object.entries(S.divisions);
  if (!divs.length) return [{ label: null, rid: rank(all)[0][0] }];
  return divs.map(([d, div]) => {
    const lead = rank(all.filter(([, t]) => String(t.division) === d))[0];
    return lead ? { label: div.name, rid: lead[0] } : null;
  }).filter(Boolean);
}

function buildModel(pre, seasons) {
  const teams = {};
  const byUser = {};
  const current = seasons[seasons.length - 1];

  // chiave stabile per allenatore: il nome più recente, legato all'id utente Sleeper
  for (const S of [...seasons].reverse()) for (const t of Object.values(S.teams)) byUser[t.userId] ||= keyOf(t.name);

  const ensure = (key, t) => (teams[key] ||= {
    key, name: t.name, teamName: t.teamName, avatar: t.avatar, userId: t.userId, active: false, division: null,
    seasons: {}, h2h: {}, trophies: [], playoffYears: [], confs: {},
  });
  const award = (key, type, year, extra) => { if (teams[key]) teams[key].trophies.push({ type, year, ...extra }); };
  const bacheca = [];

  for (const S of seasons) {
    const k = {}; // roster_id -> chiave allenatore
    for (const [rid, t] of Object.entries(S.teams)) {
      const key = (k[rid] = byUser[t.userId]);
      const T = ensure(key, t);
      if (S === current) Object.assign(T, { active: true, name: t.name, teamName: t.teamName, avatar: t.avatar, division: t.division });
      if (t.division && S.divisions[t.division]) T.confs[S.year] = S.divisions[t.division].name;
      T.seasons[S.year] = { year: S.year, pf: t.pf, pa: t.pa, mvp: t.mvp, w: t.w, l: t.l, pw: 0, pl: 0, live: S.status !== "complete" };
    }
    S.keyOf = k;

    const h = (a, b) => (teams[a].h2h[b] ||= { w: 0, l: 0, pw: 0, pl: 0 });
    for (const wk of S.weeks) for (const g of wk.games) {
      if (g.win == null) continue;
      const [win, los] = g.win === g.a ? [k[g.a], k[g.b]] : [k[g.b], k[g.a]];
      h(win, los).w++; h(los, win).l++;
    }
    for (const g of S.playoff) {
      h(k[g.w], k[g.l]).pw++; h(k[g.l], k[g.w]).pl++;
      teams[k[g.w]].seasons[S.year].pw++; teams[k[g.l]].seasons[S.year].pl++;
    }
    for (const rid of S.playoffTeams) teams[k[rid]].playoffYears.push(S.year);

    // trofei assegnati solo a stagione chiusa
    const final = S.playoff.find((g) => g.p === 1);
    if (S.status === "complete" && final) {
      const third = S.playoff.find((g) => g.p === 3);
      const best = Object.entries(S.teams).reduce((a, b) => (b[1].pf > a[1].pf ? b : a));
      bacheca.push({
        year: S.year, champion: k[final.w], runnerUp: k[final.l], third: third ? k[third.w] : null,
        bestOffense: { team: k[best[0]], pf: best[1].pf },
        conference: divisionLeaders(S).map((d) => ({ label: d.label, team: k[d.rid], record: S.teams[d.rid].w + "-" + S.teams[d.rid].l })),
      });
    }
  }

  // stagioni prima di Sleeper: solo bacheca
  bacheca.push(...pre.bacheca);
  for (const b of bacheca) {
    award(b.champion, "sb", b.year);
    award(b.runnerUp, "final", b.year);
    award(b.third, "third", b.year);
    if (b.bestOffense) award(b.bestOffense.team, "archetipo", b.year);
    for (const c of b.conference) award(c.team, "conf", b.year, { label: c.label });
  }

  // totali per allenatore
  for (const T of Object.values(teams)) {
    const hs = Object.values(T.h2h);
    T.w = hs.reduce((a, x) => a + x.w, 0);
    T.l = hs.reduce((a, x) => a + x.l, 0);
    T.pw = hs.reduce((a, x) => a + x.pw, 0);
    T.pl = hs.reduce((a, x) => a + x.pl, 0);
    const ss = Object.values(T.seasons);
    T.pf = ss.reduce((a, s) => a + s.pf, 0);
    T.pa = ss.reduce((a, s) => a + s.pa, 0);
    T.mvp = ss.reduce((a, s) => a + s.mvp, 0);
    T.nSeasons = ss.length;
    T.playoffYears.sort();
  }

  bacheca.sort((a, b) => b.year - a.year);
  return { teams, bacheca, current, firstSleeperYear: seasons[0].year };
}

/* ---------- componenti ---------- */

function avatarHtml(T, size) {
  const style = size ? ` style="width:${size}px;height:${size}px"` : "";
  if (T && T.avatar) return `<img class="avatar" src="${esc(T.avatar)}" alt=""${style} loading="lazy" onerror="this.outerHTML='<span class=&quot;avatar&quot;${style.replace(/"/g, "&quot;")}>${esc(T.name[0].toUpperCase())}</span>'">`;
  const letter = T ? T.name[0].toUpperCase() : "?";
  return `<span class="avatar"${style}>${esc(letter)}</span>`;
}

function teamLink(key, { sub = true } = {}) {
  const T = DB.teams[key];
  if (!T) return `<span class="tl-name">${esc(key)}</span>`;
  const subline = sub && T.teamName ? `<span class="tl-sub">${esc(T.teamName)}</span>` : "";
  return `<a class="team-link" href="#/squadra/${encodeURIComponent(T.key)}">${avatarHtml(T)}<span class="tl-text"><span class="tl-name">${esc(T.name)}</span>${subline}</span></a>`;
}

function nameLink(key) {
  const T = DB.teams[key];
  return T ? `<a href="#/squadra/${encodeURIComponent(T.key)}">${esc(T.name)}</a>` : esc(key);
}

/* ---------- home ---------- */

function renderHome() {
  const { teams, bacheca, current: S } = DB;
  const lastChamp = bacheca.find((b) => b.champion);
  const years = new Set([...bacheca.map((b) => b.year), S.year]);

  app.innerHTML = `
    <div class="hero">
      <div class="kicker">Lega fantasy NFL su Sleeper</div>
      <h1>Archetipo <span>Trophy</span> 🏈</h1>
      <div class="facts">
        <div class="fact"><b>${years.size}</b><small>stagioni dal ${Math.min(...years)}</small></div>
        <div class="fact"><b>${Object.values(teams).filter((t) => t.active).length}</b><small>squadre nel ${S.year}</small></div>
        <div class="fact"><b>${lastChamp ? esc(DB.teams[lastChamp.champion]?.name || lastChamp.champion) : "–"}</b><small>campione in carica (${lastChamp ? lastChamp.year : ""})</small></div>
      </div>
    </div>
    ${renderCurrentSeason(S)}
    ${renderBacheca(bacheca)}
    ${renderMedals()}
    ${renderStats()}
  `;
  bindSort();
}

function renderCurrentSeason(S) {
  const done = S.status === "complete";
  const standings = Object.entries(S.divisions).map(([d, div]) => {
    const rows = Object.entries(S.teams)
      .filter(([, t]) => String(t.division) === d)
      .sort((a, b) => b[1].w - a[1].w || b[1].pf - a[1].pf)
      .map(([rid, t], i) => `<tr>
        <td class="pos">${i + 1}</td>
        <td>${teamLink(S.keyOf[rid])}</td>
        <td class="rec num">${t.w}-${t.l}${t.t ? "-" + t.t : ""}</td>
        <td class="pf num">${fmt(t.pf, 1)}</td></tr>`).join("");
    return `<div class="card division">
      <h3>${div.avatar ? `<img src="${esc(div.avatar)}" alt="">` : ""}${esc(div.name)}</h3>
      <table class="standings">${rows}</table></div>`;
  }).join("");

  const last = S.weeks[S.weeks.length - 1];
  let weekHtml = `<div class="card"><p class="muted">La stagione non è ancora cominciata: la prima giornata apparirà qui appena conclusa.</p></div>`;
  if (last) {
    const games = last.games.map((g) => {
      const aw = g.win === g.a;
      return `<div class="matchup">
        <div class="side">${teamLink(S.keyOf[g.a], { sub: false })}</div>
        <div class="score num"><span class="${aw ? "w" : "l"}">${fmt(g.pa)}</span> – <span class="${aw ? "l" : "w"}">${fmt(g.pb)}</span></div>
        <div class="side">${teamLink(S.keyOf[g.b], { sub: false })}</div></div>`;
    }).join("");
    const all = Object.entries(S.teams);
    const attack = all.reduce((a, b) => (b[1].pf > a[1].pf ? b : a));
    const mvpLead = all.reduce((a, b) => (b[1].mvp > a[1].mvp ? b : a));
    weekHtml = `
      <div class="card">
        <div class="section-head" style="margin-bottom:6px"><h3>Giornata ${last.week}</h3><span class="muted">risultati</span></div>
        <div class="matchups">${games}</div>
      </div>
      <div class="card highlights">
        <div class="highlight"><span class="ico">⭐</span><div><small>MVP della giornata ${last.week}</small>${nameLink(S.keyOf[last.mvp])} · <span class="num">${fmt(last.mvpPoints)}</span> punti</div></div>
        <div class="highlight"><span class="ico">🔥</span><div><small>Corsa all'Archetipo Trophy (miglior attacco)</small>${nameLink(S.keyOf[attack[0]])} · <span class="num">${fmt(attack[1].pf)}</span> punti</div></div>
        <div class="highlight"><span class="ico">🏅</span><div><small>Più MVP di giornata finora</small>${nameLink(S.keyOf[mvpLead[0]])} · ${mvpLead[1].mvp}</div></div>
      </div>`;
  }

  return `<section id="stagione">
    <div class="section-head">
      <h2>Stagione ${S.year}</h2>
      <p>${done ? "Stagione conclusa" : `Regular season · ${S.doneWeeks} di ${S.regularWeeks} giornate giocate · aggiornamento automatico da Sleeper`}</p>
    </div>
    <div class="grid grid-3">${standings}</div>
    <div class="grid grid-2" style="margin-top:16px">${weekHtml}</div>
  </section>`;
}

function renderBacheca(bacheca) {
  const cards = bacheca.map((b) => {
    const podium = [b.runnerUp && `finalista ${nameLink(b.runnerUp)}`, b.third && `3° ${nameLink(b.third)}`].filter(Boolean).join(" · ");
    const conf = b.conference.map((c) => `<div class="trophy-main">${nameLink(c.team)} <span class="muted num" style="font-weight:500;font-size:14px">${c.label ? esc(c.label) + " · " : ""}${esc(c.record || "")}</span></div>`).join("");
    return `<article class="card season-card">
      <div class="year">${b.year}</div>
      <div class="champ-band">
        <div class="trophy-title">🏆 Lorenzo Selmi Trophy · Super Bowl</div>
        <div class="trophy-main">${nameLink(b.champion)}</div>
        ${podium ? `<div class="podium">${podium}</div>` : ""}
      </div>
      ${b.bestOffense ? `<div class="trophy"><div class="trophy-title">🔥 Archetipo Trophy · miglior attacco</div>
        <div class="trophy-main">${nameLink(b.bestOffense.team)} <span class="muted num" style="font-weight:500;font-size:14px">${fmt(b.bestOffense.pf)} pt</span></div></div>` : ""}
      ${conf ? `<div class="trophy"><div class="trophy-title">🏅 Conference champion · vincitore regular</div>${conf}</div>` : ""}
    </article>`;
  }).join("");
  return `<section id="bacheca">
    <div class="section-head"><h2>Bacheca dei trofei</h2><p>Albo d'oro stagione per stagione</p></div>
    <div class="seasons">${cards}</div>
  </section>`;
}

function renderMedals() {
  // include anche chi non gioca più (es. Lorenzo Selmi)
  const rows = {};
  const add = (key, field) => { if (!key) return; (rows[key] ||= { key, sb: 0, final: 0, conf: 0, arch: 0 })[field]++; };
  for (const b of DB.bacheca) {
    add(b.champion, "sb"); add(b.runnerUp, "final"); add(b.bestOffense?.team, "arch");
    b.conference.forEach((c) => add(c.team, "conf"));
  }
  const list = Object.values(rows)
    .filter((r) => r.sb + r.conf + r.arch > 0)
    .sort((a, b) => b.sb - a.sb || b.conf + b.arch - (a.conf + a.arch) || b.final - a.final);
  const cups = (n, e) => (n ? `<span class="cups">${e.repeat(n)}</span>` : `<span class="muted">–</span>`);
  const body = list.map((r) => `<tr>
    <td>${DB.teams[r.key] ? teamLink(r.key) : `<span class="tl-name">${esc(r.key)}</span>`}</td>
    <td>${cups(r.sb, "🏆")}</td><td class="num">${r.sb + r.final}</td>
    <td>${cups(r.conf, "🏅")}</td><td>${cups(r.arch, "🔥")}</td></tr>`).join("");
  return `<section>
    <div class="section-head"><h2>Medagliere</h2><p>Trofei vinti dal 2020</p></div>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Allenatore</th><th>Super Bowl</th><th>Finali giocate</th><th>Conference</th><th>Archetipo</th></tr></thead>
      <tbody>${body}</tbody></table></div>
  </section>`;
}

const STAT_COLS = [
  { id: "name", label: "Allenatore", get: (t) => t.name.toLowerCase(), asc: true },
  { id: "seasons", label: "Stagioni", get: (t) => t.nSeasons },
  { id: "rec", label: "Regular V-P", get: (t) => t.w - t.l / 1000 },
  { id: "pct", label: "% vittorie", get: (t) => (t.w + t.l ? t.w / (t.w + t.l) : 0) },
  { id: "po", label: "Play off V-P", get: (t) => t.pw },
  { id: "pf", label: "Punti fatti", get: (t) => t.pf },
  { id: "pa", label: "Punti subiti", get: (t) => t.pa },
  { id: "diff", label: "Differenza", get: (t) => t.pf - t.pa },
  { id: "mvp", label: "MVP giornata", get: (t) => t.mvp },
];
let statSort = { id: "rec", asc: false };

function renderStats() {
  const col = STAT_COLS.find((c) => c.id === statSort.id);
  const list = Object.values(DB.teams).filter((t) => t.active || t.nSeasons)
    .sort((a, b) => { const x = col.get(a), y = col.get(b); return (x < y ? -1 : x > y ? 1 : 0) * (statSort.asc ? 1 : -1); });
  const head = STAT_COLS.map((c) => `<th class="sortable ${c.id === statSort.id ? "sorted" + (statSort.asc ? " asc" : "") : ""}" data-sort="${c.id}">${c.label}</th>`).join("");
  const body = list.map((t) => {
    const diff = t.pf - t.pa;
    const isNew = t.nSeasons === 1 && t.seasons[DB.current.year];
    return `<tr>
      <td>${teamLink(t.key)}</td>
      <td class="num">${t.nSeasons}${isNew ? ' <span class="badge new">new</span>' : ""}</td>
      <td class="num strong">${t.w}-${t.l}</td>
      <td class="num">${pct(t.w, t.l)}</td>
      <td class="num">${t.pw + t.pl ? t.pw + "-" + t.pl : "–"}</td>
      <td class="num">${fmt(t.pf)}</td>
      <td class="num">${fmt(t.pa)}</td>
      <td class="num ${diff >= 0 ? "pos-v" : "neg-v"}">${diff >= 0 ? "+" : ""}${fmt(diff)}</td>
      <td class="num">${t.mvp}</td></tr>`;
  }).join("");
  return `<section id="squadre">
    <div class="section-head"><h2>Stats squadre</h2><p>Totali dal ${DB.firstSleeperYear} · stagione ${DB.current.year} inclusa</p></div>
    <div class="table-wrap"><table class="data" id="stats">
      <thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
    <p class="note">Clicca su una squadra per vedere il suo storico e gli scontri diretti. Clicca sulle intestazioni per ordinare.</p>
  </section>`;
}

function bindSort() {
  const table = document.getElementById("stats");
  if (!table) return;
  table.querySelector("thead").addEventListener("click", (e) => {
    const th = e.target.closest("[data-sort]");
    if (!th) return;
    const col = STAT_COLS.find((c) => c.id === th.dataset.sort);
    statSort = statSort.id === col.id ? { id: col.id, asc: !statSort.asc } : { id: col.id, asc: !!col.asc };
    document.getElementById("squadre").outerHTML = renderStats();
    bindSort();
  });
}

/* ---------- pagina squadra ---------- */

const TROPHY_LABEL = {
  sb: ["🏆", "Super Bowl"], final: ["🥈", "Finalista"], third: ["🥉", "Terzo posto"],
  conf: ["🏅", "Conference"], archetipo: ["🔥", "Archetipo"],
};

function renderTeam(key) {
  const T = DB.teams[key];
  if (!T) { app.innerHTML = `<p class="error">Squadra non trovata. <a href="#/">Torna alla home</a></p>`; return; }
  const S = DB.current;

  const order = ["sb", "final", "third", "conf", "archetipo"];
  const shelf = [...T.trophies].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.year - b.year)
    .map((x) => `<span class="chip ${["sb", "conf", "archetipo"].includes(x.type) ? "gold" : ""}">${TROPHY_LABEL[x.type][0]} ${TROPHY_LABEL[x.type][1]}${x.label ? " " + esc(x.label) : ""} ${x.year}</span>`).join("");

  const divName = T.active && T.division && S.divisions[T.division] ? S.divisions[T.division].name : null;
  const sub = [T.teamName, divName ? "Division " + divName : null].filter(Boolean).map(esc).join(" · ");

  const seasonRows = Object.values(T.seasons).sort((a, b) => b.year - a.year).map((s) => {
    const b = DB.bacheca.find((x) => x.year === s.year);
    let po = T.playoffYears.includes(s.year) ? "Play off" : "–";
    if (b) {
      if (b.champion === key) po = "🏆 Campione";
      else if (b.runnerUp === key) po = "🥈 Finalista";
      else if (b.third === key) po = "🥉 Terzo";
    }
    if (s.pw + s.pl) po += ` <span class="muted num">(${s.pw}-${s.pl})</span>`;
    if (s.live) po = '<span class="badge">in corso</span>';
    return `<tr><td class="strong">${s.year}</td>
      <td>${esc(T.confs[s.year] || "–")}</td>
      <td class="num strong">${s.w}-${s.l}</td>
      <td class="num">${fmt(s.pf)}</td><td class="num">${fmt(s.pa)}</td>
      <td class="num">${s.mvp}</td><td>${po}</td></tr>`;
  }).join("");

  // tutte le squadre incontrate più quelle attive mai affrontate (es. le nuove arrivate)
  const oppKeys = new Set([...Object.keys(T.h2h), ...Object.values(DB.teams).filter((t) => t.active).map((t) => t.key)]);
  oppKeys.delete(key);
  const opps = [...oppKeys].filter((o) => DB.teams[o]).map((o) => {
    const h = T.h2h[o] || { w: 0, l: 0, pw: 0, pl: 0 };
    return { o, ...h, g: h.w + h.l + h.pw + h.pl, bal: h.w + h.pw - h.l - h.pl };
  });
  opps.sort((a, b) => (b.g > 0) - (a.g > 0) || b.bal - a.bal || b.g - a.g);
  const played = opps.filter((x) => x.g > 0);
  const best = played[0], worst = played[played.length - 1];

  const h2hRows = opps.map((x) => {
    const tw = x.w + x.pw, tl = x.l + x.pl;
    const bar = tw + tl ? `<span class="bar"><i style="width:${(100 * tw) / (tw + tl)}%"></i><i style="width:${(100 * tl) / (tw + tl)}%"></i></span>` : "";
    return `<tr>
      <td>${teamLink(x.o)}</td>
      <td class="num">${x.w + x.l ? x.w + "-" + x.l : "–"}</td>
      <td class="num">${x.pw + x.pl ? x.pw + "-" + x.pl : "–"}</td>
      <td class="num strong">${tw + tl ? tw + "-" + tl : "–"}</td>
      <td class="num ${x.bal > 0 ? "pos-v" : x.bal < 0 ? "neg-v" : ""}">${tw + tl ? signed(x.bal) : "–"}</td>
      <td>${bar}</td></tr>`;
  }).join("");

  const rival = (x, title, ico) => x ? `<div class="card highlight"><span class="ico">${ico}</span><div><small>${title}</small>
      ${nameLink(x.o)} · <span class="num">${x.w + x.pw}-${x.l + x.pl}</span> in totale</div></div>` : "";

  app.innerHTML = `
    <a class="back" href="#/squadre">← Tutte le squadre</a>
    <div class="team-hero">
      ${avatarHtml(T)}
      <div>
        <div class="kicker">${T.active ? "Allenatore" : "Ex allenatore"}</div>
        <h1>${esc(T.name)}</h1>
        <div class="sub">${sub}</div>
      </div>
    </div>
    ${shelf ? `<div class="shelf">${shelf}</div>` : ""}

    <section style="padding-top:28px">
      <div class="tiles">
        <div class="tile"><small>Regular season</small><b class="num">${T.w}-${T.l}</b><span>${pct(T.w, T.l)} vittorie</span></div>
        <div class="tile"><small>Play off</small><b class="num">${T.pw + T.pl ? T.pw + "-" + T.pl : "–"}</b><span>${T.playoffYears.length} partecipazioni</span></div>
        <div class="tile"><small>Punti fatti</small><b class="num">${fmt(T.pf, 0)}</b><span>subiti ${fmt(T.pa, 0)}</span></div>
        <div class="tile"><small>MVP di giornata</small><b class="num">${T.mvp}</b><span>in ${T.nSeasons} stagion${T.nSeasons === 1 ? "e" : "i"}</span></div>
      </div>
    </section>

    <section>
      <div class="section-head"><h2>Scontri diretti</h2><p>Regular season e play off, dal ${DB.firstSleeperYear}</p></div>
      ${played.length > 1 ? `<div class="rivals">${rival(best, "Cliente preferito", "😎")}${rival(worst, "Bestia nera", "😈")}</div>` : ""}
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Avversario</th><th>Regular V-P</th><th>Play off V-P</th><th>Totale</th><th>Bilancio</th><th></th></tr></thead>
        <tbody>${h2hRows}</tbody></table></div>
    </section>

    <section>
      <div class="section-head"><h2>Stagione per stagione</h2></div>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Anno</th><th>Division</th><th>V-P</th><th>Punti fatti</th><th>Punti subiti</th><th>MVP giornata</th><th>Play off</th></tr></thead>
        <tbody>${seasonRows}</tbody>
      </table></div>
    </section>`;
}

/* ---------- avvio e navigazione ---------- */

function route() {
  if (!DB) return;
  const m = location.hash.match(/^#\/squadra\/(.+)$/);
  if (m) {
    renderTeam(decodeURIComponent(m[1]));
    window.scrollTo(0, 0);
    return;
  }
  renderHome();
  const anchor = location.hash.match(/^#\/(stagione|bacheca|squadre)$/);
  if (anchor) document.getElementById(anchor[1])?.scrollIntoView();
  else window.scrollTo(0, 0);
}

document.querySelectorAll("[data-scroll]").forEach((a) => {
  a.addEventListener("click", (e) => { e.preventDefault(); location.hash = "#/" + a.dataset.scroll; });
});
window.addEventListener("hashchange", route);

(async function start() {
  try {
    const [pre, seasons] = await Promise.all([getJSON("data/pre-sleeper.json"), loadSeasons()]);
    DB = buildModel(pre, seasons);
    route();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<p class="error">Non riesco a caricare i dati (${esc(e.message)}). Riprova tra poco.</p>`;
  }
})();
