/* Table tennis tournament manager — round robin groups + single elimination knockout. */

const STORAGE_KEY = 'tt-tournament-v1';

/** Match key for the third place play-off; deliberately not an `r{n}m{i}` key. */
const BRONZE = 'bronze';

/* ------------------------------------------------------------------ state */

function uid() {
  return 'p' + Math.random().toString(36).slice(2, 9);
}

function makePlayer(name) {
  return { id: uid(), name: name };
}

function defaultState() {
  return {
    title: 'Table Tennis Tournament',
    tab: 'setup',
    config: { advancePerGroup: 'all', groupBestOf: 1, koBestOf: 3 },
    groups: [
      { id: 'A', name: 'Group A', players: ['Player 1', 'Player 2', 'Player 3', 'Player 4', 'Player 5'].map(makePlayer) },
      { id: 'B', name: 'Group B', players: ['Player 6', 'Player 7', 'Player 8', 'Player 9', 'Player 10'].map(makePlayer) },
    ],
    scores: {},        // groupMatchId -> [[a,b], ...]
    winners: {},       // groupMatchId -> 'a' | 'b'   (winner recorded without scores)
    koScores: {},      // "r0m1" -> [[a,b], ...]
    koWinners: {},     // "r0m1" -> 'a' | 'b'
    bracket: null,     // { size, entrants: [playerId|null], bestOf, matchBestOf: {key: n} }
    seedEditing: false,
  };
}

let state = load() || defaultState();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const next = Object.assign(defaultState(), parsed);
    // brackets saved before the play-off existed: switch it on where it applies
    if (next.bracket && next.bracket.thirdPlace === undefined) {
      next.bracket.thirdPlace = next.bracket.size >= 4;
    }
    return next;
  } catch (e) {
    console.warn('Could not load saved tournament', e);
    return null;
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Could not save tournament', e);
  }
}

