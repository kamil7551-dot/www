# Wersja dev (testowa)

Jeden Worker `www-dev` na adresie `https://www-dev.<konto>.workers.dev`. Nie potrzebuje D1, R2, domeny ani dostawcy maili:

| Produkcja | Dev |
|---|---|
| D1 | baza SQLite w Durable Object `DevDatabase` (`apps/worker/src/dev/database.ts`), te same migracje |
| R2 | zdjęcia w KV `DEV_MEDIA` (`apps/worker/src/dev/media.ts`) |
| `panel.<domena>`, `<firma>.<domena>` | `/panel/…`, `/s/<firma>/…` (`apps/worker/src/hosts.ts`) |
| link do logowania mailem | e-mail + hasło testowe (sekret `DEV_LOGIN_PASSWORD`) |
| wszystkie rodzaje stron | `SITE_KINDS`: wizytówka i menu QR (sklep wyłączony) |

Wszystko na dev ma `X-Robots-Tag: noindex`. Zdjęcia nie są skalowane (brak bindingu Images), strony dostają oryginał.

## Wdrożenie (konto Kamila)

Potrzebny token Cloudflare z prawem do Workers Scripts i Workers KV. D1 i R2 nie są potrzebne.

```sh
export CLOUDFLARE_ACCOUNT_ID=<id konta>
# 1. Raz: magazyn na zdjęcia. Wpisz zwrócone id do wrangler.dev.jsonc (kv_namespaces[0].id).
npx wrangler kv namespace create www-dev-media
# 2. Wdrożenie (za każdym razem, z gałęzi main):
pnpm install --frozen-lockfile
npx wrangler deploy -c wrangler.dev.jsonc
# 3. Raz: hasło testowe do panelu (losowe, min. 16 znaków). Podaj je Kamilowi.
openssl rand -base64 18 | npx wrangler secret put DEV_LOGIN_PASSWORD -c wrangler.dev.jsonc
```

Adres: `https://www-dev.<subdomena konta>.workers.dev/panel/`. Bez hasła testowego panel pokazuje zwykłe logowanie mailem, które na dev nie działa (brak `RESEND_API_KEY`), czyli nikt się nie zaloguje.

## Zasady

- Dev to dane testowe. Hasło testowe pozwala zalogować się na dowolny e-mail, więc nie trzymamy tam prawdziwych danych klientów.
- Zmiana migracji: `pnpm dev:migrations` (CI sprawdza, czy `apps/worker/src/dev/migrations.ts` jest aktualny).
- Testy dev: `test-dev/`, uruchamiane przez `pnpm test`.
