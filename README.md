# Six Degrees of Justin Timberlake

A film trivia game. You start from an actor, athlete or filmmaker, pick a film they were in, pick a co-star from that film, and keep going until you land on Justin Timberlake. Par is the shortest possible chain.

- **Daily challenge:** everyone gets the same start each day, with a shareable result:
  ```
  Six Degrees of JT #1
  Cristiano Ronaldo → Justin Timberlake
  🟩🟩🟩 3 films (par 3)
  ```
  🟩 a move that got closer to JT, 🟨 no closer, 🟥 further away, 💡 a move made with a hint.
- **Free play:** search for any of ~28k well-known people, by name or nickname ("CR7", "SRK", "JT"), or hit Shuffle.
- **Hint** highlights the next film (and co-star) on a shortest path. **Show me the way** finishes the chain for you.
- **Hard mode:** JT's five best-known films are banned and there are no hints. Banning hubs barely raises par (the graph nearly always has another route of the same length), so hard mode is about losing the obvious routes.
- **Type a co-star:** from the films list, type someone's name and the game finds the film you share.
- **Keyboard play** on desktop: type to filter, ↑/↓ and Enter to pick, Esc to go back or undo, Alt+H for a hint.
- **Share image** as a square or a 9:16 story (spoiler-free, or with your path), and a **share video**: a short MP4 of your countdown building up, for TikTok, Reels and stories.
- **Link previews:** shared daily links unfurl in chat apps with the day's sticker, and challenge links with the sender's score ("Sid got to JT in 3 films. Can you beat that?").
- **Beat my score:** a challenge link carries your result; your friend sees your grades while playing and your films once they finish.
- **Everyone today:** after a daily, where you stand among everyone who played it ("Beat 72% of players"), the par rate, the most popular opening film and whether anyone else took your route.
- **Groups:** a leaderboard for a group chat. Start one, share the link, and members see each other's daily results and a weekly points table.
- **Your charts** (streaks, par rate, score distribution) and **past dailies**, saved in the browser.
- **On phones** the search panel sits at the bottom of the screen, above the keyboard, moves get a haptic tap (Android; iPhones get a tick on each pick), and the home page's dot grid bulges under your finger.

Cristiano Ronaldo is 3 films away: *Goal III* → David Beckham → *The Man from U.N.C.L.E.* → Armie Hammer → *The Social Network* → JT.

## How it works

**Data.** Film and cast credits come from [Wikidata](https://www.wikidata.org/) (CC0), queried through the [QLever](https://qlever.dev/) SPARQL endpoint. That covers about 190k feature films and TV films and 210k people. Cast credits (P161) and voice credits (P725) both count, so *Trolls* links JT to its voice cast. Short films, music videos, TV specials and sketches are left out.

**Cleanup.**
- Wikidata now stores names shared across languages under the `mul` language and drops the duplicate English label, so many famous people (Cristiano Ronaldo included) have no `en` label. Names fall back from `en` to `mul` to any language.
- Archive footage is listed as ordinary cast and rarely marked, so JFK "appears" in *Hidden Figures*. A credit for a film released more than a year after the person died is dropped.
- Films with more than 150 credited people are dropped as hubs.

**Graph.** `scripts/build_graph.py` runs one breadth-first search from JT over the person–film graph. Every reachable person gets a Timberlake number and a parent pointer along a shortest path. When several paths tie, it prefers the one whose least-known film is best known (by Wikipedia sitelinks), so revealed answers use films people recognise. The build fails if Ronaldo isn't connected or any parent pointer isn't a real shared credit one step closer.

**Daily pool.** The daily start is someone famous (40+ Wikipedia sitelinks) who is at least 2 films from JT. Their best-known film must have a release year and 15+ sitelinks, and so must every film on the shortest path (10+). Fame alone isn't enough: it let in Czech president Petr Pavel, whose every link to JT runs through obscure Czech films. About 3,500 people qualify. The day's pick uses rendezvous hashing, so a data rebuild that adds or drops other people doesn't change it.

**Hard mode** gets its own BFS with the five banned films removed; each person carries both distances and parent pointers.

**Static files.** The output is sharded by `qid % 4096` into `p/*.json` (people: name, fame, distance and parent pointer for both modes, films) and `f/*.json` (films: title, year, fame, cast), plus `search.json` (names, nicknames, best-known film), `search-top.json` (its 2,000 best-known rows, which answer the name search while the full list downloads) and `meta.json`. Titles and names are inlined, so a move loads one small file (about 8 KB gzipped), and the co-star search, which fetches every film a person was in, stays small too. An inline script in `index.html` (written by the `preload-data` plugin in `vite.config.ts`) starts downloading `meta.json` and the first person's shard alongside the bundle rather than after it. Everything goes under `public/data/v/<content hash>/`, and the hash is compiled into the bundle, so a page never mixes a new bundle with old cached data; if the data it needs is gone after a redeploy, the game asks you to reload. The game itself needs no server.

**Link previews.** After `vite build`, `scripts/previews.ts` draws a 1200×630 image per daily with the same canvas code as the in-game share image (`src/card.ts`, run in Node via `@napi-rs/canvas` with the TTFs in `assets/fonts/`) and writes `d/<date>/` pages: the game's own page with that day's Open Graph tags, which switches the address to `#/daily/<date>` and starts the game in place, with no second page load. It covers the last 90 days through 45 days ahead; `404.html` sends older day links to the game.

**Global stats and groups** are the only part with a server: a Supabase database (`supabase/schema.sql`). There are no accounts; a player is a random id kept in the browser, which no function ever returns. The tables live in their own `sixdegrees` schema, which the Data API doesn't expose, and the site reaches them only through a few `public.sixdegrees_*` functions, so the database can share a Supabase project with another app. Without the Supabase settings at build time (local dev, forks) these features are hidden.

**Challenge previews.** A challenge link is a daily's page plus `?vs=<code>`, and GitHub Pages serves the same page whatever the query. A small Cloudflare Worker (`worker/`) in front of `/d/*` rewrites the page's title tags with the sender's score when the code is valid, and passes everything else through untouched.

## Develop

```bash
npm install
npm run data   # download from Wikidata (~1 min) and build public/data/
npm run dev    # http://localhost:5174
npm test
npm run build && npm run preview   # production build with link previews, http://localhost:4173
```

`npm run data` caches the raw downloads in `data/raw/`. Delete them, or run `python3 scripts/fetch_wikidata.py --refresh`, to download again. Both `data/raw/` and `public/data/` are generated and git-ignored.

## Deploy

`.github/workflows/pages.yml` rebuilds the data, tests, builds and publishes to GitHub Pages on every push to `main` and once a month. It sets `SITE_URL` so preview tags carry absolute URLs.

**Global stats and groups.** Run `supabase/schema.sql` in the Supabase project (it's safe to run again after changes), then give the build the project's URL and publishable key as repository variables, `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Both are public: they ship in the bundle.

**Challenge previews.** Deploy the Worker with `npx wrangler@4.136.3 deploy --config worker/wrangler.toml` (the version it was tested with). It adds a route for `sixdegrees.sidharthjoly.com/d/*` on the `sidharthjoly.com` zone, which needs the domain proxied through Cloudflare.

---

A fan project, not affiliated with Justin Timberlake. Data: Wikidata contributors, CC0.