/* ----------------------------------------------------------------- helpers */

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function esc(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function allPlayers() {
  const out = [];
  state.groups.forEach((g) => g.players.forEach((p) => out.push(Object.assign({ groupId: g.id }, p))));
  return out;
}

function playerById(id) {
  if (!id) return null;
  return allPlayers().find((p) => p.id === id) || null;
}

function playerName(id) {
  const p = playerById(id);
  return p ? p.name : '';
}

function groupMatchId(groupId, aId, bId) {
  return groupId + '|' + aId + '|' + bId;
}

/**
 * Round robin schedule using the circle method: players are paired around a
 * circle and everyone but the first rotates each round. That guarantees every
 * player appears at most once per round, so nobody plays two matches back to
 * back and rest time is spread as evenly as the format allows.
 *
 * With an odd number of players a dummy is added; whoever draws it sits that
 * round out.
 */
function groupMatches(group) {
  const ps = group.players;
  if (ps.length < 2) return [];

  const ids = ps.map((p) => p.id);
  const odd = ids.length % 2 === 1;
  if (odd) ids.push(null); // null = sits out this round

  const n = ids.length;
  const half = n / 2;
  const rotating = ids.slice(1);
  const out = [];

  for (let round = 0; round < n - 1; round++) {
    const circle = [ids[0]].concat(rotating);
    const pairs = [];
    for (let i = 0; i < half; i++) {
      const a = circle[i];
      const b = circle[n - 1 - i];
      if (a == null || b == null) continue; // the player facing the dummy rests
      // keep the stronger seed on the left for a stable, readable listing
      const ai = ids.indexOf(a), bi = ids.indexOf(b);
      const [x, y] = ai < bi ? [a, b] : [b, a];
      pairs.push({ id: groupMatchId(group.id, x, y), groupId: group.id, a: x, b: y, round: round + 1 });
    }
    // matches are played one at a time, so order within the round to avoid the
    // previous round's last players opening the next one
    const prev = out[out.length - 1];
    if (prev) {
      const clash = (m) => (m.a === prev.a || m.a === prev.b || m.b === prev.a || m.b === prev.b) ? 1 : 0;
      const first = pairs.findIndex((m) => !clash(m));
      if (first > 0) pairs.unshift(pairs.splice(first, 1)[0]);
      // and push any remaining clash with the new opener toward the back
      for (let i = 1; i < pairs.length; i++) {
        const p = pairs[i - 1];
        if (pairs[i].a === p.a || pairs[i].a === p.b || pairs[i].b === p.a || pairs[i].b === p.b) {
          const swap = pairs.findIndex((m, j) => j > i && m.a !== p.a && m.a !== p.b && m.b !== p.a && m.b !== p.b);
          if (swap > -1) [pairs[i], pairs[swap]] = [pairs[swap], pairs[i]];
        }
      }
    }
    out.push(...pairs);
    rotating.unshift(rotating.pop()); // rotate everyone except the fixed first player
  }

  return out;
}

function setsNeeded(bestOf) {
  return Math.floor(bestOf / 2) + 1;
}

/**
 * Summarise a list of [a,b] set scores.
 * `override` records a winner when no scores were entered — you often only need
 * to know who won.
 */
function matchResult(sets, bestOf, override) {
  const need = setsNeeded(bestOf);
  let setsA = 0, setsB = 0, ptsA = 0, ptsB = 0;
  (sets || []).forEach(([a, b]) => {
    if (a == null || b == null) return;
    ptsA += a; ptsB += b;
    if (a > b) setsA++;
    else if (b > a) setsB++;
  });
  let winner = null;
  let byScore = false;
  if (setsA >= need && setsA > setsB) { winner = 'a'; byScore = true; }
  else if (setsB >= need && setsB > setsA) { winner = 'b'; byScore = true; }
  else if (override === 'a' || override === 'b') winner = override;
  // when only the winner is known, count it as a minimal 1–0 in sets so that
  // set based tie breaks still have something sane to work with
  const effA = byScore ? setsA : (winner === 'a' ? 1 : 0);
  const effB = byScore ? setsB : (winner === 'b' ? 1 : 0);
  return { setsA, setsB, ptsA, ptsB, effA, effB, winner, decided: winner !== null, byScore, need };
}

/** A legal table tennis set: first to 11, win by 2 (deuce goes on). */
function validSet(a, b) {
  if (a == null || b == null) return false;
  if (a < 0 || b < 0) return false;
  const hi = Math.max(a, b), lo = Math.min(a, b);
  if (hi < 11) return false;
  if (hi === 11) return lo <= 9;
  return hi - lo === 2;
}

function getSets(store, key) {
  return (store[key] || []).map((s) => s.slice());
}

/** Result of a group match (scores or a recorded winner). */
function groupResult(matchId) {
  return matchResult(getSets(state.scores, matchId), state.config.groupBestOf, state.winners[matchId]);
}

/** Best of N for one knockout match: per match → per round → stage default. */
function koBestOf(key) {
  const b = state.bracket;
  if (!b) return state.config.koBestOf;
  const perMatch = b.matchBestOf || {};
  if (perMatch[key]) return perMatch[key];
  if (key === BRONZE) return b.bronzeBestOf || b.bestOf;
  const round = +String(key).slice(1).split('m')[0];
  const perRound = b.roundBestOf || {};
  return perRound[round] || b.bestOf;
}

/* ---------------------------------------------------------------- standings */

function blankStats(id) {
  return { id, played: 0, wins: 0, losses: 0, setsW: 0, setsL: 0, ptsW: 0, ptsL: 0 };
}

function ratio(w, l) {
  if (l === 0) return w === 0 ? 0 : Infinity;
  return w / l;
}

/** Stats for the given players, counting only matches among `scope` (defaults to all). */
function computeStats(group, scope) {
  const ids = scope || group.players.map((p) => p.id);
  const table = {};
  ids.forEach((id) => { table[id] = blankStats(id); });

  groupMatches(group).forEach((m) => {
    if (!table[m.a] || !table[m.b]) return;
    const r = groupResult(m.id);
    if (!r.decided) return;
    const A = table[m.a], B = table[m.b];
    A.played++; B.played++;
    A.setsW += r.effA; A.setsL += r.effB;
    B.setsW += r.effB; B.setsL += r.effA;
    A.ptsW += r.ptsA; A.ptsL += r.ptsB;
    B.ptsW += r.ptsB; B.ptsL += r.ptsA;
    if (r.winner === 'a') { A.wins++; B.losses++; } else { B.wins++; A.losses++; }
  });
  return table;
}

/**
 * Ranked standings for a group.
 * Ties on wins are broken by the head-to-head mini table (wins, set ratio, point ratio)
 * between exactly the tied players, then by overall set/point ratio.
 */
function standings(group) {
  const overall = computeStats(group);
  const players = group.players.map((p) => ({ player: p, s: overall[p.id] }));

  players.sort((x, y) => y.s.wins - x.s.wins);

  const ordered = [];
  let i = 0;
  while (i < players.length) {
    let j = i;
    while (j + 1 < players.length && players[j + 1].s.wins === players[i].s.wins) j++;
    const block = players.slice(i, j + 1);
    if (block.length > 1) ordered.push(...breakTie(group, block, overall));
    else ordered.push(Object.assign({ tied: false }, block[0]));
    i = j + 1;
  }

  return ordered.map((row, idx) => Object.assign({ rank: idx + 1 }, row));
}

function breakTie(group, block, overall) {
  const ids = block.map((b) => b.player.id);
  const mini = computeStats(group, ids);

  const keyed = block.map((b) => {
    const m = mini[b.player.id];
    return {
      player: b.player,
      s: b.s,
      k: [m.wins, ratio(m.setsW, m.setsL), ratio(m.ptsW, m.ptsL), ratio(b.s.setsW, b.s.setsL), ratio(b.s.ptsW, b.s.ptsL)],
    };
  });

  keyed.sort((x, y) => {
    for (let i = 0; i < x.k.length; i++) {
      if (x.k[i] !== y.k[i]) return y.k[i] - x.k[i];
    }
    return x.player.name.localeCompare(y.player.name);
  });

  return keyed.map((row, i) => {
    const prev = keyed[i - 1], next = keyed[i + 1];
    const same = (o) => o && o.k.every((v, n) => v === row.k[n]);
    return { player: row.player, s: row.s, tied: Boolean(same(prev) || same(next)) };
  });
}

function groupProgress(group) {
  const ms = groupMatches(group);
  const done = ms.filter((m) => groupResult(m.id).decided).length;
  return { done, total: ms.length, complete: ms.length > 0 && done === ms.length };
}

function allGroupsComplete() {
  return state.groups.length > 0 && state.groups.every((g) => groupProgress(g).complete);
}

/* ----------------------------------------------------------------- bracket */

/** Standard single elimination seed positions for a bracket of `size` (1-based seeds). */
function seedOrder(size) {
  let order = [1, 2];
  while (order.length < size) {
    const n = order.length * 2 + 1;
    const next = [];
    order.forEach((s) => { next.push(s, n - s); });
    order = next;
  }
  return order;
}

/** How many players from each group reach the knockout ('all' = everyone). */
function advanceCount() {
  const n = state.config.advancePerGroup;
  if (n === 'all' || n == null) return Infinity;
  return +n;
}

/**
 * Qualified players ordered by seed strength: all group winners first, then all
 * runners up, and so on. Combined with the standard seed positions this puts the
 * group winners in separate halves, pairs each qualifier against a different
 * group, and — when the field is not a power of two — hands the byes to the
 * strongest seeds (with 13 players the top 3 seeds sit out the first round).
 */
function qualifiedSeeds() {
  const perGroup = state.groups.map((g) => standings(g));
  const limit = Math.min(advanceCount(), Math.max(...perGroup.map((r) => r.length), 0));
  const seeds = [];
  for (let rank = 0; rank < limit; rank++) {
    perGroup.forEach((rows) => {
      if (rows[rank]) seeds.push(rows[rank].player.id);
    });
  }
  return seeds;
}

function generateBracket() {
  const seeds = qualifiedSeeds();
  if (seeds.length < 2) return null;
  let size = 2;
  while (size < seeds.length) size *= 2;

  const positions = seedOrder(size);
  const entrants = positions.map((seedNo) => seeds[seedNo - 1] || null);
  const rounds = Math.log2(size);
  // semi-finals and the final are longer by default; every match can be changed
  const roundBestOf = {};
  if (rounds >= 2) roundBestOf[rounds - 2] = 5;
  if (rounds >= 1) roundBestOf[rounds - 1] = 5;
  return {
    size, entrants, bestOf: state.config.koBestOf, matchBestOf: {}, roundBestOf,
    thirdPlace: rounds >= 2, bronzeBestOf: state.config.koBestOf,
  };
}

function roundName(roundIdx, totalRounds) {
  const left = totalRounds - roundIdx;
  if (left === 1) return 'Final';
  if (left === 2) return 'Semi-finals';
  if (left === 3) return 'Quarter-finals';
  return 'Round of ' + Math.pow(2, left);
}

/** Resolve the whole bracket: who plays whom, per-match result, and the champion. */
function resolveBracket() {
  const b = state.bracket;
  if (!b) return null;
  const totalRounds = Math.log2(b.size);
  const rounds = [];
  let slots = b.entrants.slice();

  for (let r = 0; r < totalRounds; r++) {
    const matches = [];
    const nextSlots = [];
    for (let i = 0; i < slots.length; i += 2) {
      const a = slots[i], bId = slots[i + 1];
      const key = 'r' + r + 'm' + (i / 2);
      const sets = getSets(state.koScores, key);
      const bestOf = koBestOf(key);
      const res = matchResult(sets, bestOf, state.koWinners[key]);
      let winner = null;
      let bye = false;

      // an empty slot is only a real bye in the first round; later on it just
      // means the feeding match has not been decided yet
      if (r === 0 && a && !bId) { winner = a; bye = true; }
      else if (r === 0 && !a && bId) { winner = bId; bye = true; }
      else if (a && bId && res.decided) { winner = res.winner === 'a' ? a : bId; }

      matches.push({
        key, round: r, index: i / 2, a, b: bId, sets, res, winner, bye, bestOf,
        playable: Boolean(a && bId),
      });
      nextSlots.push(winner);
    }
    rounds.push({ name: roundName(r, totalRounds), matches });
    slots = nextSlots;
  }

  // third place play-off between the two beaten semi-finalists
  let bronze = null;
  if (b.thirdPlace && totalRounds >= 2) {
    const semis = rounds[totalRounds - 2].matches;
    const loserOf = (m) => (m && m.winner && m.playable) ? (m.winner === m.a ? m.b : m.a) : null;
    const a = loserOf(semis[0]), bId = loserOf(semis[1]);
    const sets = getSets(state.koScores, BRONZE);
    const bestOf = koBestOf(BRONZE);
    const res = matchResult(sets, bestOf, state.koWinners[BRONZE]);
    const winner = (a && bId && res.decided) ? (res.winner === 'a' ? a : bId) : null;
    bronze = {
      key: BRONZE, round: totalRounds - 1, index: 0, a, b: bId, sets, res, winner,
      bye: false, bestOf, playable: Boolean(a && bId), isBronze: true,
    };
  }

  const finalMatch = rounds[totalRounds - 1] && rounds[totalRounds - 1].matches[0];
  const runnerUp = (finalMatch && finalMatch.winner && finalMatch.playable)
    ? (finalMatch.winner === finalMatch.a ? finalMatch.b : finalMatch.a)
    : null;

  return {
    rounds, champion: slots[0] || null, totalRounds, bronze,
    runnerUp, third: bronze ? bronze.winner : null,
  };
}

/* ------------------------------------------------------------------ render */

function render() {
  $$('#tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === state.tab));
  $('#tournamentTitle').textContent = state.title || 'Table Tennis Tournament';
  const view = $('#view');
  if (state.tab === 'setup') view.innerHTML = renderSetup();
  else if (state.tab === 'groups') view.innerHTML = renderGroups();
  else view.innerHTML = renderKnockout();
  wire();
}

/* -- setup -- */

function renderSetup() {
  const c = state.config;
  const groupCards = state.groups.map((g, gi) => `
    <div class="card">
      <div class="row spread" style="margin-bottom:12px">
        <input data-groupname="${gi}" value="${esc(g.name)}" style="font-weight:650;flex:1" />
        ${state.groups.length > 2 ? `<button class="icon-btn" data-delgroup="${gi}" title="Remove group">✕</button>` : ''}
      </div>
      ${g.players.map((p, pi) => `
        <div class="player-row">
          <span class="seedno">${pi + 1}</span>
          <input data-player="${gi}:${pi}" value="${esc(p.name)}" placeholder="Player name" />
          <button class="icon-btn" data-delplayer="${gi}:${pi}" title="Remove player">✕</button>
        </div>`).join('')}
      <div class="row spread" style="margin-top:10px">
        <button class="btn ghost small" data-addplayer="${gi}">+ Add player</button>
        <span class="small muted">${g.players.length} players · ${(g.players.length * (g.players.length - 1)) / 2} matches</span>
      </div>
    </div>`).join('');

  const seeds = qualifiedSeeds().length;
  let bracketSize = 2;
  while (bracketSize < seeds) bracketSize *= 2;
  const byes = seeds >= 2 ? bracketSize - seeds : 0;

  return `
    <div class="section-title"><h2>Tournament setup</h2><span class="pill">${allPlayers().length} players</span></div>
    <div class="card" style="margin-bottom:16px">
      <h3>Format</h3>
      <div class="config-grid">
        <label class="field">Tournament name
          <input id="cfgTitle" value="${esc(state.title)}" />
        </label>
        <label class="field">Who reaches the knockout
          <select id="cfgAdvance">
            <option value="all" ${c.advancePerGroup === 'all' ? 'selected' : ''}>All players</option>
            ${[1, 2, 3, 4].map((n) => `<option value="${n}" ${+c.advancePerGroup === n ? 'selected' : ''}>Top ${n} per group</option>`).join('')}
          </select>
        </label>
        <label class="field">Group stage matches
          <select id="cfgGroupBestOf">
            ${[1, 3, 5, 7].map((n) => `<option value="${n}" ${c.groupBestOf === n ? 'selected' : ''}>Best of ${n}</option>`).join('')}
          </select>
        </label>
        <label class="field">Knockout matches
          <select id="cfgKoBestOf">
            ${[1, 3, 5, 7].map((n) => `<option value="${n}" ${c.koBestOf === n ? 'selected' : ''}>Best of ${n}</option>`).join('')}
          </select>
        </label>
      </div>
      <p class="hint">
        ${seeds} player${seeds === 1 ? '' : 's'} reach the knockout → ${seeds >= 2 ? bracketSize + '-player bracket' : 'not enough players yet'}${byes ? `, with ${byes} bye${byes > 1 ? 's' : ''} for the top ${byes} seed${byes > 1 ? 's' : ''}` : ''}.
        Semi-finals and the final default to best of 5, and every knockout match can be changed individually.
      </p>
    </div>

    <div class="grid cols-2">${groupCards}</div>
    <div class="row" style="margin-top:16px">
      <button class="btn ghost" id="addGroup">+ Add group</button>
      <button class="btn" id="goGroups">Start group stage →</button>
    </div>`;
}

/* -- group stage -- */

function renderGroups() {
  if (!state.groups.length) return emptyState('No groups yet', 'Add groups and players in the Setup tab.');

  const cards = state.groups.map((g) => {
    const prog = groupProgress(g);
    const rows = standings(g).map((r) => {
      const qualifies = r.rank <= advanceCount();
      const sd = r.s.setsW - r.s.setsL;
      const pd = r.s.ptsW - r.s.ptsL;
      const sign = (n) => (n > 0 ? '+' + n : String(n));
      return `<tr class="${qualifies ? 'qualify' : ''}">
        <td class="rank">${r.rank}</td>
        <td>${esc(r.player.name)}${r.tied ? '<span class="tiedflag" title="Level on every tie break — adjust the seeding by hand if it matters">≈</span>' : ''}</td>
        <td class="num">${r.s.played}</td>
        <td class="num">${r.s.wins}</td>
        <td class="num">${r.s.losses}</td>
        <td class="num">${r.s.setsW}–${r.s.setsL}</td>
        <td class="num ${sd > 0 ? 'pos' : sd < 0 ? 'neg' : ''}">${sign(sd)}</td>
        <td class="num">${r.s.ptsW}–${r.s.ptsL}</td>
        <td class="num ${pd > 0 ? 'pos' : pd < 0 ? 'neg' : ''}">${sign(pd)}</td>
      </tr>`;
    }).join('');

    // group the schedule into rotation rounds so it is obvious who is resting
    const byRound = [];
    groupMatches(g).forEach((m) => {
      (byRound[m.round] = byRound[m.round] || []).push(m);
    });

    const matches = byRound.map((ms, rnd) => {
      if (!ms || !ms.length) return '';
      const playing = new Set();
      ms.forEach((m) => { playing.add(m.a); playing.add(m.b); });
      const resting = g.players.filter((p) => !playing.has(p.id)).map((p) => p.name);

      const rows = ms.map((m) => {
        const r = groupResult(m.id);
        const sets = getSets(state.scores, m.id);
        const detail = sets.length ? sets.map(([a, b]) => `${a}-${b}`).join(', ') : '';
        const score = sets.length ? r.setsA + '–' + r.setsB : (r.decided ? '✓' : '–');
        return `<div class="match ${r.decided ? 'done' : ''}" data-gmatch="${esc(m.id)}">
          <div class="names">
            <span class="nm ${r.winner === 'a' ? 'win' : ''}">${esc(playerName(m.a))}</span>
            <span class="vs">vs</span>
            <span class="nm ${r.winner === 'b' ? 'win' : ''}">${esc(playerName(m.b))}</span>
          </div>
          <span class="sets">${esc(detail)}${!sets.length && r.decided ? 'winner only' : ''}</span>
          <span class="score">${score}</span>
          <button class="btn ghost small">${r.decided ? 'Edit' : 'Enter'}</button>
        </div>`;
      }).join('');

      return `<div class="sched-round">
        <div class="sched-head">
          <span class="rnum">Round ${rnd}</span>
          ${resting.length ? `<span class="resting">${esc(resting.join(', '))} rest${resting.length === 1 ? 's' : ''}</span>` : ''}
        </div>
        ${rows}
      </div>`;
    }).join('');

    return `<div class="card">
      <div class="row spread" style="margin-bottom:10px">
        <h3>${esc(g.name)}</h3>
        <span class="pill ${prog.complete ? 'ok' : ''}">${prog.done}/${prog.total} played</span>
      </div>
      <table>
        <thead><tr>
          <th>#</th><th>Player</th>
          <th class="num" title="Played">P</th>
          <th class="num" title="Wins">W</th>
          <th class="num" title="Losses">L</th>
          <th class="num" title="Sets won–lost">Sets</th>
          <th class="num" title="Set difference">±</th>
          <th class="num" title="Points won–lost">Points</th>
          <th class="num" title="Point difference">±</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="hint" style="margin-top:8px">Equal wins are split by head-to-head, then sets won, then points won.</p>
      <h4 style="margin:16px 0 8px;font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)">Schedule</h4>
      <p class="hint" style="margin:-4px 0 10px">Rotated so nobody plays twice in a row.</p>
      ${matches}
    </div>`;
  }).join('');

  const ready = allGroupsComplete();
  const qualifyText = advanceCount() === Infinity
    ? 'Every player goes through to the knockout, seeded by their group finish.'
    : 'Top ' + advanceCount() + ' of each group qualify.';
  return `
    <div class="section-title">
      <h2>Group stage</h2>
      <span class="pill">Best of ${state.config.groupBestOf}</span>
      <span class="pill ${ready ? 'ok' : 'warn'}">${ready ? 'All matches played' : 'In progress'}</span>
      <span class="spacer"></span>
      <label class="row small muted print-opt" style="gap:6px" title="Otherwise the sheets are blank, ready to fill in by hand">
        <input type="checkbox" id="printWithResults"> include recorded results
      </label>
      <button class="btn ghost small" id="printSheets" title="Print or save as PDF">🖨 Print score sheets</button>
    </div>
    <div class="grid cols-2">${cards}</div>
    <div class="row" style="margin-top:16px">
      <button class="btn" id="goKnockout">${state.bracket ? 'Go to knockout stage →' : 'Build knockout bracket →'}</button>
      <span class="hint">${ready ? qualifyText : 'You can build the bracket before every match is played, but standings may still change.'}</span>
    </div>`;
}

/* -- knockout -- */

/* Bracket geometry — kept in one place so the cards and the connector lines
   are always drawn from exactly the same numbers. */
const KO = {
  matchW: 208,
  matchH: 88,     // two player rows + the footer
  gapY: 16,       // space between two first round matches
  colGap: 52,     // horizontal room for the connector elbows
  headerH: 34,
};

/** Vertical centre of every match, round by round. A match always sits halfway
 *  between the two matches that feed it. */
function bracketLayout(resolved) {
  const centres = [];
  resolved.rounds.forEach((round, r) => {
    centres[r] = round.matches.map((m, i) => {
      if (r === 0) return i * (KO.matchH + KO.gapY) + KO.matchH / 2;
      return (centres[r - 1][i * 2] + centres[r - 1][i * 2 + 1]) / 2;
    });
  });
  const colX = (r) => r * (KO.matchW + KO.colGap);
  const height = resolved.rounds[0].matches.length * (KO.matchH + KO.gapY);
  return { centres, colX, height };
}

function renderKnockout() {
  if (!state.bracket) {
    const seeds = qualifiedSeeds();
    let size = 2;
    while (size < seeds.length) size *= 2;
    const byes = seeds.length >= 2 ? size - seeds.length : 0;
    return `
      <div class="section-title"><h2>Knockout stage</h2></div>
      <div class="empty-state">
        <h3>No bracket yet</h3>
        <p>${advanceCount() === Infinity ? 'Every player goes through, seeded by their group finish.' : 'Top ' + advanceCount() + ' of each group qualify.'}</p>
        <p class="small">${seeds.length} qualified${seeds.length >= 2 ? ` → ${size}-player bracket${byes ? ` with ${byes} bye${byes > 1 ? 's' : ''}` : ''}` : ''} · ${allGroupsComplete() ? 'group stage complete' : 'group stage still in progress'}</p>
        <button class="btn" id="buildBracket" ${seeds.length < 2 ? 'disabled' : ''} style="margin-top:12px">Generate bracket</button>
      </div>`;
  }

  const resolved = resolveBracket();
  const seedNo = {};
  const order = seedOrder(state.bracket.size);
  state.bracket.entrants.forEach((id, i) => { if (id) seedNo[id] = order[i]; });

  const { centres, colX, height } = bracketLayout(resolved);
  const totalW = colX(resolved.rounds.length) + KO.matchW + 40;

  // ---- connector lines, drawn first so the cards sit on top of them
  const paths = [];
  resolved.rounds.forEach((round, r) => {
    if (r === resolved.rounds.length - 1) return;
    round.matches.forEach((m, i) => {
      if (!m.a && !m.b && r === 0) return;
      const x1 = colX(r) + KO.matchW;
      const x2 = colX(r + 1);
      const mid = x1 + KO.colGap / 2;
      const y1 = centres[r][i];
      const y2 = centres[r + 1][Math.floor(i / 2)];
      const live = m.winner ? ' live' : '';
      paths.push(`<path class="link${live}" d="M${x1} ${y1} H${mid} V${y2} H${x2}" />`);
    });
  });
  // final → champion card
  const lastR = resolved.rounds.length - 1;
  const fx = colX(lastR) + KO.matchW;
  const fy = centres[lastR][0];
  paths.push(`<path class="link${resolved.champion ? ' live' : ''}" d="M${fx} ${fy} H${fx + KO.colGap}" />`);

  // ---- third place play-off, parked under the final
  const bronze = resolved.bronze;
  const bronzeTop = fy + KO.matchH / 2 + 44;
  const bronzeMid = bronzeTop + KO.matchH / 2;
  if (bronze) {
    // dashed feeds from each semi-final: the beaten player drops down to here
    const semiR = lastR - 1;
    resolved.rounds[semiR].matches.forEach((m, i) => {
      const x1 = colX(semiR) + KO.matchW;
      const mid = x1 + KO.colGap * 0.34;
      const y1 = centres[semiR][i];
      const loserKnown = m.winner && m.playable;
      paths.push(`<path class="link drop${loserKnown ? ' live' : ''}" d="M${x1} ${y1} H${mid} V${bronzeMid} H${colX(lastR)}" />`);
    });
  }

  // ---- match cards
  const cards = [];
  resolved.rounds.forEach((round, r) => {
    round.matches.forEach((m, i) => {
      if (!m.a && !m.b && r === 0) return;
      const cls = m.winner && !m.bye ? 'done' : (m.playable ? 'ready' : '');
      let foot;
      if (m.bye) foot = 'Bye · advances automatically';
      else if (!m.playable) foot = 'Waiting for previous round';
      else if (m.sets.length) foot = m.sets.map(([x, y]) => x + '-' + y).join(', ');
      else if (m.winner) foot = 'Winner recorded';
      else foot = 'Click to enter result';
      const style = `left:${colX(r)}px;top:${centres[r][i] - KO.matchH / 2}px;width:${KO.matchW}px`;
      cards.push(`<div class="ko-match ${cls} ${m.bye ? 'bye' : ''}" data-komatch="${m.key}" style="${style}">
        ${slotHtml(m, 'a', seedNo)}
        <div class="ko-split"><span>vs</span></div>
        ${slotHtml(m, 'b', seedNo)}
        <div class="ko-foot"><span class="ftxt">${esc(foot)}</span>${m.playable ? `<span class="bo">Bo${m.bestOf}</span>` : ''}</div>
      </div>`);
    });
  });

  if (bronze) {
    const cls = bronze.winner ? 'done' : (bronze.playable ? 'ready' : '');
    let foot;
    if (!bronze.playable) foot = 'Waiting for the semi-finals';
    else if (bronze.sets.length) foot = bronze.sets.map(([x, y]) => x + '-' + y).join(', ');
    else if (bronze.winner) foot = 'Winner recorded';
    else foot = 'Click to enter result';
    const style = `left:${colX(lastR)}px;top:${bronzeTop}px;width:${KO.matchW}px`;
    cards.push(`<div class="ko-match bronze ${cls}" data-komatch="${BRONZE}" style="${style}">
      <div class="ko-tag">3rd place play-off</div>
      ${slotHtml(bronze, 'a', seedNo)}
      <div class="ko-split"><span>vs</span></div>
      ${slotHtml(bronze, 'b', seedNo)}
      <div class="ko-foot"><span class="ftxt">${esc(foot)}</span>${bronze.playable ? `<span class="bo">Bo${bronze.bestOf}</span>` : ''}</div>
    </div>`);
  }

  // ---- round headers
  const headers = resolved.rounds.map((round, ri) => {
    const roundBo = (state.bracket.roundBestOf || {})[ri] || state.bracket.bestOf;
    const played = round.matches.filter((m) => m.playable && m.winner).length;
    const total = round.matches.filter((m) => m.playable).length;
    return `<div class="round-head" style="left:${colX(ri)}px;width:${KO.matchW}px">
      <span class="rname">${round.name}</span>
      <span class="rprog">${total ? played + '/' + total : ''}</span>
      <select class="round-bo" data-roundbo="${ri}" title="Match length for this whole round">
        ${[1, 3, 5, 7].map((n) => `<option value="${n}" ${roundBo === n ? 'selected' : ''}>Bo${n}</option>`).join('')}
      </select>
    </div>`;
  }).join('');

  const champX = colX(resolved.rounds.length);
  const champHead = `<div class="round-head" style="left:${champX}px;width:${KO.matchW}px"><span class="rname">Final standings</span></div>`;
  const podiumRow = (place, medal, id, waiting) => `
    <div class="pod-row ${id ? 'filled' : ''} p${place}">
      <span class="medal">${medal}</span>
      <span class="pname">${id ? esc(playerName(id)) : 'TBD'}</span>
      <span class="pplace">${place === 1 ? '1st' : place === 2 ? '2nd' : '3rd'}</span>
      ${id ? '' : `<span class="pwait">${waiting}</span>`}
    </div>`;
  const champCard = `<div class="champion ${resolved.champion ? 'crowned' : ''}" style="left:${champX}px;top:${fy - 62}px;width:${KO.matchW}px">
      ${podiumRow(1, '🥇', resolved.champion, 'play the final')}
      ${podiumRow(2, '🥈', resolved.runnerUp, 'play the final')}
      ${bronze ? podiumRow(3, '🥉', resolved.third, 'play the 3rd place match') : ''}
    </div>`;

  const byeCount = resolved.rounds[0].matches.filter((m) => m.bye).length;
  const bodyH = bronze ? Math.max(height, bronzeTop + KO.matchH + 10) : height;

  return `
    <div class="section-title">
      <h2>Knockout stage</h2>
      <span class="pill">${state.bracket.size}-player bracket</span>
      ${byeCount ? `<span class="pill">${byeCount} bye${byeCount > 1 ? 's' : ''}</span>` : ''}
    </div>
    <div class="row" style="margin-bottom:14px">
      <button class="btn ghost small" id="toggleSeeds">${state.seedEditing ? 'Done adjusting' : 'Adjust seeding'}</button>
      <button class="btn ghost small" id="regenBracket">Regenerate from standings</button>
      <label class="row small muted" style="gap:6px">Default
        <select id="koBestOf" title="Default match length">
          ${[1, 3, 5, 7].map((n) => `<option value="${n}" ${state.bracket.bestOf === n ? 'selected' : ''}>Best of ${n}</option>`).join('')}
        </select>
      </label>
      ${resolved.totalRounds >= 2 ? `<label class="row small muted" style="gap:6px" title="Beaten semi-finalists play for 3rd">
        <input type="checkbox" id="toggleThird" ${state.bracket.thirdPlace ? 'checked' : ''}> 3rd place match
      </label>` : ''}
      <button class="btn ghost small danger" id="clearBracket">Delete bracket</button>
      <span class="hint" style="margin:0">Lines follow each winner into their next match.</span>
    </div>
    ${state.seedEditing ? renderSeedEditor() : ''}
    <div class="bracket-scroll">
      <div class="bracket-canvas" style="width:${totalW}px">
        <div class="bracket-heads" style="height:${KO.headerH}px">${headers}${champHead}</div>
        <div class="bracket-body" style="height:${bodyH}px">
          <svg class="links" width="${totalW}" height="${bodyH}">${paths.join('')}</svg>
          ${cards.join('')}
          ${champCard}
        </div>
      </div>
    </div>`;
}

function slotHtml(m, side, seedNo) {
  const id = side === 'a' ? m.a : m.b;
  const isWinner = m.winner && m.winner === id;
  const isLoser = m.winner && id && m.winner !== id;
  if (!id) return `<div class="slot empty"><span class="sname">${m.bye ? '—' : 'TBD'}</span></div>`;
  const setsWon = side === 'a' ? m.res.setsA : m.res.setsB;
  const showSets = m.playable && m.sets.length;
  const mark = !showSets && isWinner && !m.bye ? '✓' : '';
  const seed = seedNo && seedNo[id] ? `<span class="seedtag">${seedNo[id]}</span>` : '';
  return `<div class="slot ${isWinner ? 'winner' : ''} ${isLoser ? 'loser' : ''}">
    ${seed}
    <span class="sname">${esc(playerName(id))}</span>
    <span class="ssets">${showSets ? setsWon : mark}</span>
  </div>`;
}

function renderSeedEditor() {
  const options = allPlayers();
  const slots = state.bracket.entrants.map((id, i) => `
    <div class="seed-slot">
      <span class="lbl">#${i + 1}</span>
      <select data-entrant="${i}">
        <option value="">— Bye —</option>
        ${options.map((p) => `<option value="${p.id}" ${p.id === id ? 'selected' : ''}>${esc(p.name)} (${esc(p.groupId)})</option>`).join('')}
      </select>
    </div>`).join('');
  return `<div class="card" style="margin-bottom:16px">
    <h3>Adjust first round seeding</h3>
    <p class="hint" style="margin-bottom:12px">Slots are paired top to bottom: #1 plays #2, #3 plays #4, and so on. Changing a slot clears results that depended on it.</p>
    <div class="seed-editor">${slots}</div>
  </div>`;
}

function emptyState(title, msg) {
  return `<div class="empty-state"><h3>${esc(title)}</h3><p>${esc(msg)}</p></div>`;
}

/* ------------------------------------------------------------------ events */

function wire() {
  // setup: config
  const bind = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); };

  bind('#cfgTitle', 'input', (e) => { state.title = e.target.value; $('#tournamentTitle').textContent = state.title; save(); });
  bind('#cfgAdvance', 'change', (e) => {
    state.config.advancePerGroup = e.target.value === 'all' ? 'all' : +e.target.value;
    save(); render();
  });
  bind('#cfgGroupBestOf', 'change', (e) => { state.config.groupBestOf = +e.target.value; save(); render(); });
  bind('#cfgKoBestOf', 'change', (e) => { state.config.koBestOf = +e.target.value; save(); render(); });

  $$('[data-groupname]').forEach((el) => el.addEventListener('input', (e) => {
    state.groups[+el.dataset.groupname].name = e.target.value; save();
  }));
  $$('[data-player]').forEach((el) => el.addEventListener('input', (e) => {
    const [gi, pi] = el.dataset.player.split(':').map(Number);
    state.groups[gi].players[pi].name = e.target.value; save();
  }));
  $$('[data-delplayer]').forEach((el) => el.addEventListener('click', () => {
    const [gi, pi] = el.dataset.delplayer.split(':').map(Number);
    const removed = state.groups[gi].players.splice(pi, 1)[0];
    purgePlayer(removed.id);
    save(); render();
  }));
  $$('[data-addplayer]').forEach((el) => el.addEventListener('click', () => {
    const gi = +el.dataset.addplayer;
    state.groups[gi].players.push(makePlayer('Player ' + (allPlayers().length + 1)));
    save(); render();
  }));
  $$('[data-delgroup]').forEach((el) => el.addEventListener('click', () => {
    const gi = +el.dataset.delgroup;
    state.groups[gi].players.forEach((p) => purgePlayer(p.id));
    state.groups.splice(gi, 1);
    save(); render();
  }));
  bind('#addGroup', 'click', () => {
    const letter = String.fromCharCode(65 + state.groups.length);
    state.groups.push({ id: letter, name: 'Group ' + letter, players: [makePlayer('Player 1'), makePlayer('Player 2'), makePlayer('Player 3'), makePlayer('Player 4')] });
    save(); render();
  });
  bind('#goGroups', 'click', () => { state.tab = 'groups'; save(); render(); });

  // group stage
  $$('[data-gmatch]').forEach((el) => el.addEventListener('click', () => openGroupMatch(el.dataset.gmatch)));
  bind('#printSheets', 'click', () => printGroupSheets($('#printWithResults').checked));
  bind('#goKnockout', 'click', () => {
    if (!state.bracket) {
      const b = generateBracket();
      if (!b) { toast('Not enough qualified players yet.'); return; }
      state.bracket = b;
    }
    state.tab = 'knockout'; save(); render();
  });

  // knockout
  bind('#buildBracket', 'click', () => {
    const b = generateBracket();
    if (!b) { toast('Not enough qualified players yet.'); return; }
    state.bracket = b; save(); render();
  });
  bind('#regenBracket', 'click', () => {
    if (!confirm('Rebuild the bracket from the current group standings? Knockout results will be cleared.')) return;
    const b = generateBracket();
    if (!b) { toast('Not enough qualified players yet.'); return; }
    state.bracket = b; state.koScores = {}; state.koWinners = {}; save(); render();
    toast('Bracket rebuilt from standings');
  });
  bind('#clearBracket', 'click', () => {
    if (!confirm('Delete the bracket and all knockout results?')) return;
    state.bracket = null; state.koScores = {}; state.koWinners = {}; state.seedEditing = false; save(); render();
  });
  bind('#toggleSeeds', 'click', () => { state.seedEditing = !state.seedEditing; save(); render(); });
  bind('#koBestOf', 'change', (e) => { state.bracket.bestOf = +e.target.value; save(); render(); });
  bind('#toggleThird', 'change', (e) => {
    state.bracket.thirdPlace = e.target.checked;
    if (!e.target.checked) { delete state.koScores[BRONZE]; delete state.koWinners[BRONZE]; }
    save(); render();
  });
  $$('[data-entrant]').forEach((el) => el.addEventListener('change', () => {
    const idx = +el.dataset.entrant;
    const value = el.value || null;
    const existing = state.bracket.entrants.indexOf(value);
    if (value && existing !== -1 && existing !== idx) state.bracket.entrants[existing] = null; // keep entrants unique
    state.bracket.entrants[idx] = value;
    clearKoFrom(Math.floor(idx / 2));
    save(); render();
  }));
  $$('[data-roundbo]').forEach((el) => el.addEventListener('change', (e) => {
    e.stopPropagation();
    const round = +el.dataset.roundbo;
    state.bracket.roundBestOf = state.bracket.roundBestOf || {};
    state.bracket.roundBestOf[round] = +el.value;
    // a per match override would silently win over the round setting
    Object.keys(state.bracket.matchBestOf || {}).forEach((k) => {
      if (+k.slice(1).split('m')[0] === round) delete state.bracket.matchBestOf[k];
    });
    save(); render();
  }));
  $$('[data-komatch]').forEach((el) => el.addEventListener('click', () => openKoMatch(el.dataset.komatch)));

  $$('#tabs .tab').forEach((t) => { t.onclick = () => { state.tab = t.dataset.tab; save(); render(); }; });
}

