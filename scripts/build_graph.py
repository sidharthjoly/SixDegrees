"""Turn the raw Wikidata TSVs into the static data the game loads.

Runs one breadth-first search from Justin Timberlake over the film/cast graph, so
every reachable person gets a Timberlake number and a parent pointer on a shortest
path back to him. Among equally short paths it prefers the one whose least-known
film is best known (Wikipedia sitelinks), so revealed answers use recognisable films.

A second BFS does the same for hard mode, where JT's best-known films are banned.

Output goes to public/data/v/<version>/, where <version> is a hash of the contents, and
public/data/version.json names it. Vite compiles that version into the bundle, so a
page never mixes a new bundle with cached data files from an older build (or vice
versa), and an unchanged rebuild keeps the same URLs.

  meta.json        build stats, distance histograms, daily-challenge pool, hard-mode bans,
                   JT's Bacon number
  search.json      [qid, name, sitelinks, dist, best-known film, hardDist, aliases?]
                   for people with enough sitelinks to be worth autocompleting
  search-top.json  the first SEARCH_TOP rows of search.json (the best known), which
                   the name search answers from while the full list downloads
  p/NN.json        qid -> [name, sitelinks, dist, parentFilm, parentPerson,
                           [[film, title, year, sitelinks]...],
                           hardDist, hardParentFilm, hardParentPerson]
  f/NN.json        qid -> [title, year, sitelinks, [[person, name, sitelinks]...]]

Shard NN is qid % SHARDS, so the client fetches one small file per lookup. Film titles
and cast names are inlined (best known first) so a list renders from a single shard.
4096 shards keep each file to about 8 KB gzipped: one move costs one small download, and
the co-star search, which fetches every film a person was in, doesn't pull megabytes.
hardDist is -1 for someone hard mode can't reach (their only links are banned films).
"""

import collections
import hashlib
import json
import re
import shutil
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "public" / "data"

JT = 43432
RONALDO = 11571
# The original six-degrees star. His distance to JT (JT's Bacon number) goes on the home page.
KEVIN_BACON = 3454165
SHARDS = 4096
# Rows of search-top.json: enough for nearly every name people type first.
SEARCH_TOP = 2000
# Films with casts this large are mostly crowd-scene credit dumps; they turn into
# hubs that make every link trivial. 150 drops ~0.1% of films.
MAX_CAST = 150
SEARCH_MIN_SITELINKS = 15
# The daily start must be famous AND reachable through films people know. Fame alone let
# in Petr Pavel, the Czech president, whose every link to JT is an obscure Czech film.
DAILY_MIN_SITELINKS = 40
DAILY_MIN_DIST = 2
DAILY_TOP_FILM_SITELINKS = 15  # their best-known film; it's shown as "Known for" on the home page
DAILY_PATH_FILM_SITELINKS = 10  # every film on the shortest path shown as the answer

# Hard mode bans JT's five best-known films. Banning one hub barely changes par (the
# graph almost always has another route of the same length), so hard mode is about
# losing the obvious routes rather than a higher par. The list is pinned, not
# recomputed, so a monthly data refresh can't quietly change what hard mode means.
HARD_BANNED = [
    185888,  # The Social Network
    486588,  # Shrek the Third
    628082,  # In Time
    629596,  # Friends with Benefits
    798797,  # Bad Teacher
]

MAX_ALIASES = 3
MAX_ALIAS_LENGTH = 24  # nicknames, not full legal names nobody searches for

LITERAL = re.compile(r'^"(.*)"(?:@[\w-]+|\^\^<[^>]*>)?$', re.S)


def qid(cell: str) -> int:
    return int(cell[cell.rfind("Q") + 1 : -1])


def literal(cell: str) -> str:
    m = LITERAL.match(cell)
    return m.group(1) if m else cell


def read_tsv(name: str):
    with open(RAW / f"{name}.tsv", encoding="utf-8") as fh:
        next(fh)
        for line in fh:
            yield line.rstrip("\n").split("\t")


def label(cells: list[str]) -> str | None:
    for cell in cells:
        if cell:
            return literal(cell)
    return None


def load():
    films: dict[int, tuple[str, int | None, int]] = {}
    for c in read_tsv("films"):
        name = label(c[1:4])
        if name:
            films[qid(c[0])] = (name, int(literal(c[4])) if c[4] else None, int(literal(c[5])) if c[5] else 0)

    people: dict[int, tuple[str, int]] = {}
    died: dict[int, int] = {}
    for c in read_tsv("people"):
        name = label(c[1:4])
        if name:
            people[qid(c[0])] = (name, int(literal(c[4])) if c[4] else 0)
            if c[5]:
                died[qid(c[0])] = int(literal(c[5]))

    cast: dict[int, list[int]] = collections.defaultdict(list)
    archive = 0
    for f, p in read_tsv("edges"):
        f, p = qid(f), qid(p)
        if f not in films or p not in people:
            continue
        # Wikidata lists archive footage as ordinary cast (JFK "appears" in Hidden
        # Figures), and rarely marks it. A film released more than a year after
        # someone died can only be using old footage, so it doesn't link them.
        year = films[f][1]
        if year and p in died and year > died[p] + 1:
            archive += 1
            continue
        cast[f].append(p)
    print(f"dropped {archive:,} posthumous (archive footage) credits")

    cast = {f: ps for f, ps in cast.items() if len(ps) <= MAX_CAST}
    credits: dict[int, list[int]] = collections.defaultdict(list)
    for f, ps in cast.items():
        for p in ps:
            credits[p].append(f)
    return films, people, cast, credits


