# Qëllimi dhe funksionalitetet e aplikacionit Framic

Ky dokument përshkruan **çfarë bën kodi aktual** i aplikacionit. Përshkrimi bazohet në faqet e përdoruesit, komponentët dhe API-të në `apps/web`; nuk është listë funksionesh të planifikuara.

## Qëllimi

Framic është hapësirë pune për bizneset që duan të përgatisin përmbajtje për rrjetet sociale. Biznesi ruan informacionin e markës dhe materialet vizuale, krijon ose gjeneron postime, i kontrollon, i miraton dhe i planifikon. Kur integrimet janë aktive, aplikacioni mund të marrë historikun social dhe të dërgojë përmbajtje në platformat e lidhura. Një panel i veçantë u shërben administratorëve për organizatat, paketat dhe operimin e platformës.

## Çfarë mund të bëjë përdoruesi i biznesit

### 1. Të krijojë llogari dhe hapësirë pune

- Të regjistrohet, të hyjë, të verifikojë emailin dhe të rikuperojë fjalëkalimin.
- Të përfundojë konfigurimin fillestar të biznesit.
- Të përdorë një organizatë dhe markat e saj, sipas qasjes që i është dhënë.
- Të ndryshojë cilësimet e profilit dhe të hapësirës së punës.

**Prova në kod:** `app/pages/signup.vue`, `login.vue`, `verify-email.vue`, `forgot-password.vue`, `onboarding.vue`, `app/[org]/[brand]/settings.vue`; API-të `server/api/v1/organizations/`, `organizations/[organizationId]/brands/` dhe `invitations/`.

### 2. Të përshkruajë biznesin dhe markën

- Të ruajë përshkrimin, objektivat dhe informacionin e markës.
- Të shtojë e përditësojë oferta dhe fakte të biznesit.
- Të përdorë Business Brain dhe historikun e ndryshimeve si kontekst për krijimin e përmbajtjes.

**Prova në kod:** `app/pages/app/[org]/[brand]/brand.vue`, `app/components/BusinessBrainEditor.vue`, `BusinessBrainHistory.vue`; API-të `server/api/organizations/[organizationId]/brands/[brandId]/business-brain.*`, `facts/` dhe `offers/`.

### 3. Të menaxhojë fotografi dhe materiale

- Të ngarkojë, shikojë, shkarkojë dhe fshijë materiale nga galeria private.
- Të ndryshojë të dhënat e materialit dhe të menaxhojë konfirmimin e të drejtave të përdorimit.
- Të përdorë fotografitë si burim për postime dhe gjenerim me AI.

**Prova në kod:** `app/pages/app/[org]/[brand]/gallery.vue`, `app/components/PhotoUpload.vue`; API-të `server/api/media/`.

### 4. Të krijojë dhe kontrollojë postime

- Të krijojë dhe redaktojë postime në Content Studio, me ruajtje automatike.
- Të zgjedhë kanal, tekst dhe media; të përdorë ndihmën AI për përmbajtje kur është e konfiguruar.
- Të kalojë postimin në rishikim, ta validojë dhe ta miratojë.
- Të vendosë datë në kalendar, të publikojë menjëherë kur lejohet, dhe të kontrollojë statusin e publikimit.
- Të përgatisë, renderojë dhe rishikojë video, përfshirë muzikën dhe rrjedhën e ngarkimit në TikTok kur kushtet plotësohen.

**Prova në kod:** `app/components/ContentEditor.vue`, `CreativeEditor.vue`, `CaptionAssistant.vue`, `app/pages/app/[org]/[brand]/content/`, `calendar.vue`; API-të `server/api/posts/[id]/validate.post.ts`, `quality.*`, `publish.post.ts`, `publication.get.ts`, `video*.ts` dhe `tiktok-upload.post.ts`.

### 5. Të kërkojë plan mujor me AI