/** Remove every stored result that involves a deleted player. */
function purgePlayer(id) {
  Object.keys(state.scores).forEach((k) => { if (k.split('|').includes(id)) delete state.scores[k]; });
  Object.keys(state.winners).forEach((k) => { if (k.split('|').includes(id)) delete state.winners[k]; });
  if (state.bracket) {
    const idx = state.bracket.entrants.indexOf(id);
    if (idx !== -1) {
      state.bracket.entrants[idx] = null;
      clearKoFrom(Math.floor(idx / 2));
    }
  }
}

/** Clear results of first-round match `firstRoundIndex` and everything downstream. */
function clearKoFrom(firstRoundIndex) {
  if (!state.bracket) return;
  const totalRounds = Math.log2(state.bracket.size);
  let idx = firstRoundIndex;
  for (let r = 0; r < totalRounds; r++) {
    delete state.koScores['r' + r + 'm' + idx];
    delete state.koWinners['r' + r + 'm' + idx];
    idx = Math.floor(idx / 2);
  }
}

/* ------------------------------------------------------------- score editor */

let modalCtx = null;

function openGroupMatch(id) {
  const [groupId, aId, bId] = id.split('|');
  const group = state.groups.find((g) => g.id === groupId);
  if (!group) return;
  openScoreModal({
    title: group.name,
    aName: playerName(aId),
    bName: playerName(bId),
    bestOf: state.config.groupBestOf,
    sets: getSets(state.scores, id),
    winner: state.winners[id] || null,
    onSave: (sets, winner) => {
      if (sets.length) state.scores[id] = sets; else delete state.scores[id];
      if (winner) state.winners[id] = winner; else delete state.winners[id];
    },
  });
}

