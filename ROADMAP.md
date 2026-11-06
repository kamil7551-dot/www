# ROADMAP.md

Plan budowy w kolejności. Każdy etap kończy się czymś, co da się pokazać albo sprzedać.
Zadania odhaczamy w PR, który je zamyka. Zmiany kolejności zatwierdza Kamil.

Pełna ocena pomysłu i architektura: [dokument projektu](https://claude.ai/artifact/MQCr8bZV7ScUbe2VGk5Rdr).

## W toku

Kto teraz nad czym pracuje. Agent wpisuje się tutaj **przed** rozpoczęciem pracy, w pierwszym commicie swojej gałęzi, i usuwa wiersz w PR, który kończy zadanie.
Jeśli zadanie jest już tu zajęte przez kogoś innego, nie zaczynaj go: wybierz inne albo zapytaj.

| Zadanie (z etapów poniżej) | Agent | Gałąź | Od kiedy | Uwagi |
| --- | --- | --- | --- | --- |
| _brak_ | | | | |

## Dziennik prac

Co zostało zrobione, najnowsze na górze. Jeden wiersz na każdy zmergowany PR, dopisywany w tym samym PR.
Kolumna „Dla następnych” to krótka notatka dla kolejnego agenta: co warto wiedzieć, co zostało do zrobienia, na co uważać.

| Data | Agent | Co zrobiono | PR / commit | Dla następnych |
| --- | --- | --- | --- | --- |
| 2026-11-06 | Claude | Rdzeń: katalog (pozycje i kategorie), `TenantDb` z wymuszonym `tenant_id`, szyna zdarzeń, rejestr modułów z włączaniem per sklep | PR `feat/core-catalog` | Ceny w groszach (liczby całkowite). SQL w rdzeniu: `?1` to zawsze `tenant_id`, pozostałe parametry od `?2`. Zdarzenia na razie `item.*` i `category.created`; zamówienia dojdą w etapie 4. Moduły w testach przez `test/core-under-test.ts`. Następne: zdjęcia w R2, panel, rozpoznawanie sklepu po adresie |
| 2026-11-06 | Claude | Szkielet projektu: Hono na Workers, D1 z pierwszą migracją (`tenants`), Vitest, ESLint, CI, szablon PR | PR `feat/infra-scaffold` | `worker-configuration.d.ts` nie jest w repo, generuje go `pnpm types` (uruchamiane automatycznie przez typecheck i test). `database_id` w wrangler.jsonc to atrapa do czasu pierwszego wdrożenia. Następne: etap 1, model danych katalogu |
| 2026-11-06 | Claude | Dodano tabelę „W toku” i dziennik prac | PR `docs/work-log` | Wypełniaj obie tabele zgodnie z AGENTS.md, sekcja „Zapisywanie pracy” |
| 2026-11-06 | Claude | Dodano AGENTS.md, ROADMAP.md, INSTRUCTIONS.md | commit startowy na `main` | Następne zadanie: szkielet projektu z etapu 0 |

## Etap 0: Fundamenty

Cel: puste, ale działające repozytorium, w którym każdy agent może bezpiecznie pracować.

- [x] AGENTS.md, ROADMAP.md, INSTRUCTIONS.md
- [x] Szkielet projektu: pnpm, TypeScript, Hono, Wrangler, Vitest
- [x] CI na GitHubie: typecheck, lint, testy przy każdym PR
- [x] Lokalne uruchamianie (`pnpm dev`) z lokalną bazą D1
- [x] Szablon opisu PR zgodny z AGENTS.md

## Etap 1: Rdzeń i katalog

Cel: jeden silnik, na którym stoją wszystkie rodzaje stron.

- [x] Model danych: tenanci (sklepy), pozycje katalogu (produkt, usługa, danie), kategorie
- [x] Warstwa danych z automatycznym `tenant_id`
- [x] Szyna zdarzeń i rejestr modułów (`defineModule`, hooki, zależności, ustawienia, włączanie per sklep)
- [ ] Sloty: fragmenty modułów wstawiane do stron sklepu
- [ ] Upload zdjęć do R2 i serwowanie w odpowiednich rozmiarach
- [ ] Panel sprzedawcy: logowanie, dodawanie i edycja pozycji, ustawienia sklepu
- [ ] Rozpoznawanie sklepu po adresie (subdomena, później własna domena)

## Etap 2: Wizytówka

Cel: pierwszy produkt do sprzedaży, bez płatności i kurierów.

- [ ] Szablon `business-card`: strona główna, oferta, kontakt, mapa, godziny otwarcia
- [ ] Formularz kontaktowy z wysyłką maila
- [ ] Podstawowe SEO: tytuły, opisy, mapa strony, dane strukturalne firmy
- [ ] Wybór kolorów, logo i tekstów w panelu
- [ ] Test z pierwszym klientem

## Etap 3: Menu QR

Cel: ten sam katalog jako karta dań dla gastronomii.

- [ ] Szablon `qr-card`: kategorie dań, ceny, opisy, alergeny
- [ ] Szybkie przełączanie „brak dziś” z telefonu
- [ ] Generator kodu QR do druku (PNG i PDF)
- [ ] Kilka wersji językowych menu (opcjonalnie)

## Etap 4: Sklep mały

Cel: prawdziwe zamówienia i płatności.

- [ ] Koszyk i składanie zamówienia (bez zakładania konta)
- [ ] Moduł `payments-p24` (Przelewy24 z BLIK)
- [ ] Moduł `shipping-inpost` (Paczkomaty)
- [ ] Maile: potwierdzenie zamówienia, wysyłka
- [ ] Regulamin, polityka prywatności, zwroty (szablony do uzupełnienia)
- [ ] Szablon `simple`: prosty układ, płytkie drzewko kategorii
- [ ] Panel: lista zamówień, zmiana statusu

## Etap 5: Sklep duży

Cel: wygoda przy setkach i tysiącach produktów.

- [ ] Szablon `large-catalog`: szerszy układ, głębokie kategorie
- [ ] Filtry: cena, marka, parametry
- [ ] Szybka wyszukiwarka
- [ ] Warianty produktów (rozmiar, kolor) i stany magazynowe
- [ ] Import i eksport produktów (CSV)

## Etap 6: Rozliczenia i start sprzedaży

- [ ] Abonament: Basic 29 zł/mies. (pierwszy miesiąc gratis), 199 zł/rok
- [ ] Płatne moduły (do 29 zł/mies.) włączane w panelu
- [ ] Strona sprzedażowa platformy
- [ ] Wdrożenie produkcyjne na Cloudflare (tylko za zgodą Kamila)

## Później (moduły płatne)

- Produkty cyfrowe: automatyczna wysyłka klucza lub pliku po opłaceniu
- Rezerwacje terminów dla usług
- Faktury
- Integracja z Allegro
- Zamówienia do stolika w menu QR
- Własna domena z pocztą
- Programy lojalnościowe i kody rabatowe

## Otwarte decyzje

- Czy wizytówka i menu QR są w Basic za 29 zł, czy w tańszym pakiecie?
- Nazwa produktu i domena.
- Kim jest pierwszy tester i od którego rodzaju strony zaczynamy z nim.
