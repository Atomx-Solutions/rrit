# S0-B02 — Sistemi i përbashkët i dizajnit

Data e implementimit: 2026-09-09  
Statusi i rekomanduar: **In Review**

## Çfarë u realizua

- U vendos një kontratë e vetme tokenash `--rrit-*` në `apps/web/app/assets/css/main.css` për ngjyrat semantike, tipografinë, hapësirën, radius, hijet dhe motion.
- Janë definuar vlera light dhe dark për UI-në e dashboard-it dhe për UI-në e landing page-it.
- Landing page ruan dizajnin e aprovuar. Ngjyrat e zakonshme (sfond, tekst, kufij, CTA dhe footer) marrin vlerat nga tokenat; ngjyrat/gradientët e ilustrimeve mbeten lokale sepse janë art-direksion, jo UI e ripërdorshme.
- `app.config.ts` ekspozon politikën e dizajnit: Nuxt UI v4 është sistemi primar, ikonat janë `i-lucide-*`, dhe wrapper-at RRIT lejohen vetëm për kompozim produkti ose prezantim të markës.
- U shtuan teste Vitest për kontratën e tokenave dhe testet Playwright tani verifikojnë light dhe dark mode për faqet publike, auth dhe dashboard shell.

## Prova lokale

| Kontrolli | Rezultati |
| --- | --- |
| `npm.cmd run check` | Kaloi: toolchain, ESLint, Nuxt typecheck dhe 27/27 Vitest unit tests |
| `npm.cmd run build` | Kaloi: Nuxt/Nitro production build |
| Playwright landing desktop | Kaloi: 13/13 teste, përfshirë baseline të aksesueshmërisë light/dark |
| Kontroll i diff-it | `git diff --check` kaloi |

## Çfarë kërkon review/CI

- Dashboard accessibility test krijon llogari dhe business sintetik; duhet të ekzekutohet vetëm në ambientin e dedikuar të testimit/CI, jo kundër Supabase v1.
- GitHub Actions dhe sign-off i Programmer A / RG-14 janë prova të jashtme. Pa to ticket-i nuk duhet të shënohet `Done`.

## Si kontrollohet

```powershell
npm.cmd run check
npm.cmd run build
npm.cmd run test:e2e --workspace apps/web -- --project=desktop tests/e2e/landing.spec.ts
```

Mos përdor `supabase db push` për këtë task. Ky task nuk ndryshon skemën apo të dhënat në Supabase.
