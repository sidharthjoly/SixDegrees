"""Turn the raw Wikidata TSVs into the static data the game loads.

Runs one breadth-first search from Justin Timberlake over the film/cast graph, so
every reachable person gets a Timberlake number and a parent pointer on a shortest
path back to him. Among equally short paths it prefers the one whose least-known
film is best known (Wikipedia sitelinks), so revealed answers use recognisable films.

A second BFS does the same for hard mode, where JT's best-known films are banned.
One more per star in TARGETS and BOLLYWOOD_TARGETS gives free play, the star daily and
Bollywood mode their other goals (normal mode only), and one more from Shah Rukh Khan without
his best-known films gives Bollywood mode its hard mode.

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
  t/<star>/NN.json qid -> [dist, parentFilm, parentPerson]: the same as a person row's
                   first steps, but towards one of the TARGETS or BOLLYWOOD_TARGETS.
                   NN is qid % TARGET_SHARDS. t/<SRK>-hard/ is the same without the films
                   Bollywood hard mode bans.
  bollywood.json   Bollywood mode's daily: the Bollywood stars it can start from, heading for
                   Shah Rukh Khan; the films its hard mode bans; and the best-known Bollywood
                   names, for suggestions

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

# The other stars free play and the star daily can head for, with the first day the star
# daily may pick each one. The star daily is picked by rendezvous hashing over this list, so a
# star added without a date would take over some days already played (shared, on group
# boards, in challenge links): give every new star a date a few days after it ships. Pinned
# like the hard-mode bans; a star who drops out of JT's part of the graph is skipped with a
# warning.
TARGETS = [
    (3454165, None),  # Kevin Bacon
    (2263, None),  # Tom Hanks
    (172678, None),  # Samuel L. Jackson
    (873, None),  # Meryl Streep
    (34436, None),  # Scarlett Johansson
    (38111, None),  # Leonardo DiCaprio
    (37079, None),  # Tom Cruise
    (40096, None),  # Will Smith
    (36949, None),  # Robert De Niro
    (189489, None),  # Zendaya
    (35332, "2026-10-14"),  # Brad Pitt
    (1924847, "2026-10-14"),  # Margot Robbie
    (43416, "2026-10-14"),  # Keanu Reeves
    (42101, "2026-10-14"),  # Denzel Washington
    (37459, "2026-10-14"),  # Nicole Kidman
    (189490, "2026-10-14"),  # Jennifer Lawrence
    (81328, "2026-10-14"),  # Harrison Ford
    (48337, "2026-10-14"),  # Morgan Freeman
    (36970, "2026-10-14"),  # Jackie Chan
    (147077, "2026-10-14"),  # Emma Stone
]
# The stars the star daily launched with, the only ones allowed no date.
LAUNCH_TARGETS = {3454165, 2263, 172678, 873, 34436, 38111, 37079, 40096, 36949, 189489}

# Bollywood mode is Six Degrees of Shah Rukh Khan: its daily heads for him, as the main one
# does for JT, and its hard mode bans his five best-known films, pinned like JT's.
SRK = 9535
SRK_HARD_BANNED = [
    466443,  # Kabhi Khushi Kabhie Gham
    623336,  # Kuch Kuch Hota Hai
    247854,  # Devdas
    849343,  # Dilwale Dulhania Le Jayenge
    330663,  # My Name Is Khan
]
# Bollywood mode's stars: what free play heads for there, Shah Rukh Khan first, then twenty
# others, as many as JT's page has. They're free play's only, so unlike TARGETS they need no
# first day.
BOLLYWOOD_TARGETS = [
    9535,  # Shah Rukh Khan
    9570,  # Amitabh Bachchan
    47059,  # Aishwarya Rai
    158957,  # Priyanka Chopra
    9543,  # Salman Khan
    9557,  # Aamir Khan
    4725343,  # Alia Bhatt
    159178,  # Deepika Padukone
    233619,  # Hrithik Roshan
    184885,  # Kareena Kapoor
    147395,  # Kajol
    232451,  # Madhuri Dixit
    270691,  # Sridevi
    485557,  # Rani Mukerji
    9550,  # Katrina Kaif
    233748,  # Akshay Kumar
    146929,  # Ajay Devgn
    1063412,  # Ranbir Kapoor
    902879,  # Ranveer Singh
    360927,  # Irrfan Khan
    55407,  # Raj Kapoor
]
# Bollywood's own stars, the Bollywood daily's starts: famous, with most of their films in
# Hindi (or Urdu). Their best-known films and the answer path must be recognisable, as for
# the JT daily. Bollywood is close-knit (about a third of its stars share a film with Shah
# Rukh Khan), so the starts are only the ones at least two films away: every one is par 2.
# The bar is lower than the JT daily's so there are more of them, and the daily comes round
# to the same start less often.
BOLLYWOOD_MIN_SITELINKS = 20
BOLLYWOOD_MIN_HINDI_FILMS = 5
BOLLYWOOD_MIN_HINDI_SHARE = 0.5
# Fewer starts than this and the build fails: the films check is cutting too hard.
BOLLYWOOD_MIN_STARTS = 30
# How many of the best-known Bollywood names go to the home page's suggestions.
BOLLYWOOD_PICKS = 60
# " (2001 film)", " (1951 Hindi film)": the disambiguation on Wikipedia article titles.
FILM_SUFFIX = re.compile(r" \([^()]*\bfilm\)$")
# Fewer, bigger shards than p/: a row here is three numbers, so one move still costs a
# download of about 3 KB gzipped, without ten more sets of 4096 files.
TARGET_SHARDS = 1024

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


def bfs(films, people, cast, credits, source=JT):
    """Layered BFS from source (JT unless given). best[p] = (weakest film sitelinks, total
    sitelinks) of p's chosen path."""
    dist = {source: 0}
    parent: dict[int, tuple[int, int]] = {}
    best = {source: (10**9, 0)}
    layer = [source]
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


