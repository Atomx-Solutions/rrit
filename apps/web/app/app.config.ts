import { designSystem } from './utils/design-system'

export default defineAppConfig({
  rrit: { designSystem },
  ui: {
    colors: { primary: 'emerald', neutral: 'zinc' },
    button: {
      slots: { base: 'font-medium cursor-pointer pointer-coarse:min-h-9 pointer-coarse:min-w-9' },
    },
    input: { slots: { base: 'min-h-10 text-base sm:text-sm' } },
    textarea: { slots: { base: 'min-h-10 text-base sm:text-sm leading-relaxed' } },
    select: { slots: { base: 'min-h-10 text-base sm:text-sm' } },
    selectMenu: { slots: { base: 'min-h-10 text-base sm:text-sm' } },
    modal: { slots: { header: 'pe-16' } },
    slideover: { slots: { header: 'pe-16' } },
    stepper: { slots: { root: '[&>[role=status]]:hidden' } },
  },
})
