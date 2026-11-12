# www

Lekka platforma do stawiania sklepów, wizytówek i menu QR na Cloudflare Workers.

- Zasady dla agentów: [AGENTS.md](AGENTS.md)
- Plan i dziennik prac: [ROADMAP.md](ROADMAP.md)
- Jak pracujemy: [INSTRUCTIONS.md](INSTRUCTIONS.md)

## Uruchomienie lokalne

```sh
pnpm install
pnpm db:migrate:local   # lokalna baza D1
pnpm dev                # http://localhost:8787
```

Sprawdzenia przed PR: `pnpm typecheck && pnpm lint && pnpm test`.
