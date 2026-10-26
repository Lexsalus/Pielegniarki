# Panel pielęgniarek

Panel administratora według projektu „Zakładka Pielęgniarki” (23.10.2026): rewiry na mapie, dostępność, strefy i stawki, przydział zleceń. Jedna zakładka, w której widać wszystkie pielęgniarki, ich obszary, terminy, stawki i to, komu trafia które zlecenie.

🌐 **Adres:** https://lexsalus.github.io/Pielegniarki/ (logowanie, 2FA dla Administratora)

## Pliki

```
index.html          powłoka: logowanie (e-mail + hasło, 2FA), uprawnienia, menu
pielegniarki.js     cała zakładka: lista, mapa, karta, przydział, zlecenia, dostępność, oczekujący, ustawienia, panel pielęgniarki
supabase/004_pielegniarki.sql   schemat bazy tej części (tabele, RLS, funkcje)
```

## Baza

Na razie wspólna z CRM kancelarii: Supabase, projekt **CRMKP** (`ixlhfhzgzotukstoezcj`, UE). Migracja 004 jest tam wdrożona (26.10.2026) razem z zadaniem pg_cron `zlecenia-limit-czasu` (co minutę). Schemat bazowy (użytkownicy, role, uprawnienia, audyt, powiadomienia) jest w repo `Lexsalus/PiK` (`supabase/schema.sql`, migracje 002–003), bo z niego korzysta ta część.

Klucz w `index.html` to klucz publiczny (`sb_publishable_…`) — może być jawny; dostęp ogranicza baza (RLS). Nigdy nie wpisywać klucza `sb_secret_…`.

## Konta i role

- **Administrator** (uprawnienie `nurses` = pełne): wszystko w zakładce.
- **Pielęgniarka** (rola `nurse`): tylko własny panel — swoje zlecenia (przyjmij / odrzuć, statusy), obszar i terminarz do zatwierdzenia, własne wypłaty.
- Konta zakłada Administrator w Supabase (Authentication → Users), rolę i aktywację nadaje w CRM kancelarii → Ustawienia → Użytkownicy (wspólna baza kont). Kartę pielęgniarki łączy z kontem: karta → Dane i usługi → Konto.
- Konto bez uprawnienia „Pielęgniarki” po zalogowaniu dostaje komunikat o braku dostępu.

## Reguły pilnowane przez bazę

Pielęgniarka widzi tylko siebie i własne zlecenia (bez ceny dla klienta i marży) i nie zatwierdza sama obszaru ani terminarza. Zlecenia zmieniają się wyłącznie przez funkcje (`create_nurse_order`, `dispatch_order`, `respond_order`, `advance_order`). Przed regułą przydziału działają twarde filtry: obszar, wolny termin, usługa, limit dzienny. Każde zlecenie wymaga akceptacji pielęgniarki (limit czasu → następna z puli → dyspozytor). Operacje trafiają do dziennika audytu.

## Testy

Uruchamiane z repo `Lexsalus/PiK` (lokalna kopia bazy): reguły bazy `supabase/test/schema.test.mjs`, interfejs `supabase/test/e2e/run_pielegniarki.py` — dla tej aplikacji z `NZ_URL=http://localhost:8766/index.html` (repo serwowane na porcie 8766). Wynik 26.10.2026: 40/40.

## Do zrobienia po stronie właściciela

- Supabase → Authentication → URL Configuration → **Redirect URLs**: dodać `https://lexsalus.github.io/Pielegniarki/` (linki resetu hasła).
- Settings → Pages w tym repo: źródło „GitHub Actions” (workflow już jest).
