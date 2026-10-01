<script setup lang="ts">
/**
 * A compact red pill used in nav for unread or pending counts.
 * Renders nothing when count is 0 so the caller can bind it unconditionally.
 */
withDefaults(defineProps<{ count: number; max?: number }>(), { max: 99 })
</script>

<template>
  <span
    v-if="count > 0"
    class="notification-badge"
    :aria-label="`${count}`"
  >
    {{ count > max ? `${max}+` : count }}
  </span>
</template>

<style scoped>
.notification-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: transparent;
  color: var(--ui-text);
  box-shadow: inset 0 0 0 1px var(--ui-border);
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0;
}
</style>