def without(banned, cast):
    """The cast/credits graph with some films removed."""
    cast = {f: ps for f, ps in cast.items() if f not in banned}
    credits: dict[int, list[int]] = collections.defaultdict(list)
    for f, ps in cast.items():
        for p in ps:
            credits[p].append(f)
    return cast, credits


def load_aliases(people, wanted) -> dict[int, list[str]]:
    """Up to MAX_ALIASES alternative names per person, shortest (most nickname-like) first."""
    found: dict[int, dict[str, str]] = collections.defaultdict(dict)
    for c in read_tsv("aliases"):
        p = qid(c[0])
        if p not in wanted:
            continue
        alias = literal(c[1]).strip()
        key = alias.casefold()
        if not 2 <= len(alias) <= MAX_ALIAS_LENGTH or key == people[p][0].casefold():
            continue
        found[p].setdefault(key, alias)
    return {p: sorted(names.values(), key=lambda a: (len(a), a))[:MAX_ALIASES] for p, names in found.items()}


def bfs(films, people, cast, credits):
    """Layered BFS from JT. best[p] = (weakest film sitelinks, total sitelinks) of p's chosen path."""
    dist = {JT: 0}
    parent: dict[int, tuple[int, int]] = {}
    best = {JT: (10**9, 0)}
    layer = [JT]
    while layer:
        candidates: dict[int, tuple[tuple[int, int], int, int]] = {}
        for q in layer:
            for f in credits[q]:
                fsl = films[f][2]
                score = (min(best[q][0], fsl), best[q][1] + fsl + people[q][1])
                for p in cast[f]:
                    if p in dist:
                        continue
                    cur = candidates.get(p)
                    if cur is None or score > cur[0]:
                        candidates[p] = (score, f, q)
        d = dist[layer[0]] + 1
        for p, (score, f, q) in candidates.items():
            dist[p] = d
            parent[p] = (f, q)
            best[p] = score
        layer = sorted(candidates)
    return dist, parent


def verify(dist, parent, cast, credits) -> None:
    """Every parent pointer must be a real shared credit one step closer to JT."""
    for p, (f, q) in parent.items():
        if f not in credits[p] or q not in cast[f] or dist[q] != dist[p] - 1:
            sys.exit(f"FAIL: bad parent pointer Q{p} -> Q{f} -> Q{q}")
    if len(parent) != len(dist) - 1:
        sys.exit("FAIL: someone besides JT has no parent pointer")


def daily_pool(dist, parent, hard_dist, films, people, credits) -> list[int]:
    """Famous people whose best-known film and whole answer path are recognisable, dated
    films, and who can still reach JT in hard mode."""

    def known(f, min_sitelinks):
        return films[f][1] is not None and films[f][2] >= min_sitelinks

    pool = []
    for p, d in dist.items():
        if d < DAILY_MIN_DIST or people[p][1] < DAILY_MIN_SITELINKS or p not in hard_dist:
            continue
        top = max(credits[p], key=lambda f: (films[f][2], -f))
        if not known(top, DAILY_TOP_FILM_SITELINKS):
            continue
        if all(known(f, DAILY_PATH_FILM_SITELINKS) for _, f in path_to_jt(p, parent)):
            pool.append(p)
    return sorted(pool)


def path_to_jt(p, parent):
    steps = []
    while p != JT:
        f, q = parent[p]
        steps.append((p, f))
        p = q
    return steps


def content_version(root: Path) -> str:
    """Short hash of every file under root, so identical data gets identical URLs."""
    h = hashlib.sha256()
    for path in sorted(root.rglob("*.json")):
        h.update(path.relative_to(root).as_posix().encode())
        h.update(path.read_bytes())
    return h.hexdigest()[:12]


def write_json(path: Path, obj) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    path.write_text(data, encoding="utf-8")
    return len(data.encode())


