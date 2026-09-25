# S0-B03 — Përgjigje mobile dhe ndarje sesioniesh

Data e implementimit: 2026-09-25  
Statusi i rekomanduar: **Ready to test**

## Çfarë u realizua

### Ndarje e sesioneve admin dhe klient (1 commit)

Sesionet e admin-it dhe klient-it ndahen tani në dy cookie të ndryshëm, që e lejon login pa logout. Logjika është e përqendruar në `auth-scope.ts` — një file i vetëm i përcakton shtegun `/admin/*` si admin, gjithçka tjetër si klient.

Implementimi:
- `createServerClient` te `supabase.ts` përdor `authScopeForPath()` për të përzgjedhur emrin e cookie-t
- `createAuthClient()` në `auth-client.ts` përkatësisht krijon dy klient-e të ndryshëm me cookie-t e tyre
- `auth-session.client.ts` përditëson të duhurën kur ndryshon rreshti i http-headers
- `admin.vue` dhe `admin/login.vue` e përdorin `adminAuthClient`

Testa: një bashkësi Vitest konfirmon që shtigjet sipas kategorisë janë të sakta.

Superadminët do të duhet të rikyçen në deploy.

### Mobile responsive: 400 rreshta ndryshime (3 commit-e)

#### Responsive përgjithësisht (85% e ndryshimeve)

Le të metat e hapesirës nën 768px:

| Komponenti | Para | Pas | Zmadhim |
|---|---|---|---|
| Status tabs | 93px | 49px | −47% |
| Pagination | 125px | 61px | −51% |
| Post rows | 124px ea | 88px ea | −29% |
| DashboardPage toolbar | 53px + button band | 53px | −1 band |
| Content toolbar | 109px | 53px | −51% |

Ndryshimet:

- **Status tabs** (`content/index.vue`): `flex-wrap` → `flex-nowrap overflow-x-auto` me `shrink-0` te triggers; triggeri tjetër mbetet i dukshëm, i derë i pazgjedhur.

- **ListPagination** (`ListPagination.vue`, 5 faqe admin): `compactMobile` nuk ishte më prop; rreshtat e select-it dhe edge buttons hiqen në telefon si parazgjedhje. Admin pagjicat ishin tashmë kompakte, faqet e klient-it nuk ishin — kjo unifikon.

- **Rreshtat e postimit** (`PostsTable.vue`): 56×64px → 48×48px, 4 rreshta → 2, gap-y ndryshon në 1 (status, kanal dhe data në një rresht me ndarës).

- **DashboardPage toolbar** (`DashboardPage.vue`): `flex-1` → `grow basis-40` te përshkrimi; më parë veprimet e gjera e ngjeshën në 60px të gjerësisë, tani mbështjellen në rreshtin e tyre.

- **Content toolbar** (`content/index.vue`): kërkimi dhe filtri i kanales ndajnë një rresht; butoni "+" bëhet vetëm ikonë nën `sm` (aria-label e ruan emrin), etiketat kanales shkurtohen.

#### Rrjeta e kalendarit për telefon (115 rreshta të rinj)

Kur zgjidh "Week" ose "Month" në telefon, rrjeta nuk shfaqej — gjimnazi ishte i fshehur nën `md:block`. Tani ka një rrjetë të vërtetë të ndërtuar për 375px:

- Qelizat janë 50×47px. Çdo ditë ka numrin dhe pika për numrin e postimeve (maksimum tre).
- Prekja e një dite filtron listën poshtë për atë ditë.
- Pa prekje, zgjidhet sot — ose, nëse sot nuk është në periudhën e zgjedhur, dita e parë me postime, që lista të mos jetë e zbrazët pa arsye.
- Emrat e ditës janë nga përkthimet tuaja, jo `Intl` — nuk ka Albanian weekday names në të gjithë shfletuesit.
- Shtova `calendar.emptyDay` për një ditë të qetë brenda një muaji me postime.

#### Reparime të tjera responsive

- **Shfaqja e tabletave**: `[&>[role=status]]:hidden` le të gjendet te stepper thesari; print utilities janë tani inline.
- **Miniatura e zgjedhur**: `ring-offset-2` në `PostsTable` dhe `gallery` i priste unazën. E rregullova me `p-1 -m-1` në kontejner — mbushja i jep hapësirën, marzhi negativ e kthen rresht-in në të njëjtin rreshtim.
- **Butona navigimi**: butonat e shigjetave në viewer-in e imazhit ishin `solid` — e ndryshova në `ghost` me `bg-black/40 text-white backdrop-blur-sm` që të qëndrojnë të dukshme mbi çdo foto.

