/**
 * AI responses are persisted as plain text so the provider remains free to
 * explain its reasoning. The UI owns the presentation: remove common markup
 * tokens before displaying copy as readable product text.
 */
export function readableText(value: string | null | undefined) {
  return (value || '')
    .normalize('NFC')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(`{1,3}|\*\*|__)/g, '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