function openKoMatch(key) {
  const resolved = resolveBracket();
  if (!resolved) return;
  let match = null;
  if (key === BRONZE) match = resolved.bronze;
  else resolved.rounds.forEach((r) => r.matches.forEach((m) => { if (m.key === key) match = m; }));
  if (!match || !match.playable) { toast('Both players are not decided yet.'); return; }
  openScoreModal({
    title: key === BRONZE ? 'Third place play-off' : resolved.rounds[match.round].name,
    aName: playerName(match.a),
    bName: playerName(match.b),
    bestOf: match.bestOf,
    sets: match.sets,
    winner: state.koWinners[key] || null,
    // knockout matches can each run to a different length
    onBestOfChange: (n) => {
      state.bracket.matchBestOf = state.bracket.matchBestOf || {};
      state.bracket.matchBestOf[key] = n;
      save();
    },
    onSave: (sets, winner) => {
      if (sets.length) state.koScores[key] = sets; else delete state.koScores[key];
      if (winner) state.koWinners[key] = winner; else delete state.koWinners[key];
      if (key === BRONZE) return; // nothing downstream of the play-off
      // changing a semi swaps who drops into the play-off, so that result goes too
      if (match.round === resolved.totalRounds - 2) {
        delete state.koScores[BRONZE];
        delete state.koWinners[BRONZE];
      }
      // a changed result invalidates whoever advanced from here
      let idx = Math.floor(match.index / 2);
      for (let r = match.round + 1; r < resolved.totalRounds; r++) {
        delete state.koScores['r' + r + 'm' + idx];
        delete state.koWinners['r' + r + 'm' + idx];
        idx = Math.floor(idx / 2);
      }
    },
  });
}