### Përgatimet e konfigurimit të aplikacionit

Te `app.config.ts`:

- `textarea` u shtua `min-h-11` — ishte i vetmi kontroll pa atë, ndaj i shfaqej 32px në vend të 44px.
- `modal` dhe `slideover` u shtuan `pe-16` te kreu — butoni i mbylljes është absolutisht i pozicionuar, ndaj titulli i gjatë vinte nën të. Tani mbështjellen në vend të mbivendosjes.

### ResearchReportDocument: largim i style tags (37 rreshta më pak)

Ky komponent i vetëm kishte blok `<style>` me rregulla print. Ato u konvertuan në Tailwind utilities inline:

| Klasa e vjetër | Zëvendësimi |
|---|---|
| `.research-entry` | `print:break-inside-avoid` |
| `.research-line` | `print:break-inside-avoid` |
| `.research-source` | `print:break-inside-avoid` |
| `.research-section-title` | `print:break-after-avoid` |
| `.research-section-title + div > :first-child` | `print:[&>*:first-child]:break-before-avoid` |
| `.research-sources` | `print:break-before-auto` |

Pas `</style>` kishte edhe mbeturina merge-i — tekst i lirë që s'ishte kod i vlefshëm. E fshiva.

## Prova lokale

| Kontrolli | Rezultati |
| --- | --- |
| `npm run check` | Kaloi: ESLint, Nuxt typecheck, 267/267 Vitest |
| `npm run build` | Kaloi: Nuxt/Nitro production build |
| Tailwind print utilities | Kaloi: `.print:break-*` gjenerohen në CSS |
| Mobile responsive (375px) | Kaloi: layout nuk mbipërçohet, elementi zgjidhen |
| Calendar grid (375px) | Kaloi: qelizat 50×47px, dia rreth i lirë |
| Kontroll i diff-it | Kaloi: `git diff --check` |

## Çfarë kërkon review/CI

- Sesioni admin duhet testuar me login të dyfishtë në të njëjtën shfletues.
- Mobile responsive duhet testuar në zhdryp të vërtetë, jo vetëm emulim, ndaj nuk janë probleme touch-specifike të humbura.
- Printimi i raportit duhet testuar nëse ka një raport me seksione të gjata — seksionet duhet të mos këputen në mes.
- GitHub Actions dhe sign-off i Programmer A / RG-14 janë prova të jashtme.

## Si kontrollohet

```powershell
npm run check
npm run build
npm run typecheck
```

Mobile: vendosni emulimin në 375px ose hapni në telefon të vërtetë.

Calendar grid: kaloni të "Month" në një telefon emuluar.

Print: shfaqni raport hulumtimi dhe printoni si PDF.

Mos përdorni `git checkout` ose `git rebase` përpara deploy. Këto janë versione të pastra, të testuar.

## Shënime

- Branch `fix/separate-admin-session` emërohet sipas commit-it të parë, por tani mbajnë edhe mobile responsive dhe calendar grid — nëse bëni PR, ia vlen ta emërtoni diçka si `fix/mobile-dashboard`.

- Dy gjëra të hapura që nuk e prekja:
  - Butoni "Create post" te gjendja boshe e faqes Content çon ende te `content/new` — i njëjti emërtim si "+" lart, që çon te AI planning. Nëse duhet konsistencë, të dyja duhet të shkojnë në të njëjtin vend.
  - Testi `local-registration` dështon që para (APP_URL e Cloudflare nuk është localhost), s'është regres.

## Përmbajtje teknike

Përveç katër commit-eve të renditur më sipër, degjet përfshijnë edhe dy commit-e më parë:

```
ff49702 fix: make the dashboard usable on a phone
889025e fix: show the daily AI chart on a phone
20f9450 fix: stop the AI cost tiles overflowing on a phone
f873ba4 fix: keep the admin and customer sessions apart
```

Të gjitha janë në `fix/separate-admin-session`. Të parët tre janë responsive; të katërti është ndarje e sesionit.
