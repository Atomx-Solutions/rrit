import { afterEach, describe, expect, it, vi } from 'vitest'
import { directorInstructions, directVideo } from '../../server/utils/video-director'
import { buildStoryboardExecutionBrief } from '../../server/utils/video-execution-brief'
import { storyboardProblems, storyboardSchema, type Storyboard } from '../../shared/schemas/storyboard'

vi.mock('../../server/utils/ai-provider', () => ({
  aiProviderConfiguration: () => ({ name: 'openai', responsesUrl: 'https://example.test/responses', headers: {} }),
  aiProviderJsonSchema: (schema: unknown) => schema,
  aiProviderModel: () => 'director-model',
  aiProviderStructuredRouting: () => ({}),
}))

afterEach(() => vi.unstubAllGlobals())

// A concept the director might invent for a rent-a-car. The test only uses it
// as data; nothing like it exists in the application code.
function storyboard(overrides: Partial<Storyboard> = {}): Storyboard {
  return {
    concept: 'The car descends from a stormy sky, lands softly and the camera rises to reveal the city.',
    rationale: 'A dramatic arrival fits a premium rental launch.',
    cta: 'Rezervo sot',
    caption: 'Makina jote e radhës të pret. Rezervo sot.',
    shots: [
      {
        purpose: 'The arrival: the car lowers into its photographed place.',
        durationSeconds: 3,
        camera: { move: 'Low drone hold tilting down as the car descends.', lens: '24mm wide', speed: 'slow', ease: 'ease-out on landing', rotationDegrees: 0 },
        atmosphere: 'Storm clouds clearing to golden light.',
        effects: 'Dust lifting at touchdown.',
        subject: { motion: 'arrives', description: 'The car settles exactly where it stands in the photograph.' },
        opensOnPhotograph: false,
        endsOnPhotograph: false,
        showsOnlyPhotographedSides: true,
      },
      {
        purpose: 'The reveal: the camera arcs a little and rises.',
        durationSeconds: 3,
        camera: { move: 'Gentle 30 degree arc combined with a rise.', lens: '35mm', speed: 'measured', ease: 'ease-in-out', rotationDegrees: 30 },
        atmosphere: 'Golden hour, wet asphalt reflections.',
        effects: 'Light sliding along the bodywork.',
        subject: { motion: 'still', description: 'The car holds still while light moves across it.' },
        opensOnPhotograph: true,
        endsOnPhotograph: true,
        showsOnlyPhotographedSides: true,
      },
    ],
    ...overrides,
  }
}

function answer(value: unknown, cost = 0.002) {
  return {
    ok: true,
    json: async () => ({
      id: 'r',
      status: 'completed',
      usage: { input_tokens: 10, output_tokens: 10, cost },
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
    }),
  }
}

const input = {
  photograph: Buffer.from('photo'),
  channel: 'TikTok' as const,
  totalSeconds: 6,
  locale: 'sq-XK' as const,
  brand: { name: 'Hamza Rent a Car', industry: 'Car rental', audience: 'Travellers' },
  post: { title: 'Range Rover', caption: 'Rezervo', hook: 'Udhëtimi fillon', cta: 'Rezervo sot' },
}

describe('storyboard rules', () => {
  it('accepts a valid one-photograph storyboard', () => {
    expect(storyboardSchema.parse(storyboard())).toBeTruthy()
    expect(storyboardProblems(storyboard(), 6)).toEqual([])
  })

  it('rejects a turn of more than 45 degrees in the schema', () => {
    const turned = storyboard()
    turned.shots[1]!.camera.rotationDegrees = 90
    expect(storyboardSchema.safeParse(turned).success).toBe(false)
  })

  it('rejects a 360 orbit, a hidden side and a video that does not end on the photograph', () => {
    const orbit = storyboard()
    orbit.shots[1]!.camera.move = 'A full 360 orbit around the car.'
    expect(storyboardProblems(orbit, 6).join(' ')).toContain('Shot 2')
    const back = storyboard()
    back.shots[0]!.purpose = 'Show the rear view of the car.'
    expect(storyboardProblems(back, 6).join(' ')).toContain('Shot 1')
    const unconfirmed = storyboard()
    unconfirmed.shots[0]!.showsOnlyPhotographedSides = false
    expect(storyboardProblems(unconfirmed, 6)).toHaveLength(1)
    const open = storyboard()
    open.shots[1]!.endsOnPhotograph = false
    expect(storyboardProblems(open, 6).join(' ')).toContain('final shot')
  })

  it('requires the shots to fill the video exactly', () => {
    expect(storyboardProblems(storyboard(), 8).join(' ')).toContain('8 seconds')
  })
})

describe('the creative director', () => {
  it('states the one-photograph rules and the channel, but no scene of its own', () => {
    const brief = directorInstructions(input)
    expect(brief).toContain('TikTok, on a 9:16 canvas, 6 seconds')
    expect(brief).toContain('at most 45 degrees')
    expect(brief).toContain('never 360 degrees')
    expect(brief).toContain('Albanian')
    expect(brief).toContain('the bottom 25%')
  })

  it('returns a valid storyboard and what it cost', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(storyboard())))
    const result = await directVideo(input)
    expect(result.storyboard?.shots).toHaveLength(2)
    expect(result.costUsd).toBeCloseTo(0.002)
  })

  it('sends a storyboard that breaks the rules back once, with what was wrong', async () => {
    const orbit = storyboard()
    orbit.shots[1]!.camera.move = 'A full 360 orbit around the car.'
    const fetcher = vi.fn()
      .mockResolvedValueOnce(answer(orbit))
      .mockResolvedValueOnce(answer(storyboard()))
    vi.stubGlobal('fetch', fetcher)
    const result = await directVideo(input)
    expect(result.storyboard?.shots[1]!.camera.move).not.toContain('360')
    const retry = JSON.parse(fetcher.mock.calls[1]![1].body)
    expect(JSON.parse(retry.input[0].content[0].text).correctionsFromYourLastStoryboard[0]).toContain('Shot 2')
    expect(result.costUsd).toBeCloseTo(0.004)
  })

  it('gives no storyboard when both answers are unusable, and still reports their cost', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer({ concept: 'too thin' })))
    const result = await directVideo(input)
    expect(result.storyboard).toBeNull()
    expect(result.costUsd).toBeCloseTo(0.004)
  })
})

describe('the cinematic motion prompt', () => {
  it('briefs every beat like a cinematographer and keeps the subject rules', () => {
    const brief = buildStoryboardExecutionBrief({ storyboard: storyboard(), guardrails: ['No speed claims.'] })
    expect(brief).toContain('6-second video')
    expect(brief).toContain('0s-3s (beat 1)')
    expect(brief).toContain('3s-6s (beat 2)')
    expect(brief).toContain('Lens: 24mm wide')
    expect(brief).toContain('Ease: ease-out on landing')
    expect(brief).toContain('no more than 30 degrees')
    expect(brief).toContain('Keep the subject identical in every frame')
    expect(brief).toContain('No speed claims.')
  })

  it('shortens the director prose, never the rules, to fit a prompt limit', () => {
    const full = buildStoryboardExecutionBrief({ storyboard: storyboard() })
    const short = buildStoryboardExecutionBrief({ storyboard: storyboard(), maxLength: full.length - 40 })
    expect(short.length).toBeLessThanOrEqual(full.length - 40)
    expect(short).toContain('Show only what the photograph shows.')
  })
})
