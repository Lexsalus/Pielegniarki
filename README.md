# Panel pielęgniarek

Panel administratora według projektu „Zakładka Pielęgniarki” (23.10.2026): rewiry na mapie, dostępność, strefy i stawki, przydział zleceń. Jedna zakładka, w której widać wszystkie pielęgniarki, ich obszary, terminy, stawki i to, komu trafia które zlecenie.

🌐 **Adres:** https://lexsalus.github.io/Pielegniarki/ (logowanie, 2FA dla Administratora)

## Pliki

```
index.html          powłoka: logowanie (e-mail + hasło, 2FA), uprawnienia, menu
pielegniarki.js     cała zakładka: lista, mapa, karta, przydział, zlecenia, dostępność, oczekujący, ustawienia, panel pielęgniarki
supabase/           schema.sql (użytkownicy, role, audyt, powiadomienia) + migrations/002–004; test/ — reguły bazy i test przez interfejs
```

## Baza

Supabase, projekt **CRMKP** (`ixlhfhzgzotukstoezcj`, UE, Irlandia) — tylko dla tego panelu (od 26.10.2026 PiK ma własną bazę). Wdrożone: `schema.sql`, migracje 002–004, pg_cron `zlecenia-limit-czasu` (co minutę) i `przypomnienia-terminy`. Logowanie (Auth): Site URL i Redirect URLs — `https://lexsalus.github.io/Pielegniarki/`; rejestracja wyłączona, 2FA (TOTP) włączone.

Pozostałości po CRM kancelarii w tej bazie (puste tabele spraw, klientów, finansów, terminów, formularz `leads` z zapisem anonimowym) nie są używane — do usunięcia osobną migracją po decyzji właściciela.

Klucz w `index.html` to klucz publiczny (`sb_publishable_…`) — może być jawny; dostęp ogranicza baza (RLS). Nigdy nie wpisywać klucza `sb_secret_…`.

## Konta i role

- **Administrator** (uprawnienie `nurses` = pełne): wszystko w zakładce.
- **Pielęgniarka** (rola `nurse`): tylko własny panel — swoje zlecenia (przyjmij / odrzuć, statusy), obszar i terminarz do zatwierdzenia, własne wypłaty.
- Nowe konto: Supabase → Authentication → Users → Add user (Auto Confirm), potem SQL Editor:

```sql
update public.profiles set role='nurse', active=true, full_name='Imię Nazwisko' where email='adres@pielegniarki.pl';
```

  Następnie w panelu: karta pielęgniarki → Dane i usługi → Konto. Konto bez uprawnienia „Pielęgniarki” po zalogowaniu dostaje komunikat o braku dostępu.

## Reguły pilnowane przez bazę

Pielęgniarka widzi tylko siebie i własne zlecenia (bez ceny dla klienta i marży) i nie zatwierdza sama obszaru ani terminarza. Zlecenia zmieniają się wyłącznie przez funkcje (`create_nurse_order`, `dispatch_order`, `respond_order`, `advance_order`). Przed regułą przydziału działają twarde filtry: obszar, wolny termin, usługa, limit dzienny. Każde zlecenie wymaga akceptacji pielęgniarki (limit czasu → następna z puli → dyspozytor). Operacje trafiają do dziennika audytu.

## Testy

`supabase/test/` — opis w `supabase/test/e2e/README.md`. Wynik 26.10.2026: reguły bazy 120/120, interfejs 40/40.

## Rozstrzygnięcia tam, gdzie projekt milczy (do potwierdzenia albo zmiany)

- Brak reguły przydziału dla miasta / dzielnicy → zlecenie do dyspozytora.
- Cena dojazdu dla klienta ustalana przy zakładaniu zlecenia = najniższa strefa wśród pielęgniarek dostępnych w wybranym terminie (wypłata i strefa zapisywane dla osoby, która dostanie propozycję).
- Obszar odrzucony przez Administratora wraca do szkicu z uwagą.
- Wyjątki w terminarzu (urlop) pielęgniarka zgłasza od dziś, wzorzec — od następnego tygodnia.
- Pielęgniarka widzi dane klienta dopiero po przyjęciu zlecenia (wcześniej adres i termin).

## Propozycje (niewdrożone, decyzja właściciela)

- Zarządzanie kontami (rola, aktywacja) w panelu zamiast SQL.
- Formularz „Zamów badania w domu” dla klientów (strona 8 projektu); teraz zlecenia zakłada Administrator / dyspozytor.
- 2FA obowiązkowe dla roli Pielęgniarka (dane zdrowotne, RODO).
- Anulowanie zlecenia (brak takiego statusu w projekcie).
- Powiadomienia SMS / e-mail o propozycji zlecenia.
- Usunięcie z bazy pustych tabel CRM kancelarii.
