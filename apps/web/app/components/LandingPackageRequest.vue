<script setup lang="ts">
/**
 * Replaces the plan cards on the public site. Payment is taken in cash and the
 * team activates the package, so the section asks for the rhythm the visitor
 * needs instead of listing prices. The section heading already explains it, so
 * the card carries nothing but the fields.
 */
</script>

<template>
  <div class="landing-request">
    <PackageRequestForm compact submit-label-key="landing.requestOffer" />
  </div>
</template>
