<template>
  <div class="auth-layout">
    <aside class="auth-story">
      <BrandLogo />
      <div>
        <span class="eyebrow">PËR BIZNESIN QË PO NDËRTON</span>
        <h2 class="mt-5">Çdo ditë,<br />një mundësi<br />për t’u rritur.</h2>
        <p>Postimet e biznesit, në një vend. Më shumë kohë për atë që bën më mirë.</p>
        <img
          src="/images/table.jpg"
          alt="Kafe e ngrohtë në tavolinë"
          width="440"
          height="230"
          class="mt-8"
          style="
            border-radius: 16px;
            width: 100%;
            max-width: 440px;
            height: 220px;
            object-fit: cover;
          "
        />
      </div>
      <p class="small">Në shqip. Për bizneset në Kosovë.</p>
    </aside>
    <main class="auth-form">
      <ULink to="/" class="small muted block mb-8">← Kthehu te Rrit</ULink><slot />
    </main>
  </div>
</template>