function openScoreModal(ctx) {
  modalCtx = Object.assign({
    draft: ctx.sets.length ? ctx.sets.slice() : [[null, null]],
    pick: ctx.winner || null,
  }, ctx);
  $('#modalBackdrop').hidden = false;
  renderModal();
}

function renderModal() {
  const c = modalCtx;
  $('#modalTitle').textContent = c.title;

  const rows = c.draft.map(([a, b], i) => `
    <div class="set-row">
      <span class="setlbl">Set ${i + 1}</span>
      <input type="number" min="0" data-set="${i}:0" value="${a == null ? '' : a}" />
      <span class="sep">:</span>
      <input type="number" min="0" data-set="${i}:1" value="${b == null ? '' : b}" />
      <button class="icon-btn" data-delset="${i}" title="Remove set">✕</button>
    </div>`).join('');

  const boPicker = c.onBestOfChange ? `
    <label class="row small muted" style="gap:6px;margin-bottom:12px">This match is
      <select id="matchBestOf">
        ${[1, 3, 5, 7].map((n) => `<option value="${n}" ${c.bestOf === n ? 'selected' : ''}>best of ${n}</option>`).join('')}
      </select>
    </label>` : `<p class="small muted" style="margin:0 0 12px">Best of ${c.bestOf}</p>`;

  $('#modalBody').innerHTML = `
    ${boPicker}
    <div class="names-head"><span>${esc(c.aName)}</span><span>${esc(c.bName)}</span></div>
    ${rows}
    <button class="btn ghost small" id="addSet" ${c.draft.length >= c.bestOf ? 'disabled' : ''}>+ Add set</button>
    <div class="winner-pick">
      <span class="small muted">Or just record the winner</span>
      <div class="row" style="gap:6px;margin-top:6px">
        <button class="btn ghost small pick" data-pick="a">${esc(c.aName)}</button>
        <button class="btn ghost small pick" data-pick="b">${esc(c.bName)}</button>
      </div>
    </div>
    <div class="tally"></div>`;

  $$('[data-set]').forEach((el) => el.addEventListener('input', () => {
    const [i, side] = el.dataset.set.split(':').map(Number);
    const v = el.value === '' ? null : Math.max(0, parseInt(el.value, 10) || 0);
    modalCtx.draft[i][side] = v;
    updateTally();
  }));
  $$('[data-delset]').forEach((el) => el.addEventListener('click', () => {
    modalCtx.draft.splice(+el.dataset.delset, 1);
    if (!modalCtx.draft.length) modalCtx.draft.push([null, null]);
    renderModal();
  }));
  $$('[data-pick]').forEach((el) => el.addEventListener('click', () => {
    modalCtx.pick = modalCtx.pick === el.dataset.pick ? null : el.dataset.pick;
    updateTally();
  }));
  const add = $('#addSet');
  if (add) add.addEventListener('click', () => { modalCtx.draft.push([null, null]); renderModal(); });
  const bo = $('#matchBestOf');
  if (bo) bo.addEventListener('change', () => {
    modalCtx.bestOf = +bo.value;
    modalCtx.onBestOfChange(modalCtx.bestOf);
    renderModal();
  });

  updateTally();
}

