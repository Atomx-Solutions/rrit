import { designSystem } from './utils/design-system'

export default defineAppConfig({
  rrit: { designSystem },
  ui: {
    colors: { primary: 'emerald', neutral: 'zinc' },
    button: {
      slots: { base: 'font-medium cursor-pointer pointer-coarse:min-h-9 pointer-coarse:min-w-9' },
      // On a phone the large buttons drop a step more than the smaller root
      // size alone gives them; touch still keeps them tall enough to tap.
      variants: {
        size: {
          lg: { base: 'max-sm:text-[13px] max-sm:px-2.5 max-sm:py-1.5', leadingIcon: 'max-sm:size-4', trailingIcon: 'max-sm:size-4' },
          xl: { base: 'max-sm:text-sm max-sm:px-3 max-sm:py-2', leadingIcon: 'max-sm:size-5', trailingIcon: 'max-sm:size-5' },
        },
      },
    },
    // Form fields are lower and tighter on a phone and their type follows the
    // device like the rest (iOS focus zoom is handled in ios-field-zoom). An
    // open list is as wide as its longest option, but never wider than the
    // screen.
    input: { slots: { base: 'min-h-9 max-sm:py-1.5 sm:min-h-10 text-sm' }, variants: { size: { md: { base: 'text-sm/5' }, lg: { base: 'text-sm/5' }, xl: { base: 'text-sm' } } } },
    textarea: { slots: { base: 'min-h-9 max-sm:py-1.5 sm:min-h-10 text-sm leading-relaxed' }, variants: { size: { md: { base: 'text-sm/5' }, lg: { base: 'text-sm/5' }, xl: { base: 'text-sm' } } } },
    select: {
      slots: {
        base: 'min-h-9 max-sm:py-1.5 sm:min-h-10 text-sm',
        content: 'w-max min-w-(--reka-select-trigger-width) max-w-[calc(100vw-2rem)]',
      },
      variants: { size: { md: { base: 'text-sm/5' }, lg: { base: 'text-sm/5' }, xl: { base: 'text-sm' } } },
    },
    selectMenu: {
      slots: {
        base: 'min-h-9 max-sm:py-1.5 sm:min-h-10 text-sm',
        content: 'w-max min-w-(--reka-combobox-trigger-width) max-w-[calc(100vw-2rem)]',
      },
      variants: { size: { md: { base: 'text-sm/5' }, lg: { base: 'text-sm/5' }, xl: { base: 'text-sm' } } },
    },
    modal: { slots: { header: 'pe-16' } },
    slideover: { slots: { header: 'pe-16' } },
    stepper: { slots: { root: '[&>[role=status]]:hidden' } },
  },
})
