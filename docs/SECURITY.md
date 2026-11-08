# Bezpieczeństwo panelu i logowania

Opis dla ludzi i agentów. Każda zmiana w `core/auth.ts`, `apps/worker/src/panel.ts` albo w tym pliku wymaga przeglądu Claude i testów w `test/auth.test.ts`.

## Logowanie linkiem z maila

1. Sprzedawca wpisuje e-mail. Dostaje link ważny **15 minut**, działający **raz**.
2. W bazie trzymamy tylko **skrót SHA-256** tokenu. Wyciek bazy nie daje działających linków.
3. Otwarcie linku pokazuje tylko przycisk „Zaloguj mnie”; logowanie dzieje się dopiero po jego kliknięciu (POST). Skanery poczty, które same otwierają linki, nie zużyją go i nikogo nie zalogują.
4. Zużycie tokenu jest atomowe (`UPDATE … WHERE used_at IS NULL … RETURNING`), więc dwa równoczesne kliknięcia nie dadzą dwóch sesji.
5. Po zalogowaniu wszystkie inne niewykorzystane linki dla tego adresu przestają działać.
6. Odpowiedź na „wyślij link” jest **identyczna** dla każdego adresu (istniejącego, błędnego, zablokowanego limitem). Nie da się sprawdzić, kto ma konto.
7. Limity: najwyżej **3 linki na adres** i **10 na adres IP** w ciągu 15 minut. IP zapisujemy tylko jako skrót.

## Sesje

- Ciasteczko `__Host-sid`: `Secure`, `HttpOnly`, `SameSite=Lax`, bez domeny (prefiks `__Host-` to wymusza). JavaScript go nie odczyta, inna subdomena go nie podmieni.
- W bazie tylko skrót SHA-256 wartości ciasteczka.
- Sesja wygasa po **30 dniach** bez użycia i po **90 dniach** w każdym przypadku. Wylogowanie usuwa ją z bazy, więc skradzione ciasteczko przestaje działać.
- `destroyAllSessions` wylogowuje użytkownika ze wszystkich urządzeń.

## Panel

- Panel działa **tylko** pod `panel.<domena platformy>`. Ciasteczka sprzedawcy nigdy nie trafiają na domeny sklepów.
- Każdy POST musi mieć nagłówek `Origin` równy adresowi panelu (ochrona przed CSRF). Brak nagłówka = odmowa.
- Nagłówki: ścisłe CSP (zero skryptów, brak osadzania w ramkach), `Referrer-Policy: same-origin` (token z linku nie wycieknie na zewnątrz, a formularze panelu dalej wysyłają prawdziwy nagłówek `Origin`; przy `no-referrer` przeglądarki wysyłają `Origin: null` i blokowałyby logowanie), `no-store`, HSTS, `nosniff`.
- Dostęp do strony klienta zawsze przez `membership(user, tenant)`. Cudza strona zwraca 404, a nie 403, żeby nie zdradzać, że istnieje.
- Subdomeny zarezerwowane dla platformy (`panel`, `www`, `api`, `admin` i inne w `RESERVED_SLUGS`) nigdy nie trafią do klienta.

## Testy, które próbują to obejść

`test/auth.test.ts`: ponowne użycie linku, wygasły link, stare linki po logowaniu, wyliczanie kont, limity, sfałszowane i skradzione ciasteczko, CSRF, dostęp do cudzej strony (podgląd, dodanie, usunięcie), zarezerwowane subdomeny, nagłówki.

## Do zrobienia przed startem produkcyjnym

- Dostawca maili (domyślnie Resend, klucz przez `wrangler secret put RESEND_API_KEY`) i rekordy SPF/DKIM dla domeny.
- Reguła Cloudflare WAF / Rate Limiting na `POST /login` jako druga warstwa limitów.
- Dziennik zdarzeń bezpieczeństwa (logowania, wylogowania ze wszystkich urządzeń) widoczny dla sprzedawcy.
- Opcjonalnie: klucze dostępu (passkeys) jako drugi sposób logowania.