/** Refresh the tally in place so typing never loses input focus. */
function updateTally() {
  const c = modalCtx;
  const clean = cleanSets(c.draft);
  const r = matchResult(clean, c.bestOf, c.pick);
  const tally = $('.tally', $('#modalBody'));
  if (!tally) return;
  const invalid = clean.filter(([a, b]) => !validSet(a, b)).length;
  const who = r.winner === 'a' ? c.aName : c.bName;

  tally.innerHTML = `Sets: <b>${r.setsA} – ${r.setsB}</b> · first to ${r.need}
    ${r.decided ? ` · <b style="color:var(--accent-2)">${esc(who)} wins</b>${r.byScore ? '' : ' (winner only)'}` : ''}
    ${invalid ? `<div style="color:var(--warn);margin-top:6px">${invalid} set${invalid > 1 ? 's are' : ' is'} not a legal 11-point set — saved anyway.</div>` : ''}`;

  $$('[data-set]').forEach((el) => {
    const [i] = el.dataset.set.split(':').map(Number);
    const [a, b] = c.draft[i];
    const filled = a != null && b != null;
    el.classList.toggle('bad', filled && !validSet(a, b));
  });
  // once the scores decide it, the manual pick is redundant
  $$('[data-pick]').forEach((el) => {
    el.classList.toggle('active', !r.byScore && c.pick === el.dataset.pick);
    el.disabled = r.byScore;
  });
  const pickBox = $('.winner-pick', $('#modalBody'));
  if (pickBox) pickBox.style.opacity = r.byScore ? '.4' : '1';
}

