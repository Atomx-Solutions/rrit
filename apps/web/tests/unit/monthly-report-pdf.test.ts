import { describe, expect, it } from 'vitest'
import { monthlyReportPdf } from '../../server/utils/monthly-report-pdf'

const researchText = [
  '## Executive summary',
  '- A concise finding with enough detail to verify the card layout and wrapping behavior in the generated document.',
  '- A second finding ensures that a section heading remains attached to real content.',
  '## Market and audience',
  ...Array.from(
    { length: 18 },
    (_, index) =>
      `- Finding ${index + 1} contains practical evidence, context and a recommendation without overflowing its visual container.`,
  ),
  '## Data gaps',
  '- No verified historical timing data was supplied, so the report must state the limitation clearly.',
].join('\n')

describe('monthlyReportPdf', () => {
  it('creates a paginated report with a dedicated cover and numbered footers', () => {
    const pdf = monthlyReportPdf({
      type: 'research',
      language: 'en',
      month: '2026-09',
      businessName: 'Example Business',
      businessDescription: 'A concise description of the business and the service it provides.',
      industry: 'Professional services',
      city: 'Prishtina',
      research: {
        text: researchText,
        sources: Array.from({ length: 10 }, (_, index) => ({
          title: `Approved source ${index + 1}`,
          url: `https://example.com/research/source-${index + 1}`,
        })),
        citations: [],
        researchedAt: '2026-09-24T10:00:00.000Z',
      },
      strategy: null,
    })

    const raw = pdf.toString('latin1')
    const pageCount = Number(raw.match(/\/Count (\d+)/)?.[1] || 0)
    expect(raw.startsWith('%PDF-1.4')).toBe(true)
    expect(pageCount).toBeGreaterThan(2)
    expect(raw).toContain('(1 / ')
    expect(raw).toContain(`(${pageCount} / ${pageCount})`)
    expect(raw.indexOf('(Explanation of findings)')).toBeGreaterThan(raw.indexOf('endstream'))
  })
})
