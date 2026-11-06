# AGENTS.md

Zasady dla każdego agenta AI pracującego w tym repozytorium (Claude, Cursor i inni).
Przeczytaj w całości przed pierwszą zmianą. Jeśli coś tu jest sprzeczne z poleceniem w zadaniu, zapytaj, zamiast zgadywać.

## Czym jest ten projekt

Lekka platforma do stawiania **sklepów, wizytówek i menu QR** na Cloudflare.
Grupa docelowa: mali i zaczynający sprzedawcy w Polsce (IT, drobne produkty, usługi, gastronomia).
Wyróżnik: prostota, prędkość i wygoda. Każda decyzja techniczna, która spowalnia stronę klienta albo komplikuje panel, wymaga uzasadnienia.

Jeden silnik, cztery rodzaje stron: wizytówka, menu QR, sklep mały, sklep duży.
Wszystkie korzystają z tego samego katalogu pozycji; różnią się włączonymi modułami i układem.

Plan prac: [ROADMAP.md](ROADMAP.md). Sposób współpracy: [INSTRUCTIONS.md](INSTRUCTIONS.md).

## Role

| Kto | Rola |
| --- | --- |
| Kamil (właściciel) | Decyzje produktowe, priorytety, zgoda na wdrożenie do Cloudflare |
| Claude | Architekt i strażnik rdzenia: projektuje rdzeń, pisze zadania, przegląda i merguje PR-y |
| Cursor i inni agenci | Implementują moduły, szablony i poprawki w małych, atomowych PR-ach |

Agent wykonujący nie merguje własnych PR-ów. Nikt nie wdraża na Cloudflare bez wyraźnej zgody Kamila.

## Stos technologiczny

- **Cloudflare Workers** (z Static Assets) jako jedyne środowisko uruchomieniowe. Brak własnych serwerów.
- **TypeScript** w trybie `strict`.
- **Hono** jako router, renderowanie HTML po stronie serwera (Hono JSX). Domyślnie zero JS po stronie klienta; małe wyspy JS tylko tam, gdzie to konieczne (koszyk, filtry).
- **D1** (SQLite): produkty, zamówienia, klienci, ustawienia modułów. Migracje SQL w `migrations/` przez `wrangler d1 migrations`.
- **KV**: cache gotowych fragmentów stron i ustawienia czytane przy każdym żądaniu.
- **R2**: zdjęcia, pliki do pobrania (produkty cyfrowe), kopie zapasowe.
- **Durable Objects**: dopiero gdy potrzebna jest spójność przy równoczesnych operacjach (rezerwacja ostatniej sztuki, koszyk).
- **Vitest** z `@cloudflare/vitest-pool-workers` do testów.
- **pnpm** jako menedżer pakietów.

Nowa zależność npm wymaga uzasadnienia w opisie PR (rozmiar, czy działa na Workers, alternatywa bez niej).

## Wielu klientów (multi-tenant)

W MVP wszystkie sklepy działają w jednej instalacji i jednej bazie D1.
**Każda tabela z danymi klienta ma kolumnę `tenant_id`**, a każde zapytanie filtruje po niej. Zapytanie bez `tenant_id` to błąd krytyczny.
Dostęp do bazy tylko przez warstwę danych rdzenia, która dokłada `tenant_id` automatycznie. Dzięki temu później można rozdzielić klientów na osobne bazy bez przepisywania modułów.

## Struktura repozytorium (docelowa)

```
apps/worker/        punkt wejścia Workera, łączy rdzeń, moduły i szablony
core/               rdzeń: katalog, zamówienia, klienci, szablony, szyna zdarzeń, rejestr modułów
modules/<id>/       jeden katalog = jeden moduł (np. payments-p24, shipping-inpost, qr-menu)
themes/<id>/        układy i style stron (np. simple, large-catalog, qr-card, business-card)
migrations/         migracje D1 rdzenia
docs/               dokumentacja techniczna
```

## Kontrakt modułu

Moduł to katalog w `modules/<id>/` z plikiem `module.ts`, który eksportuje opis modułu:

