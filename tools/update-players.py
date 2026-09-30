"""Refresh data/players.json from Sleeper's players file.

Sleeper asks that its players file (about 5 MB, every NFL player) be fetched
at most once a day and kept on our own side, rather than by every visitor.
A scheduled GitHub Action runs this each morning (see
.github/workflows/update-players.yml); the site reads the slim copy it
writes instead of calling Sleeper for it.

Each entry is  id: [name, position, club]  with Sleeper's own club code;
sleeper.js turns the code into the one the site uses. A fourth element, the
lineup slots a player can fill, is added only where that isn't implied by
his position (a QB who is also listed at TE): the lineup tools need it to
know who could have played where. One entry per line, in a fixed order, so
a day's commit shows only the players that changed.

    python tools/update-players.py

Standard library only. Exits non-zero, leaving the old file alone, if
Sleeper's answer looks wrong.
"""
import json
import os
import sys
import urllib.request

URL = "https://api.sleeper.app/v1/players/nfl"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "players.json")


def slim(pid, p):
    if p.get("position") == "DEF":
        return [f"{p.get('last_name') or pid} D/ST", "DST", pid]
    name = p.get("full_name") or f"{p.get('first_name') or ''} {p.get('last_name') or ''}".strip() or pid
    pos = p.get("position") or (p.get("fantasy_positions") or ["?"])[0] or "?"
    entry = [name, pos, p.get("team")]
    eligible = [x for x in (p.get("fantasy_positions") or []) if x]
    if eligible and eligible != [IMPLIED.get(pos, pos)]:
        entry.append(eligible)
    return entry


# The fantasy position a real one stands for, as sleeper.js assumes it.
IMPLIED = {"DE": "DL", "DT": "DL", "NT": "DL", "CB": "DB", "S": "DB", "SS": "DB",
           "FS": "DB", "ILB": "LB", "OLB": "LB", "MLB": "LB", "DEF": "DEF"}


def main():
    req = urllib.request.Request(URL, headers={"User-Agent": "league-history-players/1.0"})
    with urllib.request.urlopen(req, timeout=120) as res:
        players = json.load(res)
    if not isinstance(players, dict) or len(players) < 1000:
        sys.exit(f"unexpected answer from Sleeper ({type(players).__name__}, {len(players)} entries); keeping the old file")

    # Numeric ids first in number order, then the defences by club.
    ids = sorted(players, key=lambda k: (0, int(k), "") if k.isdigit() else (1, 0, k))
    lines = [f"{json.dumps(pid)}:{json.dumps(slim(pid, players[pid]), ensure_ascii=False, separators=(',', ':'))}" for pid in ids]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("{\n" + ",\n".join(lines) + "\n}\n")
    print(f"wrote {len(lines)} players to data/players.json ({os.path.getsize(OUT) // 1024} KB)")


if __name__ == "__main__":
    main()
