"""Podbija wersję w version.json i dopisuje wpis do CHANGELOG.md.

Użycie (Windows):
  py bump.py patch "Opis zmiany"     # 1.1.0 -> 1.1.1  (poprawki, dane)
  py bump.py minor "Opis zmiany"     # 1.1.0 -> 1.2.0  (nowe funkcje)
  py bump.py major "Opis zmiany"     # 1.1.0 -> 2.0.0  (duże przebudowy)
  py bump.py minor --relogin "Opis"  # jak wyżej + zalogowani muszą zalogować się ponownie
                                     # (pasek z odliczaniem, wylogowanie po 5 min)
Opis trafia też do version.json ("notes") — pokazuje go pasek „Jest nowa wersja”.
"""
import json, sys, datetime, pathlib

ROOT = pathlib.Path(__file__).parent
VER = ROOT / "version.json"
LOG = ROOT / "CHANGELOG.md"

def main():
    if len(sys.argv) < 3 or sys.argv[1] not in ("patch", "minor", "major"):
        print(__doc__); sys.exit(1)
    args = [a for a in sys.argv[2:] if a != "--relogin"]
    relogin = "--relogin" in sys.argv[2:]
    part, msg = sys.argv[1], " ".join(args)
    data = json.loads(VER.read_text(encoding="utf-8"))
    ma, mi, pa = map(int, data["version"].split("."))
    if part == "major": ma, mi, pa = ma + 1, 0, 0
    elif part == "minor": mi, pa = mi + 1, 0
    else: pa += 1
    new = f"{ma}.{mi}.{pa}"
    today = datetime.date.today().isoformat()
    VER.write_text(json.dumps({"version": new, "date": today, "notes": msg, "relogin": relogin}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    entry = f"## [{new}] — {today}\n- {msg}" + (" *(wymaga ponownego zalogowania)*" if relogin else "") + "\n\n"
    text = LOG.read_text(encoding="utf-8") if LOG.exists() else "# Changelog\n\n"
    head, sep, rest = text.partition("\n## ")
    text = head.rstrip() + "\n\n" + entry + (("## " + rest) if sep else "")
    LOG.write_text(text, encoding="utf-8")
    print(f"{data['version']} -> {new}")

if __name__ == "__main__":
    main()
