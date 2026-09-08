import withNuxt from './.nuxt/eslint.config.mjs'
export default withNuxt({
  rules: {
    'vue/multi-word-component-names': 'off',
    'vue/html-self-closing': 'off',
    'vue/max-attributes-per-line': 'off',
    'vue/no-restricted-html-elements': [
      'error',
      {
        element: [
          'button',
          'input',
          'textarea',
          'select',
          'option',
          'form',
          'label',
          'table',
          'dialog',
          'progress',
          'a',
        ],
        message:
          'Use the corresponding Nuxt UI component. Product UI must share its interaction and accessibility behavior.',
      },
    ],
  },
})
