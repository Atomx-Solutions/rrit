import { afterEach, describe, expect, it, vi } from 'vitest'
import { directorInstructions, directVideo } from '../../server/utils/video-director'
import { buildShotExecutionBrief } from '../../server/utils/video-execution-brief'
import { storyboardProblems, storyboardSchema, storyboardShape, type Storyboard } from '../../shared/schemas/storyboard'

// What a model like Veo publishes, with the configured 6 to 12 second video.
const limits = { durations: [4, 6, 8], minSeconds: 6, maxSeconds: 12 }

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
    subjectFrame: { top: 0.4, bottom: 0.85 },
    shots: [
      {
        purpose: 'The arrival: the car lowers into its photographed place.',
        durationSeconds: 4,
        shotSize: 'wide',
        photoIndex: 0,
        role: 'hook',
        motion: 'strong',
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
        durationSeconds: 8,
        shotSize: 'medium',
        photoIndex: 0,
        role: 'close',
        motion: 'medium',
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
  limits,
  locale: 'sq-XK' as const,
  brand: { name: 'Hamza Rent a Car', industry: 'Car rental', audience: 'Travellers' },
  post: { title: 'Range Rover', caption: 'Rezervo', hook: 'Udhëtimi fillon', cta: 'Rezervo sot' },
}

describe('storyboard rules', () => {
  it('accepts a valid one-photograph storyboard', () => {
    expect(storyboardSchema.parse(storyboard())).toBeTruthy()
    expect(storyboardProblems(storyboard(), limits)).toEqual([])
  })

  it('rejects a turn of more than 45 degrees in the schema', () => {
    const turned = storyboard()
    turned.shots[1]!.camera.rotationDegrees = 90
    expect(storyboardSchema.safeParse(turned).success).toBe(false)
  })

  it('rejects a 360 orbit, a hidden side and a video that does not end on the photograph', () => {
    const orbit = storyboard()
    orbit.shots[1]!.camera.move = 'A full 360 orbit around the car.'
    expect(storyboardProblems(orbit, limits).join(' ')).toContain('Shot 2')
    const back = storyboard()
    back.shots[0]!.purpose = 'Show the rear view of the car.'
    expect(storyboardProblems(back, limits).join(' ')).toContain('Shot 1')
    const unconfirmed = storyboard()
    unconfirmed.shots[0]!.showsOnlyPhotographedSides = false
    expect(storyboardProblems(unconfirmed, limits)).toHaveLength(1)
    const open = storyboard()
    open.shots[1]!.endsOnPhotograph = false
    expect(storyboardProblems(open, limits).join(' ')).toContain('final shot')
  })

  it('fills the whole configured length', () => {
    expect(storyboardProblems(storyboard(), { ...limits, maxSeconds: 10 }).join(' ')).toContain('must last 10 seconds together')
    const short = storyboard()
    short.shots[0]!.durationSeconds = 4
    short.shots[1]!.durationSeconds = 4
    expect(storyboardProblems(short, limits).join(' ')).toContain('must last 12 seconds together')
  })

  it('makes each scene from its own photograph and closes on the main one', () => {
    const twoPhotos = { ...limits, photos: 2 }
    // Both shots on the main photograph waste the second angle.
    expect(storyboardProblems(storyboard(), twoPhotos).join(' ')).toContain('Use 2 different photographs')
    const angles = storyboard()
    angles.shots[0]!.photoIndex = 1
    expect(storyboardProblems(angles, twoPhotos)).toEqual([])
    // The video must close on the main photograph.
    const reversed = storyboard()
    reversed.shots[1]!.photoIndex = 1
    expect(storyboardProblems(reversed, twoPhotos).join(' ')).toContain('final shot must be made from photograph 1')
    // A photograph that was not supplied cannot be used.
    expect(storyboardProblems(angles, limits).join(' ')).toContain('only 1 was supplied')
  })

  it('edits like a short-form ad: a strong hook and a real move in every shot but the close', () => {
    const weakHook = storyboard()
    weakHook.shots[0]!.motion = 'medium'
    expect(storyboardProblems(weakHook, limits).join(' ')).toContain('hook must move strongly')
    const noHook = storyboard()
    noHook.shots[0]!.role = 'build'
    expect(storyboardProblems(noHook, limits).join(' ')).toContain('Shot 1 must be the hook')
    const locked = storyboard()
    locked.shots[0]!.camera.move = 'Locked tripod frame on the car.'
    expect(storyboardProblems(locked, limits).join(' ')).toContain('give it a real, visible camera move')
    // The close may settle with a subtle move.
    const settling = storyboard()
    settling.shots[1]!.motion = 'subtle'
    settling.shots[1]!.camera.move = 'A static hold on the photograph.'
    expect(storyboardProblems(settling, limits)).toEqual([])
  })

  it('gives consecutive scenes their own framing', () => {
    const repeated = storyboard()
    repeated.shots[1]!.shotSize = 'wide'
    expect(storyboardProblems(repeated, limits).join(' ')).toContain('same wide framing as shot 1')
    // A storyboard stored before framing existed still reads without a problem.
    const stored = storyboard({ subjectFrame: undefined })
    stored.shots.forEach((shot) => { delete shot.shotSize })
    expect(storyboardProblems(stored, limits)).toEqual([])
  })

  it('tells every video in separate shots when the length holds them', () => {
    const single = storyboard({ shots: [storyboard().shots[1]!] })
    expect(storyboardProblems(single, limits).join(' ')).toContain('in 2 to 3 separate shots')
    expect(storyboardShape(limits)).toEqual({ minShots: 2, maxShots: 3, totalSeconds: 12 })
    // A length that holds only one shot still allows one.
    expect(storyboardShape({ ...limits, maxSeconds: 6 })).toEqual({ minShots: 1, maxShots: 1, totalSeconds: 6 })
  })

  it('allows only shot lengths the configured model renders', () => {
    const odd = storyboard()
    odd.shots[0]!.durationSeconds = 5
    odd.shots[1]!.durationSeconds = 7
    expect(storyboardProblems(odd, limits).join(' ')).toContain('one of 4, 6, 8 seconds')
    // Another model publishing other lengths changes the rule, not the code.
    expect(storyboardProblems(odd, { ...limits, durations: [5, 7] })).toEqual([])
  })
})

describe('the creative director', () => {
  it('states the one-photograph rules and the channel, but no scene of its own', () => {
    const brief = directorInstructions(input)
    expect(brief).toContain('TikTok, on a 9:16 canvas. Its shots last 12 seconds together')
    expect(brief).toContain('one of 4, 6, 8 seconds')
    expect(brief).toContain('told in 2 to 3 separate shots')
    expect(brief).toContain('at most 45 degrees')
    expect(brief).toContain('never 360 degrees')
    expect(brief).toContain('Albanian')
    expect(brief).toContain('the bottom 25%')
  })

  it('asks for a calmer concept after a take changed the subject', async () => {
    const fetcher = vi.fn().mockResolvedValue(answer(storyboard()))
    vi.stubGlobal('fetch', fetcher)
    const previousAttempt = { storyboard: storyboard(), problem: 'Shot 2: the wheels changed design' }
    expect(directorInstructions({ ...input, previousAttempt })).toContain('Propose a calmer concept')
    expect(directorInstructions(input)).not.toContain('Propose a calmer concept')
    await directVideo({ ...input, previousAttempt })
    const sent = JSON.parse(JSON.parse(fetcher.mock.calls[0]![1].body).input[0].content[0].text)
    expect(sent.previousAttempt.problem).toBe('Shot 2: the wheels changed design')
  })

  it('puts the business request from Edit video with AI ahead of its own ideas', async () => {
    const fetcher = vi.fn().mockResolvedValue(answer(storyboard()))
    vi.stubGlobal('fetch', fetcher)
    const userInstruction = 'Makina të qëndrojë e palëvizur, kamera të ngrihet ngadalë.'
    expect(directorInstructions({ ...input, userInstruction })).toContain('Follow it ahead of your own ideas')
    await directVideo({ ...input, userInstruction })
    const sent = JSON.parse(JSON.parse(fetcher.mock.calls[0]![1].body).input[0].content[0].text)
    expect(sent.businessRequest).toBe(userInstruction)
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

describe('the cinematic shot prompt', () => {
  it('briefs one shot like a cinematographer and keeps the subject rules', () => {
    const brief = buildShotExecutionBrief({ storyboard: storyboard(), index: 1, start: 'previous_shot', endsOnPhotograph: true, guardrails: ['No speed claims.'] })
    expect(brief).toContain('8-second shot, shot 2 of 2')
    expect(brief).toContain('the last frame of the previous shot')
    expect(brief).toContain('ends exactly on the supplied last frame, the real photograph')
    expect(brief).toContain('Lens: 35mm')
    expect(brief).toContain('Ease: ease-in-out')
    expect(brief).toContain('no more than 30 degrees')
    expect(brief).toContain('Keep the subject identical in every frame')
    expect(brief).toContain('No speed claims.')
  })

  it('lets an arrival open away from the photograph', () => {
    const brief = buildShotExecutionBrief({ storyboard: storyboard(), index: 0, start: 'free', endsOnPhotograph: true })
    expect(brief).toContain('before the subject is in its photographed place')
    expect(brief).not.toContain('starts exactly on the supplied first frame')
  })

  it('shortens the director prose, never the rules, to fit a prompt limit', () => {
    const full = buildShotExecutionBrief({ storyboard: storyboard(), index: 0, start: 'photograph', endsOnPhotograph: false })
    const short = buildShotExecutionBrief({ storyboard: storyboard(), index: 0, start: 'photograph', endsOnPhotograph: false, maxLength: full.length - 40 })
    expect(short.length).toBeLessThanOrEqual(full.length - 40)
    expect(short).toContain('Show only what the photograph shows.')
  })
})
