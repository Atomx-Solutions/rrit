import type { Research } from '../../shared/schemas/monthly-plan'
import en from '../../app/locales/client/en.json'
import sq from '../../app/locales/client/sq.json'
import { logoPdfOps, pdfText } from './invoice-pdf'

type StrategySlot = {
  day: number
  time: string
  channel: 'Facebook' | 'Instagram'
  topic: string
  intent: string
  hook: string
  purpose: string
  timingBasis?: 'social_history' | 'platform_history' | 'no_data'
  sourceUrls: string[]
}

type Strategy = {
  objective: string
  audience: string
  rationale: string
  slots: StrategySlot[]
}

type ReportInput = {
  type: 'research' | 'strategy'
  language: 'sq' | 'en'
  month: string
  businessName: string
  businessDescription: string
  industry: string
  city: string
  research: Research | null
  strategy: Strategy | null
}

type PdfPage = string[]
type ReportLanguage = 'sq' | 'en'

const reportDictionaries: Record<ReportLanguage, Record<string, string>> = {
  sq: sq as Record<string, string>,
  en: en as Record<string, string>,
}

function reportT(language: ReportLanguage, key: string, fallback: string) {
  return reportDictionaries[language][key] || fallback
}

const colors = {
  // Mirrors the palette used by the browser report preview.
  ink: '0.09 0.14 0.11',
  muted: '0.27 0.33 0.30',
  green: '0.12 0.16 0.22',
  greenLight: '0.75 0.85 0.98',
  greenPale: '0.96 0.97 0.99',
  white: '1 1 1',
  line: '0.86 0.90 0.87',
  warning: '0.52 0.35 0.05',
}

function reportCopy(language: ReportLanguage) {
  const t = (key: string, fallback: string) => reportT(language, key, fallback)
  const titleT = (key: string, fallback: string) => reportT('en', key, fallback)
  if (language === 'en') {
    return {
      reportLabel: titleT('monthly.reportLabel', 'Custom report').toUpperCase(),
      reportForBusiness: titleT('monthly.reportForBusiness', 'Report for business').toUpperCase(),
      researchReport: titleT('monthly.researchReportTitle', 'Research report'),
      strategyReport: titleT('monthly.strategyReportTitle', 'Strategy report'),
      researchSubtitle: t(
        'monthly.researchReportDescription',
        'A structured summary of findings, approved sources and data gaps.',
      ),
      strategySubtitle: t(
        'monthly.strategyReportDescription',
        'A structured summary of the editorial plan and the verifiable basis of the strategy.',
      ),
      researchEntry: titleT('research.reportEntryLabel', 'In brief').toUpperCase(),
      researchEntryTitle: titleT('research.reportEntryTitle', 'What is this report about?'),
      strategyEntry: titleT('monthly.strategyReportEntry', 'Monthly direction').toUpperCase(),
      approvedSources: titleT('research.reportApprovedSources', 'Approved sources'),
      sourcesConsulted: titleT('research.sources', 'Sources consulted'),
      researchDate: titleT('research.reportDate', 'Research date'),
      audience: titleT('strategy.audience', 'Audience'),
      business: t('monthly.reportIndustryFallback', 'Business'),
      businessDescription: t(
        'monthly.reportBusinessFallback',
        'A strategy summary prepared for this business.',
      ),
      locationFallback: t('monthly.reportLocationFallback', 'Location not specified'),
      findings: titleT('research.reportExplanationTitle', 'Explanation of findings'),
      approvedSourcesDescription: t(
        'research.reportExplanationDescription',
        'These are the approved sources used for the report citations.',
      ),
      strategyExplanation: titleT('strategy.explanationTitle', 'Explanation of strategy'),
      editorialPlan: titleT('strategy.editorialPlan', 'Editorial plan'),
      day: titleT('strategy.day', 'Day'),
      strategySources: titleT('strategy.approvedSources', 'Approved strategy sources'),
    }
  }

  const localized = {
    researchReport: t('monthly.researchReportTitle', 'Raport i hulumtimit'),
    strategyReport: t('monthly.strategyReportTitle', 'Raporti i strategjisë'),
    researchSubtitle: t(
      'monthly.researchReportDescription',
      'Përmbledhje e strukturuar e gjetjeve, burimeve të aprovuara dhe boshllëqeve në të dhëna.',
    ),
    strategySubtitle: t(
      'monthly.strategyReportDescription',
      'Përmbledhje e strukturuar e planit editorial dhe bazës së verifikueshme të strategjisë.',
    ),
    researchEntry: t('research.reportEntryLabel', 'Në pak fjalë').toLocaleUpperCase('sq'),
    strategyEntry: t('monthly.strategyReportEntry', 'Drejtimi i muajit').toLocaleUpperCase('sq'),
    approvedSources: t('research.reportApprovedSources', 'Burime të aprovuara'),
    audience: t('strategy.audience', 'Audienca'),
    business: t('monthly.reportIndustryFallback', 'Biznes'),
    businessDescription: t(
      'monthly.reportBusinessFallback',
      'Përmbledhje e strategjisë së përgatitur për këtë biznes.',
    ),
    locationFallback: t('monthly.reportLocationFallback', 'Lokacioni nuk është specifikuar'),
    findings: t('research.reportExplanationTitle', 'Shpjegimi i gjetjeve'),
    approvedSourcesDescription: t(
      'research.reportExplanationDescription',
      'Këto janë burimet e aprovuara të përdorura për citimet e raportit.',
    ),
    strategyExplanation: t('strategy.explanationTitle', 'Shpjegimi i strategjisë'),
    editorialPlan: t('strategy.editorialPlan', 'Plani editorial'),
    day: t('strategy.day', 'Dita'),
    strategySources: t('strategy.approvedSources', 'Burimet e aprovuara të strategjisë'),
  }

  return {
    reportLabel: titleT('monthly.reportLabel', 'Custom report').toUpperCase(),
    reportForBusiness: titleT('monthly.reportForBusiness', 'Report for business').toUpperCase(),
    ...localized,
    researchReport: titleT('monthly.researchReportTitle', 'Research report'),
    strategyReport: titleT('monthly.strategyReportTitle', 'Strategy report'),
    researchEntry: titleT('research.reportEntryLabel', 'In brief').toUpperCase(),
    researchEntryTitle: titleT('research.reportEntryTitle', 'What is this report about?'),
    strategyEntry: titleT('monthly.strategyReportEntry', 'Monthly direction').toUpperCase(),
    approvedSources: titleT('research.reportApprovedSources', 'Approved sources'),
    sourcesConsulted: titleT('research.sources', 'Sources consulted'),
    researchDate: titleT('research.reportDate', 'Research date'),
    audience: titleT('strategy.audience', 'Audience'),
    findings: titleT('research.reportExplanationTitle', 'Explanation of findings'),
    strategyExplanation: titleT('strategy.explanationTitle', 'Explanation of strategy'),
    editorialPlan: titleT('strategy.editorialPlan', 'Editorial plan'),
    day: titleT('strategy.day', 'Day'),
    strategySources: titleT('strategy.approvedSources', 'Approved strategy sources'),
  }
}

