# Test panelu pielęgniarek przez interfejs (lokalna kopia bazy)

`server.mjs` uruchamia lokalnie PostgreSQL (PGlite) z `../../schema.sql` i migracjami 002–009 oraz udaje API Supabase; `shim.js` podmienia supabase-js w przeglądarce testowej.

```
cd supabase/test && npm i @electric-sql/pglite@0.4.6 leaflet@1.9.4 && cp -r node_modules e2e/
node schema.test.mjs                       # reguły bazy
node e2e/server.mjs &                      # lokalna baza: http://localhost:9900
(cd ../.. && python3 -m http.server 8766 &)  # panel z katalogu głównego repo
python3 e2e/run_pielegniarki.py            # wymaga: pip install playwright
```
Konta (fikcyjne, tylko lokalnie; hasło `Haslo-testowe-123`, kod 2FA `123456`): admin@k.test, nowak@k.test, kowal@k.test. Wynik 26.10.2026: 93/93.
