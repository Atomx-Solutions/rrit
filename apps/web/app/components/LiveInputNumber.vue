<script setup lang="ts">
/**
 * UInputNumber only commits its value on blur or Enter, so any total that
 * depends on it stays stale while the person is still typing. This reads the
 * typed value on every keystroke and commits it at once, within the limits.
 */
defineOptions({ inheritAttrs: false })
const model = defineModel<number>()
const props = defineProps<{
  min?: number
  max?: number
  step?: number
  formatOptions?: Intl.NumberFormatOptions
}>()

// Prices carry decimals; counts never do, so their separators are thousands.
const allowsDecimals = computed(() =>
  (props.step !== undefined && props.step < 1)
  || props.formatOptions?.style === 'currency'
  || (props.formatOptions?.maximumFractionDigits ?? 0) > 0)

function parseTyped(raw: string) {
  const cleaned = raw.replace(/[^\d.,]/g, '')
  if (!allowsDecimals.value) return cleaned.replace(/[.,]/g, '')
  // A trailing separator means the decimals are still being typed.
  if (/[.,]$/.test(cleaned)) return ''
  // The last separator is the decimal one; any earlier ones group thousands.
  const last = Math.max(cleaned.lastIndexOf('.'), cleaned.lastIndexOf(','))
  return last < 0
    ? cleaned
    : `${cleaned.slice(0, last).replace(/[.,]/g, '')}.${cleaned.slice(last + 1)}`
}

async function commitTyped(event: Event) {
  const input = event.target as HTMLInputElement | null
  if (!input) return
  const raw = input.value
  const typed = parseTyped(raw)
  if (!typed) return
  const value = Math.min(props.max ?? Number.MAX_SAFE_INTEGER, Number(typed))
  // Below the minimum the person is usually mid-way through a larger number.
  if (!Number.isFinite(value) || (props.min !== undefined && value < props.min)) return
  if (value === model.value) return
  const caret = input.selectionStart
  model.value = value
  // The field reformats itself as soon as its value changes ("12.0" becomes
  // "CHF 12.00"), which would fight the typing. Keep what was typed; the field
  // formats it on blur as usual.
  await nextTick()
  if (input.value !== raw) {
    input.value = raw
    if (caret !== null) input.setSelectionRange(caret, caret)
  }
}
</script>

<template>
  <UInputNumber
    v-bind="$attrs"
    v-model="model"
    :min="min"
    :max="max"
    :step="step"
    :format-options="formatOptions"
    @input="commitTyped"
  />
</template>