function clean(value: string) {
  return value
    .normalize('NFC')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(`{1,3}|\*\*|__)/g, '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function wrap(value: string, maxChars: number) {
  const words = clean(value).split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (current && next.length > maxChars) {
      lines.push(current)
      current = word
    } else current = next
  }
  if (current) lines.push(current)
  return lines.length ? lines : ['']
}

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function heading(value: string, language: 'sq' | 'en') {
  const normalized = clean(value).toLocaleLowerCase('sq')
  const englishTitles: Record<string, string> = {
    'executive summary': 'Executive summary',
    'përmbledhja ekzekutive': 'Executive summary',
    'market and audience': 'Market and audience',
    'tregu dhe audienca': 'Market and audience',
    'instagram behavior': 'Instagram behavior',
    'sjellja në instagram': 'Instagram behavior',
    'facebook behavior': 'Facebook behavior',
    'sjellja në facebook': 'Facebook behavior',
    'content opportunities': 'Content opportunities',
    'mundësitë e përmbajtjes': 'Content opportunities',
    'observed timing data': 'Observed timing data',
    'të dhënat e vëzhguara për orarin': 'Observed timing data',
    'timing hypotheses': 'Observed timing data',
    'hipotezat e orarit': 'Observed timing data',
    'data gaps': 'Data gaps',
    'boshllëqet në të dhëna': 'Data gaps',
  }
  if (englishTitles[normalized]) return englishTitles[normalized]
  if (language === 'en') {
    const englishLabels: Record<string, string> = {
      'executive summary': 'Executive summary',
      'market and audience': 'Market and audience',
      'instagram behavior': 'Instagram behavior',
      'facebook behavior': 'Facebook behavior',
      'content opportunities': 'Content opportunities',
      'observed timing data': 'Observed timing data',
      'timing hypotheses': 'Observed timing data',
      'data gaps': 'Data gaps',
    }
    return englishLabels[normalized] || clean(value)
  }
  const labels: Record<string, string> = {
    'pÃ«rmbledhja ekzekutive': 'Përmbledhja ekzekutive',
    'executive summary': 'Executive summary',
    'tregu dhe audienca': 'Tregu dhe audienca',
    'market and audience': 'Market and audience',
    'sjellja nÃ« instagram': 'Sjellja në Instagram',
    'instagram behavior': 'Instagram behavior',
    'sjellja nÃ« facebook': 'Sjellja në Facebook',
    'facebook behavior': 'Facebook behavior',
    'mundÃ«sitÃ« e pÃ«rmbajtjes': 'Mundësitë e përmbajtjes',
    'content opportunities': 'Content opportunities',
    'tÃ« dhÃ«nat e vÃ«zhguara pÃ«r orarin': 'Të dhënat e vëzhguara për orarin',
    'observed timing data': 'Observed timing data',
    'hipotezat e orarit': 'Të dhënat e vëzhguara për orarin',
    'timing hypotheses': 'Observed timing data',
    'boshllÃ«qet nÃ« tÃ« dhÃ«na': 'Boshllëqet në të dhëna',
    'data gaps': 'Data gaps',
  }
  return labels[normalized] || clean(value)
}

function researchSections(research: Research, language: 'sq' | 'en') {
  const sections: Array<{ title: string; lines: Array<{ bullet: boolean; text: string }> }> = []
  let current = { title: '', lines: [] as Array<{ bullet: boolean; text: string }> }
  for (const raw of research.text.split('\n')) {
    const value = raw.trim()
    if (!value) continue
    const isHeading = /^#{1,4}\s+/.test(value) || /^\*\*.+\*\*$/.test(value)
    if (isHeading) {
      if (current.lines.length) sections.push(current)
      const parsedTitle = heading(value, language)
      const genericTitle = parsedTitle.trim().toLocaleLowerCase('en')
      current = {
        title: genericTitle === 'explanation' || genericTitle === 'shpjegimi' ? '' : parsedTitle,
        lines: [],
      }
      continue
    }
    const bullet = /^(?:[-*•]|\d+[.)])\s+/.test(value)
    current.lines.push({ bullet, text: clean(value) })
  }
  if (current.lines.length) sections.push(current)
  return sections
}

function localizedResearchSectionTitle(title: string, language: 'sq' | 'en') {
  if (language === 'sq') return title
  const key = title.trim().toLocaleLowerCase('sq')
  const translations: Record<string, string> = {
    'përmbledhja ekzekutive': 'Executive summary',
    'kontekst sezonal': 'Seasonal context',
    'sjellja në instagram': 'Instagram behavior',
    'sjellja në facebook': 'Facebook behavior',
    'mundësitë e përmbajtjes': 'Content opportunities',
    'boshllëqet në të dhëna': 'Data gaps',
    'transparency': 'Transparency',
  }
  return translations[key] || title
}

function legacyMonthlyReportPdf(input: ReportInput) {
  const copy = reportCopy(input.language)
  const pages: PdfPage[] = [[]]
  let page = 0
  let y = 780
  const add = (value: string) => pages[page]!.push(value)
  const color = (value: string) => add(`${value} rg`)
  const text = (x: number, value: string, size = 10, bold = false, tone = colors.ink) => {
    color(tone)
    add(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${y} Td (${pdfText(value)}) Tj ET`)
  }
  const rect = (x: number, top: number, width: number, height: number, tone: string) => {
    color(tone)
    add(`${x} ${top - height} ${width} ${height} re f`)
  }
  const roundedRect = (
    x: number,
    top: number,
    width: number,
    height: number,
    radius: number,
    tone: string,
  ) => {
    color(tone)
    const bottom = top - height
    const right = x + width
    const r = Math.min(radius, width / 2, height / 2)
    const k = 0.5522848
    add(`${x + r} ${bottom} m`)
    add(`${right - r} ${bottom} l`)
    add(`${right - r + k * r} ${bottom} ${right} ${bottom + r - k * r} ${right} ${bottom + r} c`)
    add(`${right} ${top - r} l`)
    add(`${right} ${top - r + k * r} ${right - r + k * r} ${top} ${right - r} ${top} c`)
    add(`${x + r} ${top} l`)
    add(`${x + r - k * r} ${top} ${x} ${top - r + k * r} ${x} ${top - r} c`)
    add(`${x} ${bottom + r} l`)
    add(`${x} ${bottom + r - k * r} ${x + r - k * r} ${bottom} ${x + r} ${bottom} c h f`)
  }
  const line = (x: number, width: number, tone = colors.line) => {
    add(`${tone} RG`)
    add(`0.6 w ${x} ${y} ${x + width} ${y} m S`)
  }
  const nextPage = () => {
    page += 1
    pages.push([])
    // Leave a clear margin above the continuation-page branding.
    y = 764
    add(logoPdfOps(595, 52, 76))
    y = 758
    text(44, copy.reportLabel, 7, true, colors.green)
    y -= 16
    text(
      44,
      input.type === 'research' ? copy.researchReport : copy.strategyReport,
      14,
      true,
      colors.ink,
    )
    y -= 16
    line(44, 507)
    y -= 24
  }
  const ensure = (height: number) => {
    if (y - height < 54) nextPage()
  }
  const paragraph = (
    value: string,
    x = 52,
    maxChars = 88,
    size = 10,
    leading = 15,
    tone = colors.muted,
  ) => {
    for (const row of wrap(value, maxChars)) {
      ensure(leading)
      text(x, row, size, false, tone)
      y -= leading
    }
  }
  const sectionTitle = (value: string) => {
    ensure(54)
    y -= 2
    text(44, value, 16, true, colors.ink)
    y -= 11
    line(44, 507, colors.line)
    y -= 17
  }
  const coverText =
    input.type === 'research' && input.research
      ? researchSections(input.research, input.language)
          .flatMap((item) => item.lines)
          .map((item) => item.text)
          .join(' ')
      : input.strategy?.objective || ''
  const coverX = 30
  const coverWidth = 535
  const coverInnerX = 52
  const coverRows = wrap(coverText, 90).slice(0, 4)
  const researchDate = input.research?.researchedAt?.slice(0, 10) || input.month

  add(logoPdfOps(595, 30, 76, coverX))
  y = 790
  text(420, `${input.businessName} · ${input.month}`, 7, true, colors.green)
  y = 756
  text(coverX, copy.reportLabel, 8, true, colors.green)
  y -= 18
  text(
    coverX,
    input.type === 'research' ? copy.researchReport : copy.strategyReport,
    24,
    true,
    colors.ink,
  )
  y -= 22
  paragraph(
    input.type === 'research' ? copy.researchSubtitle : copy.strategySubtitle,
    coverX,
    100,
    9,
    13,
    colors.muted,
  )
  y -= 12
  line(coverX, coverWidth)
  y -= 28

  // Match the preview's two Rrit-green cards on the first page.
  const businessTop = y
  roundedRect(coverX, businessTop, coverWidth, 142, 16, colors.green)
  y -= 22
  text(coverInnerX, copy.reportForBusiness, 8, true, colors.greenLight)
  y -= 24
  text(coverInnerX, input.businessName, 20, true, colors.white)
  y -= 22
  paragraph(
    input.businessDescription || copy.businessDescription,
    coverInnerX,
    92,
    9,
    13,
    colors.greenLight,
  )
  // The metadata lives in the green card footer, matching the preview.
  y = businessTop - 99
  line(coverX + 1, coverWidth - 2, '0.20 0.50 0.39')
  y = businessTop - 122
  text(coverInnerX, input.industry || copy.business, 8, true, colors.white)
  text(240, input.city || copy.locationFallback, 8, false, colors.greenLight)
  text(480, input.month, 8, false, colors.greenLight)
  y = businessTop - 168

  const summaryTop = y
  roundedRect(coverX, summaryTop, coverWidth, 220, 16, colors.green)
  y -= 22
  text(
    coverInnerX,
    input.type === 'research' ? copy.researchEntry : copy.strategyEntry,
    8,
    true,
    colors.greenLight,
  )
  y -= 22
  text(
    coverInnerX,
    input.type === 'research' ? copy.researchEntryTitle : copy.strategyReport,
    17,
    true,
    colors.white,
  )
  y -= 22
  for (const row of coverRows) {
    text(coverInnerX, row, 8, false, colors.white)
    y -= 12
  }
  y -= 8
  if (input.type === 'research' && input.research) {
    const statTop = summaryTop - 164
    y = statTop
    line(coverInnerX, coverWidth - 44, '0.20 0.50 0.39')
    for (const [x, label, value] of [
      [48, copy.sourcesConsulted, String(input.research.sources.length)],
      [222, copy.approvedSources, String(input.research.sources.length)],
      [396, copy.researchDate, researchDate],
    ] as Array<[number, string, string]>) {
      y = statTop - 20
      text(x + 10, label, 6, false, colors.greenLight)
      y -= 12
      text(x + 10, value, 9, true, colors.white)
    }
    y = summaryTop - 248
  } else if (input.strategy) {
    paragraph(`${copy.audience}: ${input.strategy.audience}`, 66, 82, 8, 12, colors.greenLight)
  }
  y -= 30

  if (input.type === 'research' && input.research) {
    // Continue on the opening page when it has room; avoid unused white space.
    sectionTitle(copy.findings)
    for (const section of researchSections(input.research, input.language)) {
      if (section.title) sectionTitle(section.title)
      for (const item of section.lines) {
        const rows = wrap(item.text, item.bullet ? 78 : 88)
        const cardHeight = item.bullet ? Math.max(38, rows.length * 15 + 20) : 0
        ensure(item.bullet ? cardHeight + 8 : rows.length * 15 + 10)
        if (item.bullet) {
          rect(44, y + 8, 507, cardHeight, colors.greenPale)
          rect(44, y + 8, 5, cardHeight, colors.green)
          rect(60, y - 8, 4, 4, colors.green)
          y -= 14
          for (const row of rows) {
            text(76, row, 10, false, colors.muted)
            y -= 15
          }
          y -= 13
        } else {
          paragraph(item.text, 52, 88, 10, 15)
          y -= 7
        }
      }
    }
    nextPage()
    sectionTitle(copy.approvedSources)
    paragraph(
      'Këto janë burimet e ruajtura në hulumtim dhe të përdorura për citimet e raportit. Nuk shfaqen URL të tjera.',
      44,
      88,
      10,
      15,
    )
    y -= 12
    for (const [index, source] of input.research.sources.entries()) {
      ensure(48)
      rect(44, y + 8, 507, 42, colors.greenPale)
      rect(44, y + 8, 5, 42, colors.green)
      y -= 14
      text(58, `${index + 1}. ${clean(source.title)}`, 9, true, colors.ink)
      y -= 14
      text(58, `${host(source.url)} · ${source.url}`, 8, false, colors.muted)
      y -= 22
    }
  } else if (input.strategy) {
    // Continue on the opening page when it has room; avoid unused white space.
    sectionTitle(copy.strategyExplanation)
    paragraph(input.strategy.rationale, 44, 88, 10, 15)
    y -= 10
    sectionTitle(copy.audience)
    paragraph(input.strategy.audience, 44, 88, 10, 15)
    y -= 10
    sectionTitle(copy.editorialPlan)
    for (const [index, slot] of input.strategy.slots.entries()) {
      ensure(126)
      rect(44, y + 8, 507, 112, colors.greenPale)
      y -= 18
      text(58, `${index + 1}. ${clean(slot.topic)}`, 11, true, colors.ink)
      y -= 17
      text(58, `${slot.channel} · ${copy.day} ${slot.day} · ${slot.time}`, 8, true, colors.green)
      y -= 17
      paragraph(slot.hook, 58, 78, 9, 13)
      paragraph(slot.purpose, 58, 78, 9, 13)
      y -= 17
    }
    const approvedStrategySources = [
      ...new Set(input.strategy.slots.flatMap((slot) => slot.sourceUrls)),
    ].filter((url) => input.research?.sources.some((source) => source.url === url))
    if (approvedStrategySources.length) {
      nextPage()
      sectionTitle(copy.strategySources)
      for (const [index, url] of approvedStrategySources.entries()) {
        ensure(32)
        text(52, `${index + 1}. ${host(url)} · ${url}`, 9, false, colors.muted)
        y -= 18
      }
    }
  }

  const pageObjects: string[] = []
  const contentObjects: string[] = []
  const pageCount = pages.length
  const regularFont = 3 + pageCount
  const boldFont = regularFont + 1
  const contentStart = boldFont + 1
  for (const current of pages) {
    const stream = current.join('\n')
    contentObjects.push(
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    )
  }
  for (let index = 0; index < pageCount; index += 1) {
    const contentId = contentStart + index
    pageObjects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${regularFont} 0 R /F2 ${boldFont} 0 R >> >> /Contents ${contentId} 0 R >>`,
    )
  }
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageObjects.map((_, index) => `${3 + index} 0 R`).join(' ')}] /Count ${pageCount} >>`,
    ...pageObjects,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    ...contentObjects,
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'latin1'))
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(body, 'latin1')
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  body += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

