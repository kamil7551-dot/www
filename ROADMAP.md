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
| 2026-11-12 | Claude | Sklep: wyszukiwarka w nagłówku (`/produkty?q=`, bez polskich znaków, słowa w dowolnej kolejności, też w opisie), strony kategorii `/kategoria/<adres>` z podkategoriami, filtr ceny, sortowanie, strony po 24 produkty; na stronie głównej po 8 produktów na kategorię z linkiem „Zobacz wszystkie”; kategorie w sitemap | PR `feat/shop-filters` | Logika w `core/browse.ts` (czyste funkcje, jeden odczyt D1 na widok). Przy tysiącach produktów przenieść wyszukiwanie do SQL (FTS5). Strona kategorii bez filtrów ma canonical, wyniki wyszukiwania i filtry mają `noindex`. Karta produktu i CSS listy są wspólne (`themes/listing.ts`, `.pgrid`/`.pcard` w `SHARED_CSS`) |
| 2026-11-12 | Claude | Wzory stron prawnych (`themes/legal.ts`): regulamin i odstąpienie od umowy w sklepie, polityka prywatności na każdej stronie, linki w stopce każdego szablonu; karta „Dane firmy” w panelu (pełna nazwa, NIP z cyfrą kontrolną, dodatkowe postanowienia); obowiązkowy checkbox regulaminu w zamówieniu | PR `feat/core-legal-pages` | To wzory, nie porada prawna: panel mówi to sprzedawcy. Zmiana treści tylko z datowaną notką tutaj. Polityka prywatności opisuje tylko ciasteczko koszyka; nowe ciasteczka lub narzędzia analityczne wymagają jej aktualizacji |
| 2026-11-12 | Claude | Panel: zakładka „Zamówienia” z licznikiem nowych, filtr po statusie, szczegóły zamówienia, zmiana statusu z mailem do klienta; karta „Sprzedaż” w ustawieniach (odbiór osobisty, cena kuriera, numer konta) | PR `feat/panel-orders` | Ekrany zamówień są w `apps/worker/src/panel-orders.ts`, ale członkostwo nadal sprawdza `siteFor()` z `panel.ts`. Mail o statusie nie ma linku do zamówienia (trzymamy tylko skrót sekretu). Zostało w etapie 4: P24 (potrzebne konto sprzedawcy w Przelewy24), InPost, regulamin i polityka prywatności |
| 2026-11-12 | Claude | Koszyk w ciasteczku (bez JS), formularz zamówienia z odbiorem osobistym lub kurierem, strona zamówienia dla klienta z danymi do przelewu, maile do klienta i sprzedawcy | PR `feat/storefront-cart` | Strony sklepu (`/cart`, `/checkout`, `/order/:id`) składa `themes/shop-pages.ts`, szablon tylko je opakowuje przez `page`. Działają tylko dla rodzaju `shop`. Maile idą przez `waitUntil` i ich błąd nie psuje zamówienia. Link w mailu do sprzedawcy prowadzi do `/sites/:site/orders/:id` w panelu, ten ekran dojdzie w następnym PR |
| 2026-11-12 | Claude | Rdzeń zamówień: tabele `orders` i `order_items`, numeracja per sklep, ceny zawsze z katalogu, link do zamówienia z sekretem (trzymamy tylko skrót), statusy ze zdarzeniami `order.*`; ustawienia sklepu: odbiór osobisty, kurier z ceną, numer konta (sprawdzany sumą IBAN) | PR `feat/core-orders` | Płatności na razie: odbiór osobisty = płatność na miejscu, kurier = przelew na konto z ustawień (bez konta kurier jest niedostępny). P24 dojdzie jako moduł. Pozycje zamówienia kopiują nazwę i cenę. Następne: koszyk i formularz zamówienia, maile, panel zamówień |
| 2026-11-12 | Claude | Strona produktu `/p/<adres>` z danymi Product/Offer dla Google, szablon `shop` (siatka produktów), układ stron w szablonach (`page`), unikalne adresy pozycji o tej samej nazwie | PR `feat/storefront-item-page` | Szablon dostaje gotową treść strony w `PageView.body` i tylko ją opakowuje; bez `page` używany jest `defaultPage` z `themes/shared.ts`. Wspólne komponenty i ich CSS (`SHARED_CSS`) są w `themes/shared.ts`. CSS w szablonie wstawiaj przez `raw()`, bo `html``` escapuje cudzysłowy. Szablon `shop` pokazuje slot `item.after` tylko na stronie produktu. Następne: koszyk i zamówienia |
| 2026-11-12 | Claude | Panel: strzałki kolejności dla kategorii i pozycji (pozycje w obrębie swojej kategorii), zmiana nazwy i usuwanie kategorii, lista pozycji pogrupowana jak na stronie, wyszukiwarka i filtry (kategoria, status, „brak dziś”) | PR `feat/core-ordering-filters` | Nowe pozycje i kategorie trafiają na koniec (`max(position)+1`). Pierwsze przesunięcie przenumerowuje rodzeństwo, więc stare wiersze z `position` 0 też działają. `TenantDb.batch` = kilka zapytań w jednej transakcji. Szukanie po nazwie jest w JS, bo LIKE w SQLite nie rozróżnia wielkości polskich liter; przy tysiącach pozycji (etap 5) przenieść do FTS. Przy aktywnych filtrach strzałki są ukryte. Nowe zdarzenia: `category.updated`, `category.deleted` |
| 2026-11-12 | Claude | Zakładka „Kod QR” w panelu: kod do strony (własna domena, jeśli jest), pobieranie PNG i SVG, arkusz A4 do druku (1 duży albo 6 na stoliki); formularz dodawania pozycji podpowiada rodzaj według typu strony | PR `feat/qr-code` | Kod generuje `uqr` tylko po stronie serwera (0 KB JS u klienta); PNG składamy sami (`core/qr.ts`, CompressionStream). PDF = druk z przeglądarki, bez biblioteki PDF. `jsqr` jest tylko w testach i sprawdza, że kod da się zeskanować. Do zrobienia: kolejność kategorii w panelu (teraz alfabetycznie, bo wszystkie mają `position` 0) |
| 2026-11-12 | Claude | Menu QR: szablon `qr-card` (pasek kategorii, ceny, alergeny z legendą, przekreślone dania „brak dziś”), 14 alergenów UE przy daniach, przycisk „Brak dziś” na liście pozycji w panelu | PR `feat/qr-menu` | „Brak dziś” zapisuje `sold_out_until` = północ w Polsce, więc danie wraca samo następnego dnia; sprawdzaj przez `isSoldOut()`. Alergeny trzymamy jako id (`core/allergens.ts`), numery 1–14 to kolejność z rozporządzenia, nie zmieniaj jej. Formularz pozycji wysyła `allergensShown`, żeby odznaczenie wszystkich czyściło listę |
| 2026-11-12 | Claude | Wizytówka: szablon `business-card` (O nas, oferta, kontakt z mapą i godzinami), formularz kontaktowy z mailem do właściciela, zakładka „Wiadomości” w panelu, pole „O nas” w ustawieniach | PR `feat/business-card` | Formularz: ukryte pole `website` łapie boty (dostają „wysłano”, nic nie zapisujemy), limit 5/h na IP i 100/dobę na stronę, POST z obcej domeny = 403. Mail idzie przez `waitUntil`, więc błąd poczty nie psuje wysyłki formularza; wiadomość i tak jest w panelu. Mapa to link do Google Maps, bez osadzania (zero JS) |
| 2026-11-12 | Claude | SEO dla każdej strony: tytuł, opis, canonical, Open Graph, dane schema.org (`core/seo.ts`), `robots.txt`, `sitemap.xml` | PR `feat/storefront-seo` | Szablony nie budują SEO same: wstawiają gotowe `v.seo` w `<head>`. JSON-LD przez `safeJson`, żeby `</script>` w danych sprzedawcy nie zamknął tagu. Test budżetu dopuszcza tylko `<script type="application/ld+json">` |
| 2026-11-08 | Claude | Nowy wygląd panelu: arkusz `/assets/panel.css` (bez JS, tryb ciemny, telefon), ekrany logowania, stron, pozycji z miniaturami, edycji, kategorii i ustawień | PR `feat/core-catalog` | CSP panelu nie pozwala już na style inline: style tylko w `PANEL_CSS` (`panel-ui.ts`), po zmianie podbij `PANEL_CSS_VERSION`. Referrer-Policy zmieniona na `same-origin`, bo przy `no-referrer` przeglądarki wysyłały `Origin: null` i blokowały logowanie (testy tego nie łapały, wyszło na zrzutach z prawdziwej przeglądarki). Zrzuty: /mnt/project-files/panel-screens/ |
| 2026-11-08 | Claude | Miniatury zdjęć przez binding Images (`Media.variant`), weryfikacja bajtów obrazu przy uploadzie, cache rozpoznawania sklepu (`cachedTenantResolver`), test budżetu wydajności strony głównej | PR `feat/core-catalog` | Binding `IMAGES` działa lokalnie (miniflare + sharp). Testy uploadu muszą używać prawdziwego obrazu: `test/fixtures.ts`. Zmiana domeny lub sluga sklepu jest widoczna po max 60 s. Test budżetu w `test/storefront.test.ts` pilnuje braku JS i < 100 KB gzip |
| 2026-11-08 | Claude | Panel: edycja pozycji (opis, kategoria, status, zdjęcie), kategorie, ustawienia strony z logo; zdjęcia pozycji w szablonie `simple` | PR `feat/core-catalog` | Rdzeń sam pilnuje, żeby kategoria należała do tej samej strony (`Catalog.checkCategory`). Ustawienia widzi tylko rola `owner`. Pomocnik testów panelu: `test/panel-harness.ts`. Następne: miniatury zdjęć, cache rozpoznawania sklepu w KV, wygląd panelu |
| 2026-11-08 | Claude | Ustawienia strony (`core/settings.ts`), sloty modułów (`core/slots.ts`), szablony (`core/themes.ts`) i szablon `themes/simple` | PR `feat/core-catalog` | Ustawienia są walidowane przy zapisie i ponownie przy odczycie. Moduł zwracający zwykły tekst do slotu jest escapowany; HTML tylko przez `html```. Wyjątek w slocie jest logowany i pomijany. Szablon dostaje gotowe dane i `slot()`, sam nie sięga do bazy |
| 2026-11-06 | Claude | Logowanie linkiem z maila, sesje i pierwszy panel pod `panel.<domena>`; 13 testów ataków w `test/auth.test.ts` | PR `feat/core-catalog` | Zasady bezpieczeństwa w docs/SECURITY.md, czytaj przed zmianą logowania lub panelu. Lokalnie link do logowania pojawia się w konsoli `pnpm dev` (ConsoleMailer). Każda trasa panelu z `:site` musi iść przez `siteFor()`. Panel to na razie surowy HTML |
| 2026-11-06 | Claude | Rozpoznawanie sklepu po adresie (`<slug>.PLATFORM_DOMAIN` i tabela `tenant_domains`), zdjęcia w R2 (`core/media.ts`, klucze z prefiksem `tenant_id`), prosta strona główna sklepu z listą aktywnych pozycji | PR `feat/core-catalog` | Lokalnie sklep działa pod `http://<slug>.localhost:8787`. Sklep rozpoznajemy z URL żądania, nie z nagłówka Host. Strona główna to na razie surowy HTML bez szablonu; szablony w etapie 2. Rozpoznawanie sklepu warto później cache'ować w KV |
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
- [x] Sloty: fragmenty modułów wstawiane do stron sklepu (`head`, `home.top`, `home.bottom`, `item.after`, `footer`)
- [x] Ustawienia strony (opis, kontakt, godziny, kolor, logo, szablon) z walidacją
- [x] System szablonów (`defineTheme`) i szablon domyślny `simple` dla wszystkich rodzajów stron
- [x] Zapis zdjęć w R2 i serwowanie z cache (tylko właścicielowi)
- [x] Upload zdjęć z panelu (stare pliki są usuwane z R2)
- [x] Zdjęcia w kilku rozmiarach (WebP 320/640/1280, robione raz i trzymane w R2) i sprawdzanie, czy plik to naprawdę obraz
- [x] Cache rozpoznawania sklepu w pamięci (60 s, nieznane adresy 10 s)
- [x] Logowanie linkiem z maila, sesje, ochrona panelu (opis: docs/SECURITY.md)
- [x] Panel: zakładanie strony, lista, dodawanie i usuwanie pozycji
- [x] Panel: edycja pozycji, kategorie, zdjęcia, ustawienia strony i logo (tylko właściciel)
- [x] Panel: kolejność kategorii i pozycji (strzałki), zmiana nazwy i usuwanie kategorii, wyszukiwanie i filtry listy pozycji
- [x] Rozpoznawanie sklepu po adresie (subdomena i własna domena)

