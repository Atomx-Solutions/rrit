export const designSystem = {
  version: '1',
  policy: {
    componentSystem: 'Nuxt UI v4',
    sharedTokens: 'CSS custom properties prefixed with --rrit-',
    icons: 'Use Nuxt UI/Lucide icons with i-lucide-* names; do not introduce a second icon library.',
    wrappers: 'Create RRIT wrappers only for product composition or brand-specific presentation.',
    exception: 'Illustrative landing scenes may use local art-direction values.',
  },
  tokens: {
    color: ['canvas', 'surface', 'text', 'muted', 'border', 'primary', 'focus'],
    typography: ['font-sans', 'text-xs', 'text-sm', 'text-base', 'leading-body'],
    spacing: ['space-1', 'space-2', 'space-3', 'space-4', 'space-6', 'space-8'],
    radius: ['radius-control', 'radius-card', 'radius-pill'],
    elevation: ['shadow-card', 'shadow-floating'],
    motion: ['motion-fast', 'motion-standard', 'ease-standard'],
  },
} as const