def verify(dist, parent, cast, credits, source=JT) -> None:
    """Every parent pointer must be a real shared credit one step closer to source."""
    for p, (f, q) in parent.items():
        if f not in credits[p] or q not in cast[f] or dist[q] != dist[p] - 1:
            sys.exit(f"FAIL: bad parent pointer Q{p} -> Q{f} -> Q{q}")
    if len(parent) != len(dist) - 1 or source in parent:
        sys.exit(f"FAIL: someone besides Q{source} has no parent pointer")


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


def path_to_jt(p, parent, source=JT):
    """The (person, film) steps from p to source (JT unless given) along parent pointers."""
    steps = []
    while p != source:
        f, q = parent[p]
        steps.append((p, f))
        p = q
    return steps


def load_hindi(films) -> set[int]:
    """Bollywood's films (in Hindi, Urdu or Hindustani), renamed after their English
    Wikipedia article, the name fans know them by, where there is one."""
    hindi = set()
    for c in read_tsv("hindi"):
        f = qid(c[0])
        if f not in films:
            continue
        hindi.add(f)
        if len(c) > 1 and c[1]:
            title = FILM_SUFFIX.sub("", literal(c[1])).strip()
            if title:
                films[f] = (title, films[f][1], films[f][2])
    return hindi


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
    hindi = load_hindi(films)
    print(f"Bollywood: {len(hindi):,} films in Hindi, Urdu or Hindustani")
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

    if SRK not in dist:
        sys.exit("FAIL: Shah Rukh Khan is not connected to Justin Timberlake")
    for f in SRK_HARD_BANNED:
        if SRK not in cast.get(f, []):
            sys.exit(f"FAIL: Bollywood hard-mode ban Q{f} is not a Shah Rukh Khan film any more")
    top5 = sorted(credits[SRK], key=lambda f: (-films[f][2], f))[:len(SRK_HARD_BANNED)]
    if set(top5) != set(SRK_HARD_BANNED):
        print("note: Shah Rukh Khan's best-known films are now", [films[f][0] for f in top5], "(Bollywood hard mode bans stay pinned)")

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

    for t, since in TARGETS:
        if since is None and t not in LAUNCH_TARGETS:
            sys.exit(f"FAIL: Q{t} was added to TARGETS without a first day for the star daily")
        if since is not None and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", since):
            sys.exit(f"FAIL: Q{t}'s first day {since!r} isn't YYYY-MM-DD")

    # Bollywood's own famous people: the Bollywood daily starts from them.
    def hindi_share(p):
        n = sum(1 for f in credits[p] if f in hindi)
        return n, len(credits[p])

    bollywood = sorted(
        (p for p in dist if people[p][1] >= BOLLYWOOD_MIN_SITELINKS
         and hindi_share(p)[0] >= BOLLYWOOD_MIN_HINDI_FILMS
         and hindi_share(p)[0] >= BOLLYWOOD_MIN_HINDI_SHARE * hindi_share(p)[1]),
        key=lambda p: (-people[p][1], p),
    )
    print(f"Bollywood stars: {len(bollywood):,} ({', '.join(people[p][0] for p in bollywood[:8])}, ...)")

    def known(f, min_sitelinks):
        return films[f][1] is not None and films[f][2] >= min_sitelinks

    # The other stars, free play's and Bollywood mode's: one more BFS each. JT's part of the
    # graph is one connected piece, so every star in it reaches exactly the people JT does.
    stars = [(t, since, None) for t, since in TARGETS] + [(t, None, "bollywood") for t in BOLLYWOOD_TARGETS]
    targets = []
    for t, since, world in stars:
        if t not in dist:
            print(f"warning: target Q{t} is no longer linked to JT, so free play drops them")
            continue
        t_dist, t_parent = bfs(films, people, cast, credits, t)
        verify(t_dist, t_parent, cast, credits, t)
        if t_dist.keys() != dist.keys():
            sys.exit(f"FAIL: {people[t][0]} doesn't reach the same people JT does")
        tshards: list[dict] = [{} for _ in range(TARGET_SHARDS)]
        for p, d in t_dist.items():
            f, q = t_parent.get(p, (0, 0))
            tshards[p % TARGET_SHARDS][p] = [d, f, q]
        size = sum(write_json(stage / "t" / str(t) / f"{i}.json", s) for i, s in enumerate(tshards))
        entry = {"id": t, "name": people[t][0], "film": films[by_fame(credits[t], films, 2)[0]][0]}
        if since:
            entry["from"] = since
        if world:
            entry["world"] = world
        targets.append(entry)
        t_hist = collections.Counter(t_dist.values())
        print(f"to {people[t][0]}: {size / 1e6:.1f} MB raw, by distance {dict(sorted(t_hist.items()))}")
        if t == SRK:
            # Bollywood hard mode: the same again without his best-known films.
            srk_cast, srk_credits = without(set(SRK_HARD_BANNED), cast)
            h_dist, h_parent = bfs(films, people, srk_cast, srk_credits, SRK)
            verify(h_dist, h_parent, srk_cast, srk_credits, SRK)
            tshards = [{} for _ in range(TARGET_SHARDS)]
            for p, d in h_dist.items():
                f, q = h_parent.get(p, (0, 0))
                tshards[p % TARGET_SHARDS][p] = [d, f, q]
            size = sum(write_json(stage / "t" / f"{t}-hard" / f"{i}.json", s) for i, s in enumerate(tshards))
            print(f"  hard mode: {size / 1e6:.1f} MB raw, {len(t_dist) - len(h_dist):,} people unreachable, "
                  f"{sum(1 for p in h_dist if h_dist[p] > t_dist[p]):,} have a higher par")
            # The Bollywood daily's starts, checked as daily_pool checks JT's.
            srk_starts = [
                p for p in bollywood
                if p != t and t_dist[p] >= DAILY_MIN_DIST and p in h_dist
                and known(max(credits[p], key=lambda f: (films[f][2], -f)), DAILY_TOP_FILM_SITELINKS)
                and all(known(f, DAILY_PATH_FILM_SITELINKS) for _, f in path_to_jt(p, t_parent, t))
            ]
            by_par = collections.Counter(t_dist[p] for p in srk_starts)
            print(f"  Bollywood daily: {len(srk_starts)} starts, by par {dict(sorted(by_par.items()))}")
            if len(srk_starts) < BOLLYWOOD_MIN_STARTS:
                sys.exit(f"FAIL: only {len(srk_starts)} Bollywood daily starts")

    size = write_json(
        stage / "bollywood.json",
        {
            "goal": SRK,
            "starts": sorted(srk_starts),
            "hardBanned": [{"id": f, "title": films[f][0], "year": films[f][1]} for f in SRK_HARD_BANNED],
            "picks": [[p, people[p][0]] for p in bollywood[:BOLLYWOOD_PICKS]],
            "stars": len(bollywood),
            "films": len(hindi),
        },
    )
    print(f"bollywood.json: {size / 1e3:.0f} KB raw")

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
            "targets": targets,
            "targetShards": TARGET_SHARDS,
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