void legacyMonthlyReportPdf

/**
 * A4 report renderer with block-aware pagination.
 *
 * Every component is measured before it is painted. This is intentionally
 * separate from the old cursor-based renderer above while the report format
 * is being migrated, because drawing first and checking afterwards is what
 * caused headings, cards and continuation copy to collide at page boundaries.
 */
export function monthlyReportPdf(input: ReportInput) {
  const copy = reportCopy(input.language)
  const pageWidth = 595
  const marginX = 48
  const contentWidth = pageWidth - marginX * 2
  const contentBottom = 58
  const pages: PdfPage[] = [[]]
  let page = 0
  let y = 0

  const add = (value: string) => pages[page]!.push(value)
  const setFill = (tone: string) => add(`${tone} rg`)
  const drawText = (
    x: number,
    baseline: number,
    value: string,
    size = 10,
    bold = false,
    tone = colors.ink,
  ) => {
    setFill(tone)
    add(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${baseline} Td (${pdfText(value)}) Tj ET`)
  }
  const drawRect = (x: number, top: number, width: number, height: number, tone: string) => {
    setFill(tone)
    add(`${x} ${top - height} ${width} ${height} re f`)
  }
  const drawRoundedRect = (
    x: number,
    top: number,
    width: number,
    height: number,
    radius: number,
    tone: string,
  ) => {
    setFill(tone)
    const bottom = top - height
    const right = x + width
    const r = Math.min(radius, width / 2, height / 2)
    const k = 0.5522848
    add(`${x + r} ${bottom} m`)
    add(`${right - r} ${bottom} l`)
    add(`${right - r + k * r} ${bottom} ${right} ${bottom + r - k * r} ${right} ${bottom + r} c`)
    add(`${right} ${top - r} l`)
    add(`${right} ${top - r + k * r} ${right - r + k * r} ${top} ${right - r} ${top} c`)
    add(`${x + r} ${top} l`)
    add(`${x + r - k * r} ${top} ${x} ${top - r + k * r} ${x} ${top - r} c`)
    add(`${x} ${bottom + r} l`)
    add(`${x} ${bottom + r - k * r} ${x + r - k * r} ${bottom} ${x + r} ${bottom} c h f`)
  }
  const drawRule = (baseline: number, tone = colors.line, width = 0.7) => {
    add(`${tone} RG`)
    add(`${width} w ${marginX} ${baseline} m ${pageWidth - marginX} ${baseline} l S`)
  }
  const documentTitle = input.type === 'research' ? copy.researchReport : copy.strategyReport

  const startPage = (section?: string, description?: string) => {
    page += 1
    pages.push([])
    add(logoPdfOps(pageWidth, 34, 66))
    drawText(marginX, 790, copy.reportLabel, 7, true, colors.green)
    drawText(marginX, 772, documentTitle, 15, true, colors.ink)
    drawText(marginX, 752, `${input.businessName} - ${input.month}`, 8, false, colors.muted)
    drawRule(734)
    y = 704
    if (section) {
      drawText(marginX, y, section, 19, true, colors.ink)
      y -= 19
      if (description) {
        for (const row of wrap(description, 92)) {
          drawText(marginX, y, row, 9, false, colors.muted)
          y -= 13
        }
      }
      y -= 14
    }
  }
  const ensureSpace = (height: number) => {
    if (y - height < contentBottom) startPage()
  }
  const paragraphRows = (value: string, maxChars = 90) => wrap(value, maxChars)
  const paragraphHeight = (value: string, maxChars = 90, leading = 15) =>
    paragraphRows(value, maxChars).length * leading
  const drawParagraph = (
    value: string,
    x = marginX,
    maxChars = 90,
    size = 10,
    leading = 15,
    tone = colors.muted,
  ) => {
    for (const row of paragraphRows(value, maxChars)) {
      ensureSpace(leading)
      drawText(x, y, row, size, false, tone)
      y -= leading
    }
  }
  const cardMetrics = (value: string, maxChars = 78) => {
    const rows = wrap(value, maxChars)
    return { rows, height: Math.max(48, rows.length * 15 + 24) }
  }
  const drawFindingCard = (value: string) => {
    const { rows, height } = cardMetrics(value)
    ensureSpace(height + 10)
    const top = y
    drawRoundedRect(marginX, top, contentWidth, height, 7, colors.greenPale)
    drawRect(marginX, top - 7, 4, height - 14, colors.green)
    drawRoundedRect(marginX + 18, top - 19, 5, 5, 2.5, colors.green)
    let baseline = top - 25
    for (const row of rows) {
      drawText(marginX + 34, baseline, row, 9.5, false, colors.muted)
      baseline -= 15
    }
    y -= height + 10
  }
  const drawSectionTitle = (value: string, followingHeight = 48) => {
    ensureSpace(42 + followingHeight)
    drawText(marginX, y, value, 15, true, colors.ink)
    y -= 13
    add(`${colors.green} RG`)
    add(`1.4 w ${marginX} ${y} m ${marginX + 34} ${y} l S`)
    add(`${colors.line} RG`)
    add(`0.6 w ${marginX + 42} ${y} m ${pageWidth - marginX} ${y} l S`)
    y -= 18
  }

  // Cover page: two contained panels and no orphaned content headings.
  add(logoPdfOps(pageWidth, 34, 72, marginX))
  drawText(
    pageWidth - marginX - 154,
    790,
    `${input.businessName} - ${input.month}`,
    7,
    true,
    colors.green,
  )
  drawText(marginX, 744, copy.reportLabel, 8, true, colors.green)
  drawText(marginX, 719, documentTitle, 25, true, colors.ink)
  const subtitle = input.type === 'research' ? copy.researchSubtitle : copy.strategySubtitle
  let coverSubtitleY = 695
  for (const row of wrap(subtitle, 96)) {
    drawText(marginX, coverSubtitleY, row, 9.5, false, colors.muted)
    coverSubtitleY -= 14
  }
  drawRule(coverSubtitleY - 5)

  const businessTop = coverSubtitleY - 34
  const businessHeight = 156
  drawRoundedRect(marginX, businessTop, contentWidth, businessHeight, 14, colors.green)
  drawText(marginX + 24, businessTop - 25, copy.reportForBusiness, 8, true, colors.greenLight)
  drawText(marginX + 24, businessTop - 53, input.businessName, 20, true, colors.white)
  let businessY = businessTop - 77
  for (const row of wrap(input.businessDescription || copy.businessDescription, 86).slice(0, 3)) {
    drawText(marginX + 24, businessY, row, 9, false, colors.greenLight)
    businessY -= 13
  }
  const businessFooterY = businessTop - businessHeight + 28
  add(`0.20 0.50 0.39 RG`)
  add(
    `0.6 w ${marginX + 24} ${businessFooterY + 16} m ${pageWidth - marginX - 24} ${businessFooterY + 16} l S`,
  )
  drawText(marginX + 24, businessFooterY, input.industry || copy.business, 8, true, colors.white)
  drawText(
    marginX + 205,
    businessFooterY,
    input.city || copy.locationFallback,
    8,
    false,
    colors.greenLight,
  )
  drawText(pageWidth - marginX - 78, businessFooterY, input.month, 8, false, colors.greenLight)

  const coverText =
    input.type === 'research' && input.research
      ? researchSections(input.research, input.language)
          .flatMap((section) => section.lines)
          .map((line) => line.text)
          .join(' ')
      : input.strategy?.objective || ''
  const summaryTop = businessTop - businessHeight - 24
  const summaryHeight = 224
  drawRoundedRect(marginX, summaryTop, contentWidth, summaryHeight, 14, colors.green)
  drawText(
    marginX + 24,
    summaryTop - 25,
    input.type === 'research' ? copy.researchEntry : copy.strategyEntry,
    8,
    true,
    colors.greenLight,
  )
  drawText(
    marginX + 24,
    summaryTop - 52,
    input.type === 'research' ? copy.researchEntryTitle : copy.strategyReport,
    17,
    true,
    colors.white,
  )
  let summaryY = summaryTop - 79
  for (const row of wrap(coverText, 88).slice(0, 5)) {
    drawText(marginX + 24, summaryY, row, 8.5, false, colors.white)
    summaryY -= 13
  }
  if (input.type === 'research' && input.research) {
    const statsRuleY = summaryTop - summaryHeight + 58
    add(`0.20 0.50 0.39 RG`)
    add(
      `0.6 w ${marginX + 24} ${statsRuleY + 18} m ${pageWidth - marginX - 24} ${statsRuleY + 18} l S`,
    )
    const researchDate = input.research.researchedAt?.slice(0, 10) || input.month
    for (const [x, label, value] of [
      [marginX + 24, copy.sourcesConsulted, String(input.research.sources.length)],
      [marginX + 194, copy.approvedSources, String(input.research.sources.length)],
      [marginX + 364, copy.researchDate, researchDate],
    ] as Array<[number, string, string]>) {
      drawText(x, statsRuleY, label, 6.5, false, colors.greenLight)
      drawText(x, statsRuleY - 15, value, 9, true, colors.white)
    }
  }

  if (input.type === 'research' && input.research) {
    const sections = researchSections(input.research, input.language)
    startPage(copy.findings, copy.approvedSourcesDescription)
    for (const section of sections) {
      const first = section.lines[0]
      const firstHeight = first
        ? first.bullet
          ? cardMetrics(first.text).height + 10
          : paragraphHeight(first.text) + 8
        : 48
      // The research payload may include a generic "Explanation" heading even
      // though the PDF page already has the localized findings heading. Avoid
      // rendering that duplicate heading while preserving specific topic titles.
      const sectionTitle = section.title
        ? localizedResearchSectionTitle(section.title, input.language)
        : ''
      const normalizedSectionTitle = sectionTitle.trim().toLocaleLowerCase('en')
      const duplicateExplanationHeading =
        normalizedSectionTitle === 'explanation' || normalizedSectionTitle === 'shpjegimi'
      if (sectionTitle && !duplicateExplanationHeading) drawSectionTitle(sectionTitle, firstHeight)
      for (const item of section.lines) {
        if (item.bullet) drawFindingCard(item.text)
        else {
          ensureSpace(paragraphHeight(item.text) + 12)
          drawParagraph(item.text)
          y -= 10
        }
      }
      y -= 4
    }

    const firstSourceHeight = 58
    drawSectionTitle(copy.approvedSources, firstSourceHeight)
    drawParagraph(copy.approvedSourcesDescription, marginX, 90, 9, 14)
    y -= 10
    for (const [index, source] of input.research.sources.entries()) {
      const titleRows = wrap(clean(source.title), 68)
      const urlRows = wrap(`${host(source.url)} - ${source.url}`, 84)
      const height = Math.max(54, titleRows.length * 13 + urlRows.length * 11 + 20)
      ensureSpace(height + 9)
      const top = y
      drawRoundedRect(marginX, top, contentWidth, height, 6, colors.greenPale)
      drawRect(marginX, top - 6, 4, height - 12, colors.green)
      drawRoundedRect(marginX + 14, top - 14, 22, 22, 6, colors.green)
      drawText(marginX + 21, top - 29, String(index + 1), 8, true, colors.white)
      let baseline = top - 20
      for (const row of titleRows) {
        drawText(marginX + 46, baseline, row, 9, true, colors.ink)
        baseline -= 13
      }
      for (const row of urlRows) {
        drawText(marginX + 46, baseline - 1, row, 7.5, false, colors.muted)
        baseline -= 11
      }
      y -= height + 9
    }
  } else if (input.strategy) {
    startPage(copy.strategyExplanation)
    drawParagraph(input.strategy.rationale)
    y -= 14
    drawSectionTitle(copy.audience, paragraphHeight(input.strategy.audience))
    drawParagraph(input.strategy.audience)
    y -= 16
    drawSectionTitle(copy.editorialPlan, 112)
    for (const [index, slot] of input.strategy.slots.entries()) {
      const hookRows = wrap(slot.hook, 76)
      const purposeRows = wrap(slot.purpose, 76)
      const height = Math.max(104, 58 + (hookRows.length + purposeRows.length) * 13)
      ensureSpace(height + 10)
      const top = y
      drawRoundedRect(marginX, top, contentWidth, height, 7, colors.greenPale)
      drawText(marginX + 16, top - 21, `${index + 1}. ${clean(slot.topic)}`, 10.5, true, colors.ink)
      drawText(
        marginX + 16,
        top - 39,
        `${slot.channel} - ${copy.day} ${slot.day} - ${slot.time}`,
        8,
        true,
        colors.green,
      )
      let baseline = top - 59
      for (const row of [...hookRows, ...purposeRows]) {
        drawText(marginX + 16, baseline, row, 9, false, colors.muted)
        baseline -= 13
      }
      y -= height + 10
    }
    const approvedStrategySources = [
      ...new Set(input.strategy.slots.flatMap((slot) => slot.sourceUrls)),
    ].filter((url) => input.research?.sources.some((source) => source.url === url))
    if (approvedStrategySources.length) {
      drawSectionTitle(copy.strategySources, 40)
      for (const [index, url] of approvedStrategySources.entries()) {
        const rows = wrap(`${index + 1}. ${host(url)} - ${url}`, 86)
        ensureSpace(rows.length * 14 + 8)
        for (const row of rows) {
          drawText(marginX, y, row, 8.5, false, colors.muted)
          y -= 14
        }
        y -= 5
      }
    }
  }

  // A restrained footer anchors every page and makes continuation pages clear.
  const pageCount = pages.length
  for (let index = 0; index < pageCount; index += 1) {
    const current = pages[index]!
    current.push(`${colors.line} RG`)
    current.push(`0.6 w ${marginX} 40 m ${pageWidth - marginX} 40 l S`)
    current.push(`${colors.muted} rg`)
    current.push(`BT /F1 7 Tf ${marginX} 25 Td (${pdfText(`Rrit - ${input.businessName}`)}) Tj ET`)
    current.push(
      `BT /F1 7 Tf ${pageWidth - marginX - 52} 25 Td (${pdfText(`${index + 1} / ${pageCount}`)}) Tj ET`,
    )
  }

  const pageObjects: string[] = []
  const contentObjects: string[] = []
  const regularFont = 3 + pageCount
  const boldFont = regularFont + 1
  const contentStart = boldFont + 1
  for (const current of pages) {
    const stream = current.join('\n')
    contentObjects.push(
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    )
  }
  for (let index = 0; index < pageCount; index += 1) {
    pageObjects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${regularFont} 0 R /F2 ${boldFont} 0 R >> >> /Contents ${contentStart + index} 0 R >>`,
    )
  }
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageObjects.map((_, index) => `${3 + index} 0 R`).join(' ')}] /Count ${pageCount} >>`,
    ...pageObjects,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    ...contentObjects,
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'latin1'))
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(body, 'latin1')
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  body += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}
