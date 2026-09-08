<script setup lang="ts">
defineProps<{ kind: 'privacy' | 'terms' | 'security' }>()
const { data: site } = await useFetch('/api/site')
const titles = {
  privacy: 'Privatësia dhe të dhënat',
  terms: 'Përdorimi i shërbimit',
  security: 'Siguria e llogarisë',
}
</script>
<template>
  <section class="public-section max-w-3xl">
    <h1 class="mb-8">{{ titles[kind] }}</h1>
    <div class="space-y-6 text-sm leading-7">
      <template v-if="kind === 'privacy'"
        ><h2>Të dhënat që përdoren</h2>
        <p>
          Llogaria përmban emrin, emailin, sesionet dhe profilin e biznesit. Postimet dhe
          fotografitë ruhen në server. Formularët e papërfunduar mund të ruhen në sesionin e skedës
          për rikuperim.
        </p>
        <h2>Lidhja me Meta</h2>
        <p>
          Me autorizimin tënd, Rrit lexon faqet ku ke qasje dhe postimet e llogarisë së zgjedhur.
          Autorizimet ruhen të enkriptuara në server. Shkëputja te Postimet nga rrjetet heq
          autorizimin e ruajtur dhe postimet e importuara nga Rrit. Mund ta heqësh gjithashtu qasjen
          nga cilësimet e integrimeve në Meta.
        </p>
        <h2>Trial-i falas</h2>
        <p>
          Për të kufizuar përsëritjen e trial-it, ruhen gjurmë HMAC të emailit të verifikuar dhe
          identiteteve të Meta-s, si dhe një cookie e nënshkruar e pajisjes me afat njëvjeçar. Kjo
          cookie është identifikues i shfletuesit, jo identifikues fizik i pajisjes. Gjurmët e
          përdorimit të trial-it ruhen edhe pas shkëputjes së rrjeteve.
        </p>
        <h2>Fotografitë</h2>
        <p>
          Serveri heq metadata-t e fotografive gjatë ngarkimit. Gjatë publikimit, Meta merr një
          lidhje të nënshkruar me vlefshmëri deri në 15 minuta për fotografinë e zgjedhur.
        </p>
        <h2>Eksporti dhe kërkesat</h2>
        <p>
          Eksporto të dhënat nga Cilësimet → Organizata. Për kërkesa të tjera përdor kontaktin e
          privatësisë më poshtë.
        </p></template
      >
      <template v-else-if="kind === 'terms'"
        ><h2>Llogaria dhe përmbajtja</h2>
        <p>
          Regjistrohu me emailin tënd dhe lidhe vetëm biznesin ku ke të drejtë veprimi. Ngarko
          materiale që ke të drejtë t’i përdorësh. Kontrollo saktësinë e çmimeve, datave dhe
          pretendimeve përpara miratimit.
        </p>
        <h2>Publikimi</h2>
        <p>
          Postimi kalon nga drafti te rishikimi dhe miratimi. Miratimi dhe ruajtja e orarit në
          kalendar nuk kërkojnë lidhje me Meta. Publikimi kërkon veprimin tënd, lidhje me Meta dhe
          periudhë aktive shërbimi. Rregullat dhe disponueshmëria e Meta-s mund të ndikojnë në
          rezultatin e publikimit.
        </p>
        <h2>Periudha falas</h2>
        <p>
          Kohëzgjatja dhe përfundimi i trial-it shfaqen në llogari. Trial-i jepet një herë dhe
          kontrollohet sipas identiteteve të verifikuara dhe identifikuesit të shfletuesit. Nuk
          krijohet pagesë ose rinovim automatik.
        </p></template
      >
      <template v-else
        ><h2>Hyrja në llogari</h2>
        <p>
          Emaili verifikohet përpara përdorimit të biznesit. Mund të ndryshosh fjalëkalimin dhe të
          mbyllësh sesionet e tjera nga Cilësimet → Siguria.
        </p>
        <h2>Qasja në biznes</h2>
        <p>
          Serveri kontrollon pronarin për çdo lexim dhe ndryshim. Autorizimet Meta nuk dërgohen në
          shfletues. Publikimet dhe ndryshimet kryesore regjistrohen në databazë.
        </p>
        <h2>Konfirmimi i veprimeve</h2>
        <p>
          Gjendja Publikuar kërkon konfirmim nga Meta. Kur përgjigjja mbetet e paqartë, ridërgimi
          bllokohet derisa të verifikohet rezultati.
        </p></template
      >
      <USeparator />
      <p v-if="site?.operator">Operatori: {{ site.operator }}</p>
      <p v-if="site?.privacyEmail">
        Kontakti i privatësisë:
        <ULink :to="'mailto:' + site.privacyEmail" class="text-primary">{{
          site.privacyEmail
        }}</ULink>
      </p>
      <UAlert
        v-if="!site?.operator || !site?.privacyEmail"
        color="neutral"
        variant="outline"
        title="Informacioni i operatorit është në përgatitje"
        description="Kjo faqe përshkruan zbatimin teknik. Identiteti i operatorit, kontakti, afatet përfundimtare të ruajtjes dhe kushtet tregtare duhen plotësuar përpara hapjes publike."
      /><UButton to="/help" color="neutral" variant="link">Udhëzimet e përdorimit</UButton>
    </div>
  </section>
</template>
