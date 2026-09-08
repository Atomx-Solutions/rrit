# Gjendja e platformës

Data e rishikimit: 2026-09-08. Scope-i aktiv është produkti për postime për bizneset në Kosovë, sipas [PRODUCT-SCOPE.md](PRODUCT-SCOPE.md). Burimi i statusit formal mbetet backlog-u Excel; ky dokument shpjegon vetëm gjendjen aktuale të kodit.

## Çfarë funksionon lokalisht

| Pjesa | Gjendja aktuale |
| --- | --- |
| Aplikacioni | Nuxt 4, Nuxt UI 4, TypeScript strict, SSR dhe dashboard responsiv |
| Të dhënat | PostgreSQL real me migrime të versionuara; të dhënat e workspace-it lexohen/shkruhen nga API-të Nitro |
| Identiteti | BetterAuth me sesione të sigurta, regjistrim dhe hyrje; verifikimi me email mund të çaktivizohet lokalisht |
| Trial | Politikë 72-orëshe me pretendim idempotent dhe kontrolle për email, identitet Meta dhe pajisje |
| Onboarding | Krijimi i biznesit, profili i biznesit, lidhja opsionale me Meta dhe rruga deri te postimi i parë |
| Postimet | Listë me pagination, draftim, validim, miratim, planifikim manual dhe rikthim të postimeve të dështuara |
| Facebook/Instagram | OAuth, zgjedhja e faqes, importi i historikut dhe provider publishing janë implementuar; prova reale kërkon Meta App dhe llogari të miratuara |
| Media | Ngarkim privat, validim server-side, URL të nënshkruara, raport natyral në preview dhe tërheqje e enforce-ueshme e të drejtave |
| AI | Gjenerim përmes shërbimit të konfiguruar, quota dhe ledger monetar reserve/commit/release me hard budget |
| Operimi | Health liveness/readiness, retention maintenance, worker publikimi dhe reconciliation pa ridërgim të verbër |
| Çmimet | Katalog/limits të tipizuara në PostgreSQL dhe EUR; usage snapshot vjen nga serveri |

Rrugët e vjetra për kampanja dhe strategji janë të shtyra dhe ridrejtojnë te postimet. Runtime-i nuk ofron llogari demo ose të dhëna demo si zëvendësim për databazën.

## Kufijtë e provuar

Kontrollet aktuale lokale përfshijnë 52 teste unit/integration, lint të plotë, clean install/typecheck/build në Node 24, migrimet nga databazë bosh deri te `0017_publication_logical_keys.sql`, container smoke për web/worker dhe 14 teste browser kundër artefaktit production në desktop/mobile. Shiko [VALIDATION.md](VALIDATION.md) për rezultatet e ekzekutuara.

Kjo provë nuk mbyll ende release-in enterprise. Ende kërkohen Meta App Review dhe test me llogari reale jo-developer, CI i hostuar me required checks/branch protection, testet e ngarkesës dhe rikthimit, siguria/tenant-isolation e audituar, WebKit/Firefox/pajisje reale, monitorimi i prodhimit, UAT dhe miratimet ligjore/komerciale. Për secilin task, kolona `AA` në Excel tregon çfarë mungon dhe `AB–AC` dallojnë provën e kërkuar nga ajo e ekzekutuar.

## Si rishikohet

- `/` — faqja publike
- `/auth/signup` — regjistrimi
- `/onboarding` — konfigurimi i biznesit
- `/app` — dashboard-i privat
- `/api/health/live` — procesi është aktiv
- `/api/health/ready` — databaza dhe migrimi i kërkuar janë gati

Vendimi aktual i arkitekturës është [ADR-002-production-modular-monolith.md](adr/ADR-002-production-modular-monolith.md). Dokumenti i vjetër demo ruhet vetëm si histori dhe është shënuar `Superseded`.
