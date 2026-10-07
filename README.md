# Six Degrees of Justin Timberlake

A film trivia game. You start from an actor, athlete or filmmaker, pick a film they were in, pick a co-star from that film, and keep going until you land on Justin Timberlake. Par is the shortest possible chain.

- **Daily challenge:** everyone gets the same start each day, with a shareable result:
  ```
  Six Degrees of JT #1
  Cristiano Ronaldo → Justin Timberlake
  🟩🟩🟩 3 films (par 3)
  ```
  🟩 a move that got closer to JT, 🟨 no closer, 🟥 further away, 💡 a move made with a hint.
- **Free play:** search for any of ~28k well-known people, or hit Random.
- **Hint** highlights the next film (and co-star) on a shortest path. **Show me the way** finishes the chain for you.

Cristiano Ronaldo is 3 films away: *Goal III* → David Beckham → *The Man from U.N.C.L.E.* → Armie Hammer → *The Social Network* → JT.

## How it works

**Data.** Film and cast credits come from [Wikidata](https://www.wikidata.org/) (CC0), queried through the [QLever](https://qlever.dev/) SPARQL endpoint. That covers about 190k feature films and TV films and 210k people. Cast credits (P161) and voice credits (P725) both count, so *Trolls* links JT to its voice cast. Short films, music videos, TV specials and sketches are left out.

**Cleanup.**
- Wikidata now stores names shared across languages under the `mul` language and drops the duplicate English label, so many famous people (Cristiano Ronaldo included) have no `en` label. Names fall back from `en` to `mul` to any language.
- Archive footage is listed as ordinary cast and rarely marked, so JFK "appears" in *Hidden Figures*. A credit for a film released more than a year after the person died is dropped.
- Films with more than 150 credited people are dropped as hubs.

**Graph.** `scripts/build_graph.py` runs one breadth-first search from JT over the person–film graph. Every reachable person gets a Timberlake number and a parent pointer along a shortest path. When several paths tie, it prefers the one whose least-known film is best known (by Wikipedia sitelinks), so revealed answers use films people recognise. The build fails if Ronaldo isn't connected or any parent pointer isn't a real shared credit one step closer.

**Daily pool.** The daily start is someone famous (40+ Wikipedia sitelinks) who is at least 2 films from JT. Their best-known film must have a release year and 15+ sitelinks, and so must every film on the shortest path (10+). Fame alone isn't enough: it let in Czech president Petr Pavel, whose every link to JT runs through obscure Czech films. About 3,500 people qualify. The day's pick uses rendezvous hashing, so a data rebuild that adds or drops other people doesn't change it.

**Static files.** The output is sharded by `qid % 512` into `public/data/p/*.json` (people: name, distance, parent pointer, films) and `public/data/f/*.json` (films: title, year, cast). Titles and names are inlined, so a move loads two small files (about 50 KB gzipped each). There's no server and no API key.

## Develop

```bash
npm install
npm run data   # download from Wikidata (~1 min) and build public/data/
npm run dev    # http://localhost:5174
npm test
```

`npm run data` caches the raw downloads in `data/raw/`. Delete them, or run `python3 scripts/fetch_wikidata.py --refresh`, to download again. Both `data/raw/` and `public/data/` are generated and git-ignored.

## Deploy

`.github/workflows/pages.yml` rebuilds the data, tests, builds and publishes to GitHub Pages on every push to `main` and once a month.

---

A fan project, not affiliated with Justin Timberlake. Data: Wikidata contributors, CC0.
