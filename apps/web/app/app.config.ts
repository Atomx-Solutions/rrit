export default defineAppConfig({
  ui: {
    colors: { primary: 'emerald', neutral: 'zinc' },
    button: {
      slots: { base: 'font-medium cursor-pointer pointer-coarse:min-h-11 pointer-coarse:min-w-11' },
    },
    input: { slots: { base: 'min-h-11 text-base sm:text-sm' } },
    textarea: { slots: { base: 'text-base sm:text-sm leading-relaxed' } },
    select: { slots: { base: 'min-h-11 text-base sm:text-sm' } },
    selectMenu: { slots: { base: 'min-h-11 text-base sm:text-sm' } },
    stepper: { slots: { root: '[&>[role=status]]:hidden' } },
  },
})
