# Panel pielęgniarek

Panel administratora według projektu „Zakładka Pielęgniarki” (23.10.2026): rewiry na mapie, dostępność, strefy i stawki, przydział zleceń. Jedna zakładka, w której widać wszystkie pielęgniarki, ich obszary, terminy, stawki i to, komu trafia które zlecenie.

🌐 **Adres:** https://lexsalus.github.io/Pielegniarki/ (logowanie, 2FA dla Administratora)

## Wersja

Numer wersji jest w jednym miejscu: `version.json` (pokazywany przy nazwie na ekranie logowania i w lewym pasku). Przy każdym wysłaniu zmian: `py bump.py patch|minor|major "opis"` — podbija numer i dopisuje wpis do `CHANGELOG.md`. Numeracja jest niezależna od PiK (osobna aplikacja, osobny `version.json`).

## Pliki

```
index.html          powłoka: logowanie (e-mail + hasło, 2FA), uprawnienia, menu
i18n.js             tłumaczenie interfejsu: polski / ukraiński / angielski (flagi w górnym pasku i na ekranie logowania; wybór zapamiętany w przeglądarce)
manifest.webmanifest, sw.js, icons/   aplikacja (PWA): przycisk „Zainstaluj aplikację” na ekranie logowania i w górnym pasku
czat.js             komunikator: dymek w prawym dolnym rogu (rozmowy 1:1) i wątki przy zleceniach
pielegniarki.js     cała zakładka: lista, mapa, karta, przydział, zlecenia, dostępność, oczekujący, ustawienia, panel pielęgniarki
supabase/           schema.sql (użytkownicy, role, audyt, powiadomienia) + migrations/002–005; test/ — reguły bazy i test przez interfejs
```

## Baza

Supabase, projekt **CRMKP** (`ixlhfhzgzotukstoezcj`, UE, Irlandia) — tylko dla tego panelu (od 26.10.2026 PiK ma własną bazę). Wdrożone: `schema.sql`, migracje 002–005 („Aktywni”, „Podgląd” — wdrożona 26.10.2026); 006 (komunikator) — wdrożona 26.10.2026; 007 (telefon, status) — wdrożona 26.10.2026, pg_cron `zlecenia-limit-czasu` (co minutę) i `przypomnienia-terminy`. Logowanie (Auth): Site URL i Redirect URLs — `https://lexsalus.github.io/Pielegniarki/`; rejestracja wyłączona, 2FA (TOTP) włączone.

Pozostałości po CRM kancelarii w tej bazie (puste tabele spraw, klientów, finansów, terminów, formularz `leads` z zapisem anonimowym) nie są używane — do usunięcia osobną migracją po decyzji właściciela.

Klucz w `index.html` to klucz publiczny (`sb_publishable_…`) — może być jawny; dostęp ogranicza baza (RLS). Nigdy nie wpisywać klucza `sb_secret_…`.

## Konta i role