## Etap 2: Wizytówka

Cel: pierwszy produkt do sprzedaży, bez płatności i kurierów.

- [x] Szablon `business-card`: strona główna, oferta, kontakt, mapa, godziny otwarcia
- [x] Formularz kontaktowy z wysyłką maila i skrzynką wiadomości w panelu
- [x] Podstawowe SEO: tytuły, opisy, mapa strony, dane strukturalne firmy
- [x] Wybór kolorów, logo i tekstów w panelu (także „O nas”)
- [ ] Test z pierwszym klientem

## Etap 3: Menu QR

Cel: ten sam katalog jako karta dań dla gastronomii.

- [x] Szablon `qr-card`: kategorie dań, ceny, opisy, alergeny
- [x] Szybkie przełączanie „brak dziś” z telefonu
- [x] Generator kodu QR do druku (PNG, SVG i arkusz A4 do zapisu jako PDF)
- [ ] Kilka wersji językowych menu (opcjonalnie)

## Etap 4: Sklep mały

Cel: prawdziwe zamówienia i płatności.

- [x] Koszyk i składanie zamówienia (bez zakładania konta)
- [ ] Moduł `payments-p24` (Przelewy24 z BLIK)
- [ ] Moduł `shipping-inpost` (Paczkomaty)
- [x] Maile: potwierdzenie zamówienia, wysyłka (i inne zmiany statusu, na życzenie sprzedawcy)
- [x] Regulamin, polityka prywatności, zwroty (szablony do uzupełnienia)
- [x] Szablon `shop`: siatka produktów w kategoriach i osobna strona każdego produktu (z danymi produktu dla Google)
- [x] Panel: lista zamówień, zmiana statusu, ustawienia dostawy i numeru konta

## Etap 5: Sklep duży

Cel: wygoda przy setkach i tysiącach produktów.

- [ ] Szablon `large-catalog`: szerszy układ, głębokie kategorie
- [ ] Filtry: cena, marka, parametry (cena i sortowanie gotowe; marka i parametry razem z wariantami)
- [x] Szybka wyszukiwarka
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