```ts
export default defineModule({
  id: "shipping-inpost",          // kebab-case, unikalne, nie zmienia się nigdy
  name: "InPost Paczkomaty",
  version: "0.1.0",
  requires: [],                   // id innych modułów, jeśli są potrzebne
  settings: { /* schemat ustawień widocznych w panelu */ },
  migrations: [ /* własne tabele modułu */ ],
  hooks: {                        // reakcje na zdarzenia rdzenia
    "order.paid": async (event, ctx) => { /* ... */ },
  },
  admin: [ /* ekrany w panelu sprzedawcy */ ],
  slots: { /* fragmenty wstawiane do sklepu, np. "checkout.shipping" */ },
  routes: [ /* własne adresy, np. webhook od bramki płatności */ ],
});
```

Zasady modułów:

1. Moduł rozmawia z rdzeniem **tylko** przez `ctx` (API rdzenia) i zdarzenia. Nie importuje plików z `core/` poza publicznym `core/sdk` i nie importuje innych modułów.
2. Własne tabele modułu mają prefiks `mod_<id>_` (myślniki zamienione na `_`) i kolumnę `tenant_id`.
3. Moduł musi dać się wyłączyć bez psucia sklepu. Błąd w hooku modułu jest logowany i nie przerywa zamówienia.
4. Moduł dodaje do strony klienta jak najmniej JS i CSS. Każdy dodany JS podaj w opisie PR (rozmiar po gzip).
5. Teksty widoczne dla użytkownika idą przez pliki tłumaczeń (`pl` jako pierwszy język), nie są wpisane na sztywno.

Zdarzenia rdzenia (lista będzie rosła, zmiany tylko przez PR do rdzenia):
`product.created`, `product.updated`, `product.deleted`, `order.created`, `order.paid`, `order.shipped`, `order.cancelled`, `customer.created`, `page.render`.

## Budżet wydajności strony klienta

- Strona główna i strona produktu: łącznie poniżej 100 KB (gzip) bez zdjęć.
- JS: domyślnie 0 KB; strona z koszykiem lub filtrami maksymalnie 15 KB (gzip).
- Lighthouse mobile: wydajność co najmniej 95.
- Zdjęcia zawsze w odpowiednim rozmiarze, leniwe ładowanie poniżej pierwszego ekranu.

PR, który przekracza budżet, nie zostanie zmergowany bez zgody Kamila.

## Zasady pracy z kodem

- Kod, nazwy, komentarze i komunikaty commitów po angielsku. Teksty dla użytkowników po polsku (przez tłumaczenia). Dokumenty dla Kamila po polsku.
- Jeden PR = jedna atomowa zmiana (jeden moduł, jedna funkcja albo jedna poprawka). Celuj w mniej niż 300 zmienionych linii.
- Gałęzie: `feat/<obszar>-<krótki-opis>`, `fix/<obszar>-<krótki-opis>`, `docs/<opis>`. Obszar to `core`, `module-<id>`, `theme-<id>` albo `infra`.
- Commity w stylu Conventional Commits: `feat(module-inpost): add locker picker`.
- Każdy PR zawiera testy dla nowej logiki i przechodzi: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Zmiany w `core/`, `migrations/` i `AGENTS.md` wymagają przeglądu Claude jako architekta. W opisie PR zaznacz, że dotyka rdzenia.
- Żadnych sekretów w repozytorium. Klucze API tylko przez `wrangler secret`.
- Nie zmieniaj nazw ani znaczenia istniejących zdarzeń, kolumn i id modułów; dodawaj nowe obok.

## Opis PR

Każdy PR odpowiada w opisie na pytania:

1. Co się zmienia i dlaczego (jedno zdanie dla Kamila, prostym językiem).
2. Którego zadania z ROADMAP.md dotyczy.
3. Jak to sprawdzono (testy, ręczne kroki).
4. Wpływ na wydajność strony klienta (JS/CSS dodany, nowe zapytania do bazy).
5. Czy dotyka rdzenia lub migracji.
