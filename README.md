# Table Tennis Tournament

Interactive tournament manager: two (or more) round robin groups, then an automatically
seeded single elimination knockout stage. No dependencies, no build step — plain HTML/CSS/JS
served by a tiny node server. All data lives in the browser's `localStorage`.

**Live: <https://yassersouri.github.io/ttt/>**

Everything is stored locally in your own browser — there is no server and no account, so
results stay on the machine you enter them on. Use *Export* to move a tournament elsewhere.

## Run locally

```bash
npm start          # or: node server.js
# open http://localhost:3200   (PORT=xxxx to change)
```

`server.js` is only a convenience for local development; the app itself is fully static,
which is how it is published to GitHub Pages straight from `public/`.

## How it works

**Setup tab** — name the tournament, edit groups and player names, add/remove players and
groups, and choose the format:

| Option | Default | Meaning |
| --- | --- | --- |
| Who reaches the knockout | **All players** | everyone goes through, seeded by group finish; or top 1–4 per group |
| Group stage matches | **Best of 1** | best of 1 / 3 / 5 / 7 |
| Knockout matches | **Best of 3** | default length; semi-finals and the final start at best of 5 |

**Group stage tab** — every pairing in a group is generated automatically and laid out as a
proper round robin **schedule** rather than a flat list. The pairings come from the circle
method, so:

* each player plays at most once per rotation round, and with an odd group size the player
  drawing the bye is shown as resting that round
* matches are then ordered across round boundaries so nobody plays two matches back to back
  (unavoidable only in groups of 3 or 4, where any two matches must share a player)
* every pair still meets exactly once, over `n-1` rounds (or `n` rounds when `n` is odd)

Click a match to enter set scores (add as many sets as the match needs). Standings update
live:

* ordered by matches won
* players level on wins are split by the head-to-head result between exactly those
  players, then by **sets won** and then by **points won** (shown as `±` difference
  columns). With best-of-1 groups every set is 1–0, so the point difference is what
  actually separates players — enter the real scores if you want it to mean something
* a `≈` marker appears when players are level on every criterion, so you know to adjust
  the seeding by hand
* qualifying places are highlighted in green

Scores are checked against real table tennis rules (first to 11, win by 2). An illegal set is
flagged but still saved, so odd house rules are not blocked.

**Knockout tab** — press *Generate bracket* (or *Build knockout bracket* at the bottom of the
group stage). Qualifiers are seeded so that group winners land in opposite halves and nobody
meets a player from their own group in the first round. If the number of qualifiers is not a
power of two, byes are added for the top seeds automatically.

* click any match to enter sets; the winner advances as soon as they take the majority
* **you can also just record the winner** — the modal has a button for each player when
  you don't care about the scores
* match length is adjustable at three levels: the stage default, a `Bo` dropdown on each
  round header, and a per-match selector inside the match itself, so a single semi-final
  can be best of 5 while the rest of the round stays best of 3
* changing or clearing an earlier result clears the rounds that depended on it
* *Adjust seeding* lets you swap players between first round slots by hand
* *Regenerate from standings* rebuilds the bracket from the current group results
* a **third place play-off** between the two beaten semi-finalists is added automatically
  (toggle *3rd place match* to turn it off); it hangs below the final, fed by dashed lines
  from each semi, and re-opens if a semi-final result later changes
* the **final standings** panel fills in 1st, 2nd and 3rd as they become known — gold from
  the final's winner, silver from its loser, bronze from the play-off

The bracket is laid out so every match sits exactly halfway between the two matches that
feed it, and **connector lines join each match to the one its winner moves on to** — a line
turns green once that winner is known. Inside a match the two sides of the table are split
by a `vs` divider, the winner is highlighted, and the beaten player is struck through.

### Odd numbers of players

Any field size works. The qualifiers are seeded strongest first, the bracket grows to the
next power of two, and the spare slots become byes for the top seeds — so **13 players**
produce a 16-player bracket where seeds 1, 2 and 3 skip the round of 16 and enter at the
quarter-finals.

Everything is saved to `localStorage` as you go, so refreshing or closing the tab keeps
the tournament exactly where it was.

**Export / Import** writes the whole tournament to a JSON file so it can be backed up or moved
to another machine. **Reset** starts over.