- **Administrator** (uprawnienie `nurses` = pełne): wszystko w zakładce.
- **Pielęgniarka** (rola `nurse`): tylko własny panel — swoje zlecenia (przyjmij / odrzuć, statusy), obszar i terminarz do zatwierdzenia, własne wypłaty.
- Nowe konto: Supabase → Authentication → Users → Add user (Auto Confirm). W panelu: **Ustawienia → Konta** — rola (Pielęgniarka / Administrator), „Aktywne”, Zapisz; potem karta pielęgniarki → Dane i usługi → Konto. Konto bez uprawnienia „Pielęgniarki” po zalogowaniu dostaje komunikat o braku dostępu.
- **Aktywni** (lewe menu, tylko Administrator): kto jest teraz zalogowany — panel co minutę wysyła sygnał obecności; aktywny = sygnał w ciągu 2 minut, bez wylogowania.
- **Podgląd** (lewe menu, tylko Administrator): panel tak, jak widzi go wybrana rola (Pielęgniarka — na przykładzie wybranej karty) albo konkretna osoba; tylko do odczytu. Zlecenia i stawki z tych samych zapytań co panel pielęgniarki.
- **Komunikator** (dymek 💬 w prawym dolnym rogu): pielęgniarka pisze tylko z Administratorem / dyspozytorem, Administrator — z każdym; pielęgniarki między sobą nie. Wiadomości do osób niezalogowanych są doręczane po zalogowaniu; ✓ wysłane, ✓✓ doręczone, ✓✓ (niebieskie) przeczytane. Wątek przy zleceniu (💬 na liście zleceń i w panelu pielęgniarki): Administrator / dyspozytor + pielęgniarka przypisana do zlecenia. Bez załączników. Nowa wiadomość → powiadomienie w dzwonku (jedno na rozmowę).
- **Telefon i status**: numer telefonu ustawia Administrator w Ustawieniach → Konta; w komunikatorze przy osobie jest 📞 (szybkie połączenie). Numer widzą tylko osoby, które mogą ze sobą pisać (pielęgniarki nie widzą numerów innych pielęgniarek). Administrator / dyspozytor ustawia swój status kliknięciem w swoją nazwę u góry: 🟢 Dostępny, 🟠 Zajęty, ⚪ Niewidoczny (dla wszystkich wygląda na niezalogowanego, także w „Aktywni”). Status zostaje po wylogowaniu. Gdy Administrator / dyspozytor zaloguje się ze statusem Dostępny albo zmieni status na Dostępny, inni zalogowani dostają komunikat z krótkim dźwiękiem.
- **Powiadomienia** (dzwonek u góry): propozycje zleceń, zlecenia dla dyspozytora, zmiany obszaru i terminarza do zatwierdzenia.

## Dane testowe

`supabase/seed/dane_testowe.sql` — 8 pielęgniarek „TEST …” w różnych konfiguracjach (dzielnice, całe miasto + promień, wielokąt, urlop, do weryfikacji, zmiany do zatwierdzenia), usługi, uproszczone dzielnice Warszawy, cenniki 5 miast z nadpisaniem stawki, 4 reguły przydziału (proporcjonalnie, kolejka z limitem, po kolei, ręcznie), zlecenia we wszystkich statusach, lista oczekujących, dokumenty (jedno OC przeterminowane). Usunięcie: `supabase/seed/usun_dane_testowe.sql` (wpisy w dzienniku audytu zostają).

## Reguły pilnowane przez bazę

Pielęgniarka widzi tylko siebie i własne zlecenia (bez ceny dla klienta i marży) i nie zatwierdza sama obszaru ani terminarza. Zlecenia zmieniają się wyłącznie przez funkcje (`create_nurse_order`, `dispatch_order`, `respond_order`, `advance_order`). Przed regułą przydziału działają twarde filtry: obszar, wolny termin, usługa, limit dzienny. Każde zlecenie wymaga akceptacji pielęgniarki (limit czasu → następna z puli → dyspozytor). Operacje trafiają do dziennika audytu.

## Testy

`supabase/test/` — opis w `supabase/test/e2e/README.md`. Wynik 26.10.2026: reguły bazy 176/176, interfejs 84/84.

## Rozstrzygnięcia tam, gdzie projekt milczy (do potwierdzenia albo zmiany)

- Brak reguły przydziału dla miasta / dzielnicy → zlecenie do dyspozytora.
- Cena dojazdu dla klienta ustalana przy zakładaniu zlecenia = najniższa strefa wśród pielęgniarek dostępnych w wybranym terminie (wypłata i strefa zapisywane dla osoby, która dostanie propozycję).
- Obszar odrzucony przez Administratora wraca do szkicu z uwagą.
- Wyjątki w terminarzu (urlop) pielęgniarka zgłasza od dziś, wzorzec — od następnego tygodnia.
- Pielęgniarka widzi dane klienta dopiero po przyjęciu zlecenia (wcześniej adres i termin).

## Propozycje (niewdrożone, decyzja właściciela)

- Formularz „Zamów badania w domu” dla klientów (strona 8 projektu); teraz zlecenia zakłada Administrator / dyspozytor.
- 2FA obowiązkowe dla roli Pielęgniarka (dane zdrowotne, RODO).
- Anulowanie zlecenia (brak takiego statusu w projekcie).
- Powiadomienia SMS / e-mail o propozycji zlecenia.
- Usunięcie z bazy pustych tabel CRM kancelarii.