def main() -> None:
    films, people, cast, credits = load()
    dist, parent = bfs(films, people, cast, credits)
    verify(dist, parent, cast, credits)

    for f in HARD_BANNED:
        if JT not in cast.get(f, []):
            sys.exit(f"FAIL: hard-mode ban Q{f} is not a JT film any more")
    top5 = sorted(credits[JT], key=lambda f: (-films[f][2], f))[:len(HARD_BANNED)]
    if set(top5) != set(HARD_BANNED):
        print("note: JT's best-known films are now", [films[f][0] for f in top5], "(hard mode bans stay pinned)")
    hard_cast, hard_credits = without(set(HARD_BANNED), cast)
    hard_dist, hard_parent = bfs(films, people, hard_cast, hard_credits)
    verify(hard_dist, hard_parent, hard_cast, hard_credits)
    hard_hist = collections.Counter(hard_dist.values())
    print(f"hard mode: {len(dist) - len(hard_dist):,} people unreachable, "
          f"{sum(1 for p in hard_dist if hard_dist[p] > dist[p]):,} have a higher par")

    if RONALDO not in dist:
        sys.exit("FAIL: Cristiano Ronaldo is not connected to Justin Timberlake")
    hist = collections.Counter(dist.values())
    print(f"reachable people: {len(dist):,} of {len(credits):,}")
    print("distance histogram:", dict(sorted(hist.items())))
    print(f"Ronaldo -> JT ({dist[RONALDO]}):")
    for p, f in path_to_jt(RONALDO, parent):
        print(f"  {people[p][0]}  --[{films[f][0]} ({films[f][1]})]-->")
    print("  Justin Timberlake")

    # Only the component containing JT is playable.
    live_films = {f for p in dist for f in credits[p]}

    def by_fame(ids, table, idx):
        return sorted(ids, key=lambda i: (-table[i][idx], i))

    # Start clean so stale versions and shard layouts can't linger.
    shutil.rmtree(OUT, ignore_errors=True)
    stage = OUT / "staging"
    pshards: list[dict] = [{} for _ in range(SHARDS)]
    for p, d in dist.items():
        name, sl = people[p]
        pf, pp = parent.get(p, (0, 0))
        hpf, hpp = hard_parent.get(p, (0, 0))
        refs = [[f, films[f][0], films[f][1], films[f][2]] for f in by_fame(credits[p], films, 2)]
        pshards[p % SHARDS][p] = [name, sl, d, pf, pp, refs, hard_dist.get(p, -1), hpf, hpp]

    fshards: list[dict] = [{} for _ in range(SHARDS)]
    for f in live_films:
        title, year, sl = films[f]
        refs = [[p, people[p][0], people[p][1]] for p in by_fame(cast[f], people, 1)]
        fshards[f % SHARDS][f] = [title, year, sl, refs]

    for kind, shards in (("p", pshards), ("f", fshards)):
        sizes = [write_json(stage / kind / f"{i}.json", s) for i, s in enumerate(shards)]
        print(f"{kind}/: {len(sizes)} shards, {sum(sizes) / 1e6:.1f} MB raw, max {max(sizes) / 1e3:.0f} KB")

    # Autocomplete index: [qid, name, sitelinks, dist, best-known film title, hardDist, aliases?]
    in_search = {p for p in dist if people[p][1] >= SEARCH_MIN_SITELINKS or p in (JT, RONALDO)}
    aliases = load_aliases(people, in_search)
    search = []
    for p in in_search:
        name, sl = people[p]
        top = by_fame(credits[p], films, 2)[0]
        row = [p, name, sl, dist[p], films[top][0], hard_dist.get(p, -1)]
        if aliases.get(p):
            row.append(aliases[p])
        search.append(row)
    search.sort(key=lambda r: (-r[2], r[0]))
    size = write_json(stage / "search.json", search)
    print(f"search.json: {len(search):,} people ({len(aliases):,} with aliases), {size / 1e6:.2f} MB raw")
    size = write_json(stage / "search-top.json", search[:SEARCH_TOP])
    print(f"search-top.json: {min(len(search), SEARCH_TOP):,} people, {size / 1e3:.0f} KB raw")
    for p in (RONALDO, JT):
        print(f"  aliases for {people[p][0]}: {aliases.get(p)}")

    daily = daily_pool(dist, parent, hard_dist, films, people, credits)
    if RONALDO not in daily:
        print("warning: Cristiano Ronaldo is no longer in the daily pool")
    write_json(
        stage / "meta.json",
        {
            "built": date.today().isoformat(),
            "people": len(dist),
            "films": len(live_films),
            "histogram": {str(k): v for k, v in sorted(hist.items())},
            "hardHistogram": {str(k): v for k, v in sorted(hard_hist.items())},
            "hardBanned": [{"id": f, "title": films[f][0], "year": films[f][1]} for f in HARD_BANNED],
            "daily": daily,
            "jt": JT,
            "bacon": dist.get(KEVIN_BACON),
            "shards": SHARDS,
        },
    )
    by_par = collections.Counter(dist[p] for p in daily)
    print(f"daily pool: {len(daily):,} people, by par {dict(sorted(by_par.items()))}")

    version = content_version(stage)
    (OUT / "v").mkdir(parents=True)
    stage.rename(OUT / "v" / version)
    write_json(OUT / "version.json", {"version": version})
    print(f"data version {version} -> public/data/v/{version}/")


if __name__ == "__main__":
    main()