function cleanSets(draft) {
  return draft.filter(([a, b]) => a != null && b != null && !(a === 0 && b === 0));
}

function closeModal() {
  $('#modalBackdrop').hidden = true;
  modalCtx = null;
}

$('#modalClose').addEventListener('click', closeModal);
$('#modalBackdrop').addEventListener('click', (e) => { if (e.target === $('#modalBackdrop')) closeModal(); });
$('#modalSave').addEventListener('click', () => {
  if (!modalCtx) return;
  const sets = cleanSets(modalCtx.draft);
  const decidedByScore = matchResult(sets, modalCtx.bestOf).winner !== null;
  modalCtx.onSave(sets, decidedByScore ? null : modalCtx.pick);
  closeModal(); save(); render();
});
$('#modalClear').addEventListener('click', () => {
  if (!modalCtx) return;
  modalCtx.onSave([], null);
  closeModal(); save(); render();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalCtx) closeModal();
  if (e.key === 'Enter' && modalCtx) $('#modalSave').click();
});

/* ------------------------------------------------------------ print sheets */

/**
 * Paper score sheets for the group stage, one group per page: the rotation
 * schedule with a box per set, a results grid, and an empty standings block.
 * The browser's print dialog handles "Save as PDF".
 */
function renderPrintSheets(withResults) {
  const bestOf = state.config.groupBestOf;
  const title = esc(state.title || 'Table Tennis Tournament');

  return state.groups.map((g) => {
    const ms = groupMatches(g);
    const setCols = Array.from({ length: bestOf }, (_, i) => `<th class="setc">Set ${i + 1}</th>`).join('');

    let lastRound = 0;
    let n = 0;
    const rows = ms.map((m) => {
      const r = groupResult(m.id);
      const sets = withResults ? getSets(state.scores, m.id) : [];
      const showWinner = withResults && r.decided;
      let head = '';
      if (m.round !== lastRound) {
        lastRound = m.round;
        const playing = new Set(ms.filter((x) => x.round === m.round).flatMap((x) => [x.a, x.b]));
        const resting = g.players.filter((p) => !playing.has(p.id)).map((p) => esc(p.name));
        head = `<tr class="rhead"><td colspan="${bestOf + 4}">Round ${m.round}${resting.length ? ` <span>· ${resting.join(', ')} rest${resting.length === 1 ? 's' : ''}</span>` : ''}</td></tr>`;
      }
      n++;
      const cells = Array.from({ length: bestOf }, (_, i) => {
        const set = sets[i];
        return `<td class="setc">${set ? `<b>${set[0]}</b><i>:</i><b>${set[1]}</b>` : '<span class="box"></span><i>:</i><span class="box"></span>'}</td>`;
      }).join('');
      const winner = showWinner ? esc(playerName(r.winner === 'a' ? m.a : m.b)) : '';
      return `${head}<tr>
        <td class="no">${n}</td>
        <td class="pl">${esc(playerName(m.a))}<span class="vs">vs</span>${esc(playerName(m.b))}</td>
        ${cells}
        <td class="win">${winner}</td>
        <td class="ok"><span class="tick"></span></td>
      </tr>`;
    }).join('');

    // crosstable: each cell is the row player's result against the column player
    const resultFor = (rowId, colId) => {
      if (!withResults) return '';
      const m = ms.find((x) => (x.a === rowId && x.b === colId) || (x.a === colId && x.b === rowId));
      if (!m) return '';
      const r = groupResult(m.id);
      if (!r.decided) return '';
      const rowIsA = m.a === rowId;
      const won = (r.winner === 'a') === rowIsA;
      const sets = getSets(state.scores, m.id);
      const score = sets.length ? (rowIsA ? r.setsA + '–' + r.setsB : r.setsB + '–' + r.setsA) : '';
      return `<b>${won ? 'W' : 'L'}</b> ${score}`;
    };
    const stand = withResults ? standings(g) : [];
    const statFor = (id) => stand.find((row) => row.player.id === id);
    const gridHead = g.players.map((p, i) => `<th class="gc" title="${esc(p.name)}">${i + 1}</th>`).join('');
    const gridRows = g.players.map((p, i) => {
      const st = statFor(p.id);
      const cols = g.players.map((q) => q.id === p.id
        ? '<td class="gc self"></td>'
        : `<td class="gc">${resultFor(p.id, q.id)}</td>`).join('');
      return `<tr>
        <td class="no">${i + 1}</td>
        <td class="pl">${esc(p.name)}</td>
        ${cols}
        <td class="st">${st ? st.s.wins : ''}</td>
        <td class="st">${st ? st.s.setsW + '–' + st.s.setsL : ''}</td>
        <td class="st">${st ? st.s.ptsW + '–' + st.s.ptsL : ''}</td>
        <td class="st rank">${st && allGroupsComplete() ? st.rank : ''}</td>
      </tr>`;
    }).join('');

    // big groups get tighter rows so the whole group still fits on one page
    const density = ms.length > 15 ? ' compact' : '';
    return `<section class="sheet${density}">
      <header>
        <div>
          <div class="t">${title}</div>
          <h1>${esc(g.name)} <span>· group stage · best of ${bestOf}</span></h1>
        </div>
        <div class="meta">
          <div>Date <span class="line"></span></div>
          <div>Table <span class="line short"></span></div>
        </div>
      </header>

      <h2>Matches <span>— ${ms.length} in total, rotated so nobody plays twice in a row</span></h2>
      <table class="sched">
        <thead><tr><th class="no">#</th><th class="pl">Players</th>${setCols}<th class="win">Winner</th><th class="ok">✓</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>

      <h2>Results grid <span>— row player's result vs. column player</span></h2>
      <table class="xtab">
        <thead><tr><th class="no">#</th><th class="pl">Player</th>${gridHead}<th class="st">Wins</th><th class="st">Sets</th><th class="st">Points</th><th class="st">Rank</th></tr></thead>
        <tbody>${gridRows}</tbody>
      </table>

      <p class="rules">Ranking: most wins. Level on wins → head-to-head between those players, then sets won, then points won. A set is first to 11, win by 2.</p>
    </section>`;
  }).join('');
}

function printGroupSheets(withResults) {
  if (!state.groups.some((g) => g.players.length >= 2)) {
    toast('Add players to a group first.');
    return;
  }
  $('#printArea').innerHTML = renderPrintSheets(withResults);
  window.print();
}

/* ------------------------------------------------------- import / export /reset */

$('#exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (state.title || 'tournament').replace(/\s+/g, '-').toLowerCase() + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
});
$('#importBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      state = Object.assign(defaultState(), JSON.parse(reader.result));
      save(); render(); toast('Tournament loaded');
    } catch (err) {
      toast('Could not read that file');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});
$('#resetBtn').addEventListener('click', () => {
  if (!confirm('Reset everything and start a new tournament?')) return;
  state = defaultState();
  save(); render();
});

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

render();
