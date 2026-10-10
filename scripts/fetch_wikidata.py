"""Download the film/cast slice of Wikidata (CC0) via the QLever SPARQL endpoint.

Writes TSVs to data/raw/. Re-running reuses cached files unless --refresh is given.
"""

import argparse
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ENDPOINT = "https://qlever.dev/api/wikidata"
RAW = Path(__file__).resolve().parent.parent / "data" / "raw"
UA = "SixDegreesOfJT/0.1 (https://github.com/SidharthJoly)"

PREFIXES = """
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX schema: <http://schema.org/>
"""

# Feature-length film classes. Short films, music videos, TV specials, sketches and
# unreleased "film projects" are left out: they add noise and big variety-show hubs.
FILM_TYPES = """
wd:Q11424 wd:Q506240 wd:Q202866 wd:Q20650540 wd:Q226730 wd:Q29168811
wd:Q98807719 wd:Q98701476 wd:Q130232 wd:Q104840802 wd:Q127402430 wd:Q17123180
"""
EXCLUDED_TYPES = """
wd:Q24862 wd:Q17517379 wd:Q193977 wd:Q18011172 wd:Q10590726 wd:Q1261214
wd:Q64100970 wd:Q1869909 wd:Q854995 wd:Q11997526 wd:Q653916
"""

FILM_FILTER = f"""
  VALUES ?type {{ {FILM_TYPES} }}
  ?film wdt:P31 ?type .
  FILTER NOT EXISTS {{ VALUES ?bad {{ {EXCLUDED_TYPES} }} ?film wdt:P31 ?bad }}
"""

# Wikidata now stores names shared across languages under "mul" and drops the
# duplicate "en" label, so many famous people have no English label at all.
# Films from non-English cinema often only have a label in their own language.
LABELS = """
  OPTIONAL {{ ?{var} rdfs:label ?en . FILTER(LANG(?en) = "en") }}
  OPTIONAL {{ ?{var} rdfs:label ?mul . FILTER(LANG(?mul) = "mul") }}
  OPTIONAL {{ ?{var} rdfs:label ?any }}"""

QUERIES = {
    # One row per (film, human cast or voice member).
    "edges": f"""
SELECT DISTINCT ?film ?person WHERE {{
  {FILM_FILTER}
  ?film wdt:P161|wdt:P725 ?person .
  ?person wdt:P31 wd:Q5 .
}}""",
    "films": f"""
SELECT ?film (SAMPLE(?en) AS ?name) (SAMPLE(?mul) AS ?mulName) (SAMPLE(?any) AS ?anyName) (MIN(YEAR(?date)) AS ?year) (SAMPLE(?sl) AS ?sitelinks) WHERE {{
  {{ SELECT DISTINCT ?film WHERE {{ {FILM_FILTER} ?film wdt:P161|wdt:P725 ?p . ?p wdt:P31 wd:Q5 . }} }}
  {LABELS.format(var="film")}
  OPTIONAL {{ ?film wdt:P577 ?date }}
  OPTIONAL {{ ?film wikibase:sitelinks ?sl }}
}} GROUP BY ?film""",
    "people": f"""
SELECT ?person (SAMPLE(?en) AS ?name) (SAMPLE(?mul) AS ?mulName) (SAMPLE(?any) AS ?anyName) (SAMPLE(?sl) AS ?sitelinks) (MIN(YEAR(?death)) AS ?died) WHERE {{
  {{ SELECT DISTINCT ?person WHERE {{ {FILM_FILTER} ?film wdt:P161|wdt:P725 ?person . ?person wdt:P31 wd:Q5 . }} }}
  {LABELS.format(var="person")}
  OPTIONAL {{ ?person wikibase:sitelinks ?sl }}
  OPTIONAL {{ ?person wdt:P570 ?death }}
}} GROUP BY ?person""",
    # Nicknames and alternative names (CR7, SRK, JT), so search finds people by what
    # they're actually called. build_graph.py keeps only the search-index people's;
    # filtering on sitelinks here as well makes QLever return no rows at all.
    "aliases": f"""
SELECT DISTINCT ?person ?alias WHERE {{
  {{ SELECT DISTINCT ?person WHERE {{ {FILM_FILTER} ?film wdt:P161|wdt:P725 ?person . ?person wdt:P31 wd:Q5 . }} }}
  ?person skos:altLabel ?alias .
  FILTER(LANG(?alias) = "en" || LANG(?alias) = "mul")
}}""",
    # Bollywood: films in Hindi (or Urdu, or Hindustani, as older ones often are), for
    # Bollywood mode. With their English Wikipedia article's title, the name fans know them
    # by: Wikidata's English label is sometimes a translation ("Sometimes Happiness Sometimes
    # Sadness..." for Kabhi Khushi Kabhie Gham...).
    "hindi": f"""
SELECT DISTINCT ?film ?title WHERE {{
  {FILM_FILTER}
  VALUES ?lang {{ wd:Q1568 wd:Q1617 wd:Q11051 }}
  ?film wdt:P364 ?lang .
  OPTIONAL {{ ?article schema:about ?film ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?title . }}
}}""",
}


def fetch(name: str, query: str, refresh: bool) -> Path:
    out = RAW / f"{name}.tsv"
    if out.exists() and not refresh:
        print(f"{name}: cached ({out.stat().st_size / 1e6:.1f} MB)")
        return out
    url = ENDPOINT + "?" + urllib.parse.urlencode({"query": PREFIXES + query})
    req = urllib.request.Request(
        url, headers={"Accept": "text/tab-separated-values", "User-Agent": UA}
    )
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=600) as resp:
        data = resp.read()
    if not data.startswith(b"?"):
        sys.exit(f"{name}: unexpected response: {data[:300]!r}")
    tmp = out.with_suffix(".tmp")
    tmp.write_bytes(data)
    tmp.rename(out)
    rows = data.count(b"\n") - 1
    print(f"{name}: {rows:,} rows, {len(data) / 1e6:.1f} MB in {time.time() - t0:.1f}s")
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--refresh", action="store_true", help="re-download cached TSVs")
    args = ap.parse_args()
    RAW.mkdir(parents=True, exist_ok=True)
    for name, query in QUERIES.items():
        fetch(name, query, args.refresh)


if __name__ == "__main__":
    main()
