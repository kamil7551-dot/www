# INSTRUCTIONS.md

Jak pracujemy nad projektem. Napisane dla Kamila, prostym językiem.
Zasady techniczne dla agentów są w [AGENTS.md](AGENTS.md), plan w [ROADMAP.md](ROADMAP.md).

## Kto co robi

- **Kamil** mówi, co budujemy i w jakiej kolejności, testuje efekty i decyduje o wdrożeniu.
- **Claude** pilnuje rdzenia, rozpisuje zadania, sprawdza każdą zmianę i łączy ją z główną wersją.
- **Cursor** (i inni agenci) buduje moduły i szablony w małych porcjach.

## Jak wygląda jedna zmiana

1. Wybieramy zadanie z ROADMAP.md.
2. Agent tworzy osobną gałąź, czyli kopię roboczą, i robi w niej jedną małą rzecz.
3. Agent otwiera Pull Request (PR), czyli prośbę o dołączenie zmiany, z opisem po ludzku.
4. Automatyczne testy sprawdzają, czy nic się nie zepsuło.
5. Claude przegląda zmianę. Jeśli jest dobra, łączy ją z główną wersją (merge). Jeśli nie, opisuje, co poprawić.
6. Zadanie w ROADMAP.md zostaje odhaczone.

Główna gałąź `main` zawsze ma działać. Nikt nie wrzuca tam zmian bezpośrednio, poza tym pierwszym startowym commitem.

## Jak dać zadanie Cursorowi

Otwórz repozytorium w Cursorze i napisz mniej więcej tak:

> Przeczytaj AGENTS.md. Zrób zadanie z ROADMAP.md: „Moduł shipping-inpost (Paczkomaty)”. Jedna gałąź, jeden PR, z testami. Nie zmieniaj plików w core/.

Im węższe zadanie, tym lepiej. Jeden moduł albo jedna funkcja na raz.
Gdy PR jest gotowy, daj znać Claude w wątku projektu albo wklej link do PR.

## Czego nie robimy

- Nie wdrażamy na Cloudflare bez Twojej zgody.
- Nie trzymamy haseł ani kluczy w repozytorium.
- Nie łączymy dużych zmian naraz. Duże zadanie dzielimy na kilka małych PR-ów.
- Nie dodajemy ciężkich bibliotek, które spowalniają stronę klienta.

## Wdrożenie (później)

Gdy etap jest gotowy i przetestowany, Claude przygotuje listę kroków wdrożenia na Twoje konto Cloudflare: bazę D1, magazyn R2, KV i samego Workera.
Wdrożenie rusza dopiero po Twoim „ok”.
