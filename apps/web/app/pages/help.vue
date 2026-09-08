<script setup lang="ts">
definePageMeta({ layout: 'public' })
useSeoMeta({ title: 'Ndihmë dhe udhëzime · Rrit' })
const { data: capabilities } = await useFetch('/api/capabilities')
const search = ref('')
const topics = computed(() => [
  {
    label: 'Si krijoj llogarinë e biznesit?',
    content:
      `Zgjidh Fillo falas, vendos emrin, emailin dhe një fjalëkalim me të paktën 12 karaktere. ${capabilities.value?.emailVerificationRequired ? 'Verifiko emailin nga lidhja e dërguar, pastaj' : 'Pastaj'} plotëso biznesin në tre hapa.`,
  },
  {
    label: 'Si lidhet Facebook dhe Instagram?',
    content:
      'Te Postimet nga rrjetet zgjidh Lidh përmes Meta. Autorizo qasjen dhe zgjidh faqen e biznesit. Për Instagram kërkohet profil profesional i lidhur me atë faqe. Nëse lidhja është në përgatitje, platforma ende nuk e ka aktivizuar integrimin.',
  },
  {
    label: 'Si lexohen postimet ekzistuese?',
    content:
      'Pas lidhjes, zgjidh rrjetin dhe Përditëso postimet. Përdor Lexo postime më të vjetra për historikun dhe filtrat për ta gjetur tekstin që kërkon.',
  },
  {
    label: 'Si krijoj postimin e parë?',
    content:
      'Hap Postimet → Krijo postim. Shkruaj titullin dhe tekstin, zgjidh rrjetin dhe ngarko një fotografi. Drafti i vlefshëm ruhet në server gjatë shkrimit. Shenja Ruajtur në server konfirmon ruajtjen.',
  },
  {
    label: 'A mund ta miratoj postimin pa lidhur Meta?',
    content:
      'Po. Serveri kontrollon tekstin, fotografinë, të drejtat e deklaruara dhe formatin. Konfirmo vetë saktësinë e çmimeve, datave dhe premtimeve, pastaj mirato versionin aktual. Lidhja me Meta kontrollohet vetëm kur kërkon publikim në rrjetin social.',
  },
  {
    label: 'Si funksionon publikimi dhe orari?',
    content:
      'Nga një postim i miratuar zgjidh Planifiko postimin dhe ruaj orarin pa lidhur Meta. Fillimisht postimi ruhet vetëm në kalendar. Për dërgim në rrjetin social zgjidh Publiko tani ose aktivizo Publiko automatikisht në këtë orar; kërkohet shërbim dhe lidhje aktive. Lidhja e Meta-s më vonë nuk aktivizon vetë publikimin. Orari ndjek zonën kohore të biznesit.',
  },
  {
    label: 'Çfarë nëse publikimi pret verifikim?',
    content:
      'Kontrollo faqen në rrjetin social. Rrit nuk e ridërgon automatikisht një postim kur përgjigjja është e paqartë, që të shmangë dyfishimin. Ruaj identifikuesin e postimit kur kërkon ndihmë.',
  },
  {
    label: 'Ku ruhen fotografitë dhe draftet?',
    content:
      'Fotografitë ruhen privatisht në server. Metadata-t e fotografive hiqen gjatë ngarkimit. Formularët e papërfunduar mund të rikuperohen në të njëjtën skedë. Eksporto të dhënat nga Cilësimet → Organizata.',
  },
  {
    label: 'Çfarë ndodh pas trial-it?',
    content:
      'Trial-i nuk rinovohet automatikisht dhe nuk kryhet tarifim. Të dhënat mbeten të lexueshme; veprimet e reja kërkojnë shërbim aktiv.',
  },
])
const filtered = computed(() =>
  topics.value.filter((t) =>
    (t.label + ' ' + t.content).toLowerCase().includes(search.value.trim().toLowerCase()),
  ),
)
const { page, pageSize, total, paginated } = usePagination(filtered)
watch(search, () => {
  page.value = 1
})
</script>
<template>
  <section class="public-section max-w-3xl">
    <p class="eyebrow">HAP PAS HAPI</p>
    <h1 class="my-5">Si mund të të ndihmojmë?</h1>
    <UInput
      v-model="search"
      icon="i-lucide-search"
      aria-label="Kërko ndihmë"
      placeholder="Kërko një temë…"
      class="w-full mb-6"
    /><UAccordion :items="paginated" /><ListPagination
      v-model:page="page"
      v-model:page-size="pageSize"
      :total="total"
    /><UButton to="/app" variant="outline" class="mt-6">Hap hapësirën tënde</UButton>
  </section>
</template>