- Të zgjedhë muajin, sasinë e postimeve dhe videove, kanalet, fotografitë dhe opsionet e muzikës për video.
- Të përgatisë ose gjenerojë planin, ta ndalë, ta rifillojë ose ta rivendosë.
- Të shohë hulumtimin, strategjinë, rezultatet dhe raportin mujor; raporti mund të shkarkohet si PDF.
- Të vendosë vetë për draftet e krijuara. Gjenerimi nuk i miraton ose publikon automatikisht.

**Prova në kod:** `app/pages/app/[org]/[brand]/monthly-planner.vue`, `monthly-report.vue`, `app/components/MonthlyPlannerPanel.vue`, `PlannerRequestModal.vue`; API-të `server/api/ai/monthly-plan.get.ts`, `monthly-plan.post.ts` dhe `monthly-report.pdf.get.ts`.

### 6. Të lidhë rrjetet sociale dhe të shohë historikun

- Të lidhë ose shkëputë Facebook/Instagram dhe TikTok kur kredencialet e platformës janë konfiguruar.
- Të sinkronizojë e shohë postimet e importuara dhe gjendjen e lidhjeve.
- Të përdorë lidhjet aktive për publikim, sipas kufizimeve të platformës dhe konfigurimit të serverit.

**Prova në kod:** `app/pages/app/[org]/[brand]/social-posts.vue`, `app/components/SocialConnections.vue`, `InstagramConnection.vue`, `TikTokConnection.vue`; API-të `server/api/meta/`, `instagram/` dhe `tiktok/`.

### 7. Të ndjekë përdorimin dhe paketën

- Të shohë trial-in, kuotat, kreditë dhe informacionin e paketës.
- Të dërgojë kërkesa për postime, video, kredite ose paketë të personalizuar.
- Të shohë dhe të përgjigjet ndaj një propozimi pakete sipas rrjedhës së disponueshme.

**Prova në kod:** `app/pages/app/[org]/[brand]/billing.vue`, `app/components/PackageRequestForm.vue`; API-të `server/api/trial.get.ts`, `usage.get.ts`, `billing/package-request.post.ts` dhe `package-requests.post.ts`.

## Çfarë mund të bëjë administratori

Paneli `/admin` është i mbrojtur për superadministratorë. Ai përfshin pamje për organizata, përdorues, ftesa, abonime, paketa, kërkesa, fatura, pagesa të regjistruara, feedback, muzikë, kosto AI, auditim dhe cilësime. Administratori mund të menaxhojë paketat e organizatave dhe propozimet për klientët.

**Prova në kod:** `app/pages/admin/`, middleware `superadmin`, API-të `server/api/admin/`.

## Kushtet dhe kufijtë realë

- Funksionet e llogarisë dhe të dhënave kërkojnë Supabase Auth dhe databazën. API-ja `/api/capabilities` raporton gatishmërinë e konfigurimit.
- Planifikuesi mujor me AI kërkon `AI_MONTHLY_PLANNER_ENABLED=true`, ofruesin/modelin AI, çmimet dhe worker-in përkatës. Pa këto, funksioni nuk është operativ.
- Importi social kërkon kredencialet e platformës. Publikimi kërkon lidhje të autorizuar dhe `PUBLISHING_ENABLED=true`.
- Ndryshimi direkt i abonimit nga klienti është i bllokuar në server: `server/api/billing/subscription.post.ts` kthen `403` përmes `clientSelfServiceDisabled()`. Kërkesat e klientit trajtohen nga administratori.
- Pagesat Paddle varen nga `PADDLE_ENABLED` dhe konfigurimi i Paddle; prania e faqes së pagesës nuk do të thotë se checkout është aktiv në çdo instalim.

**Referencat kryesore:** `server/api/capabilities.get.ts`, `server/utils/monthly-ai.ts`, `server/plugins/publisher.ts`, `server/utils/client-billing-policy.ts`, `server/utils/paddle.ts` dhe [konfigurimi shembull](../.env.example).
