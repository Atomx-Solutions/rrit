# Handoff për dy programerët

Data: 2026-09-08. Burimi i punës është workbook-u `AI_Marketing_Platform_Engineering_Master_Backlog_2_Developers_v1.1.xlsx`, sidomos sheet-i `16_HANDOFF_2_DEV`. Ky sheet përmban 150 task-e aktive; 35 task-et `Deferred` mbeten jashtë scope-it posts-only.

## Gjendja e verifikuar

| Gjendja | Task-e |
| --- | ---: |
| Kryer në kod, pret pranim/gate | 23 |
| Pjesërisht, kërkon zhvillim | 90 |
| Pa filluar | 35 |
| Bllokuar nga varësi e jashtme | 2 |
| Shtyrë nga scope-i aktual | 35 |
| Done me të gjitha gates | 0 |

`In Review` do të thotë se scope-i i implementimit të rreshtit gjendet në kod. Task-u kalon në `Done` vetëm pasi acceptance criteria, prova e kërkuar dhe release gate i atij rreshti të kalojnë. `In Progress` do të thotë se mungon ende kod ose sjellje funksionale; nuk është vetëm punë testimi.

## Ndarja aktuale

| Pronari | Aktive | In Review | In Progress | Pa filluar | Blocked |
| --- | ---: | ---: | ---: | ---: | ---: |
| Programmer A | 73 | 11 | 36 | 24 | 2 |
| Programmer B | 77 | 12 | 54 | 11 | 0 |

Programmer A duhet të marrë backend-in, databazën, sigurinë, worker-in, Meta/AI adapters, billing lifecycle dhe operimet. Programmer B duhet të marrë Nuxt UI/UX, auth/onboarding, galerinë, editorin, kalendarin, billing UX, accessibility, performance dhe E2E. Owner/reviewer-i ekzistues ruhet në kolonën `AJ`.

## Rendi i punës

1. Mbyllni 23 task-et `In Review` duke ekzekutuar provën dhe gate-in në kolonat `AB`, `AC` dhe `AG`; mos rishkruani implementimin pa gjetje konkrete.
2. Për 90 task-et `In Progress`, filloni nga `P0`, ndiqni hapin në kolonën `AH` dhe përditësoni `Z`, `AA`, `AC` dhe `AD` në të njëjtin ndryshim.
3. Mos filloni task `Blocked` pa Meta App/kredencialet ose veprimin e pronarit të shënuar në rresht.
4. Mbani 35 task-et `Deferred` jashtë release-it posts-only derisa scope-i të ndryshojë me vendim të dokumentuar.
5. Shënoni `Done` vetëm kur kriteri, prova dhe gate-i i rreshtit janë kaluar dhe evidenca mund të riekzekutohet.

Auditimi makinerik, inventari me hash-e dhe të 185 rekordet gjenden në `docs/backlog-code-handoff-2026-09-08.json`.
