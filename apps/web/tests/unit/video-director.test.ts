import { afterEach, describe, expect, it, vi } from 'vitest'
import { directorInstructions, directVideo, videoLengthLimits } from '../../server/utils/video-director'
import { buildShotExecutionBrief } from '../../server/utils/video-execution-brief'
import { directorStoryboardSchema, storyboardProblems, storyboardSchema, storyboardShape, type Storyboard } from '../../shared/schemas/storyboard'

// The configured model publishes these lengths; the director chooses the one
// the idea needs instead of filling a fixed target.
const limits = { durations: [4, 6, 8], minSeconds: 4, maxSeconds: 8, maxShots: 1 }

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
    concept: 'One continuous lateral rise follows evening light along the car and settles on the true frame.',
    rationale: 'A credible continuous move gives travellers context without redrawing the car.',
    cta: 'Rezervo sot',
    caption: 'Makina jote e radhës të pret. Rezervo sot.',
    subjectFrame: { top: 0.4, bottom: 0.85 },
    shots: [
      {
        purpose: 'A continuous hook, reveal and close along the photographed side of the car.',
        durationSeconds: 8,
        shotSize: 'medium',
        photoIndex: 0,
        role: 'continuous',
        motion: 'medium',
        camera: {
          move: 'A measured lateral slide rises slightly, then settles back onto the truthful frame.',
          lens: '35mm natural perspective',
          speed: 'measured with a clear opening impulse',
          ease: 'ease-out, steady middle, gentle ease-in close',
          rotationDegrees: 40,
          startPosition: 'Low and left of the photographed front corner.',
          endPosition: 'At natural eye level on the same photographed side.',
          angle: 'low_angle',
          composition: 'The car holds the central safe area with calm negative space above it.',
        },
        atmosphere: 'Evening light with a warm streak across the sky.',
        effects: 'Natural reflections travel gently along the existing paint.',
        subject: { motion: 'still', description: 'The car stands exactly where it is in the photograph.' },
        opensOnPhotograph: true,
        endsOnPhotograph: false,
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
  it('accepts one realistic continuous take', () => {
    expect(storyboardSchema.parse(storyboard())).toBeTruthy()
    expect(storyboardProblems(storyboard(), limits)).toEqual([])
  })

  it('allows a full orbit but no more in the schema', () => {
    const turned = storyboard()
    turned.shots[0]!.camera.rotationDegrees = 360
    expect(storyboardSchema.safeParse(turned).success).toBe(true)
    turned.shots[0]!.camera.rotationDegrees = 361
    expect(storyboardSchema.safeParse(turned).success).toBe(false)
  })

  it('rejects a gentle opening move unless it soars', () => {
    const gentle = storyboard()
    gentle.shots[0]!.camera.rotationDegrees = 8
    gentle.shots[0]!.camera.move = 'A slow tracking slide along the table.'
    expect(storyboardProblems(gentle, limits).join(' ')).toContain('too gentle')
    gentle.shots[0]!.camera.move = 'A drone rise over the terrace.'
    expect(storyboardProblems(gentle, limits).join(' ')).not.toContain('too gentle')
  })

  it('allows orbits, reveals, arrivals and detail shots, and rejects a take not opened on the photograph', () => {
    const orbit = storyboard()
    orbit.shots[0]!.camera.move = 'A full 360 orbit around the car, then a drone rise.'
    orbit.shots[0]!.camera.rotationDegrees = 360
    orbit.shots[0]!.purpose = 'Reveal the rear view of the car.'
    orbit.shots[0]!.shotSize = 'detail'
    orbit.shots[0]!.subject.motion = 'arrives'
    expect(storyboardProblems(orbit, limits)).toEqual([])
    const open = storyboard()
    open.shots[0]!.opensOnPhotograph = false
    expect(storyboardProblems(open, limits).join(' ')).toContain('must start on')
    const pinned = storyboard()
    pinned.shots[0]!.endsOnPhotograph = true
    expect(storyboardProblems(pinned, limits).join(' ')).toContain('must not end on')
  })

  it('chooses an earned supported duration rather than filling a fixed maximum', () => {
    for (const durationSeconds of [4, 6, 8]) {
      const planned = storyboard()
      planned.shots[0]!.durationSeconds = durationSeconds
      expect(storyboardProblems(planned, limits)).toEqual([])
    }
    const unsupported = storyboard()
    unsupported.shots[0]!.durationSeconds = 7
    expect(storyboardProblems(unsupported, limits).join(' ')).toContain('one of 4, 6, 8 seconds')
  })

  it('uses additional photographs only as identity evidence, never as another scene', () => {
    const anotherAngle = storyboard()
    anotherAngle.shots[0]!.photoIndex = 1
    expect(storyboardProblems(anotherAngle, { ...limits, photos: 2 }).join(' ')).toContain('must use photograph 1')
  })

  it('requires one continuous role and one visible motivated camera path', () => {
    const wrongRole = storyboard()
    wrongRole.shots[0]!.role = 'hook'
    expect(storyboardProblems(wrongRole, limits).join(' ')).toContain('role continuous')
    const locked = storyboard()
    locked.shots[0]!.camera.move = 'Locked tripod frame on the car.'
    expect(storyboardProblems(locked, limits).join(' ')).toContain('visible, motivated camera path')
  })

  it('derives the available range from the provider instead of an application default', () => {
    expect(videoLengthLimits([4, 6, 8], {})).toEqual({ durations: [4, 6, 8], minSeconds: 4, maxSeconds: 8, maxShots: 1 })
    expect(videoLengthLimits([], {})).toEqual({ durations: [6], minSeconds: 6, maxSeconds: 6, maxShots: 1 })
    expect(videoLengthLimits([4, 6, 8], {}, 3)).toEqual({ durations: [4, 6, 8], minSeconds: 4, maxSeconds: 24, maxShots: 3, photos: 3 })
    expect(videoLengthLimits([4, 6, 8], { VIDEO_MAX_SECONDS: '12' }, 2)).toMatchObject({ maxSeconds: 12, maxShots: 2, photos: 2 })
    expect(storyboardShape(limits)).toEqual({ minShots: 1, maxShots: 1, totalSeconds: 8 })
  })
})

describe('the creative director', () => {
  it('states the one-photograph rules and the channel, but no scene of its own', () => {
    const brief = directorInstructions(input)
    expect(brief).toContain('one continuous generated take for TikTok, on a 9:16 canvas')
    expect(brief).toContain('Choose exactly one duration from 4, 6, 8 seconds')
    expect(brief).toContain('shortest duration that lets this exact idea breathe')
    expect(brief).toContain('no cuts, no stitched scenes, no montage')
    expect(brief).toContain('orbit or arc around the subject (up to a full 360)')
    expect(brief).toContain('drone rise')
    expect(brief).not.toContain('descending from the sky')
    const several = directorInstructions({ ...input, limits: { ...limits, photos: 2 } })
    expect(several).toContain('reference evidence for identity only')
    expect(brief).toContain('never default to a plain zoom in or out')
    expect(brief).toContain('Albanian')
    expect(brief).toContain('the bottom 25%')
    expect(brief).toContain('Audience direction: the declared audience is Travellers')
    expect(brief).toContain('TikTok direction')
    expect(brief).toContain('Creative-variety challenge for this specific post')
    expect(brief).toContain('startPosition and endPosition are concrete places')
  })

  it('asks for a calmer concept after a take changed the subject', async () => {
    const fetcher = vi.fn().mockResolvedValue(answer(storyboard()))
    vi.stubGlobal('fetch', fetcher)
    const previousAttempt = { storyboard: storyboard(), problem: 'Shot 1: the wheels changed design' }
    expect(directorInstructions({ ...input, previousAttempt })).toContain('Propose a safer version')
    expect(directorInstructions({ ...input, previousAttempt })).toContain('never a locked, static or tripod frame')
    expect(directorInstructions(input)).not.toContain('Propose a safer version')
    await directVideo({ ...input, previousAttempt })
    const sent = JSON.parse(JSON.parse(fetcher.mock.calls[0]![1].body).input[0].content[0].text)
    expect(sent.previousAttempt.problem).toBe('Shot 1: the wheels changed design')
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

  it('carries the post-specific visual hierarchy into motion without prescribing a template', () => {
    const brief = directorInstructions({
      ...input,
      post: {
        ...input.post,
        visualLayout: 'Anchor the real car low-left, keep layered street depth and reserve the upper-right for type.',
        visualRoute: {
          approach: 'photo_preserving',
          subjectScale: 'contextual',
          focalAnchor: 'lower_left',
          textZone: 'right',
          depth: 'deep',
          energy: 'balanced',
          typeTreatment: 'restrained_editorial',
        },
      },
    })
    expect(brief).toContain('strategy chose this photograph-specific visual direction')
    expect(brief).toContain('"focalAnchor":"lower_left"')
    expect(brief).toContain('invent the camera blocking yourself')
  })

  it('returns a valid storyboard and what it cost', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(storyboard())))
    const result = await directVideo(input)
    expect(result.storyboard?.shots).toHaveLength(1)
    expect(result.storyboard?.shots[0]!.role).toBe('continuous')
    expect(result.costUsd).toBeCloseTo(0.002)
  })

  it('sends a storyboard that breaks the rules back once, with what was wrong', async () => {
    const pinned = storyboard()
    pinned.shots[0]!.endsOnPhotograph = true
    const fetcher = vi.fn()
      .mockResolvedValueOnce(answer(pinned))
      .mockResolvedValueOnce(answer(storyboard()))
    vi.stubGlobal('fetch', fetcher)
    const result = await directVideo(input)
    expect(result.storyboard?.shots[0]!.endsOnPhotograph).toBe(false)
    const retry = JSON.parse(fetcher.mock.calls[1]![1].body)
    expect(JSON.parse(retry.input[0].content[0].text).correctionsFromYourLastStoryboard[0]).toContain('must not end on')
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
  it('briefs the continuous take like a cinematographer and keeps the subject rules', () => {
    const brief = buildShotExecutionBrief({ storyboard: storyboard(), index: 0, start: 'photograph', endsOnPhotograph: true, guardrails: ['No speed claims.'] })
    expect(brief).toContain('8-second shot, shot 1 of 1')
    expect(brief).toContain('starts exactly on the supplied first frame, a real photograph')
    expect(brief).toContain('ends exactly on the supplied last frame, the real photograph')
    expect(brief).toContain('Lens: 35mm natural perspective')
    expect(brief).toContain('gentle ease-in close')
    expect(brief).toContain('Turn around the subject 40 degrees')
    expect(brief).toContain('start Low and left of the photographed front corner')
    expect(brief).toContain('angle low_angle')
    expect(brief).toContain('calm negative space above it')
    expect(brief).toContain('Keep the subject identical in every frame')
    expect(brief).toContain('No speed claims.')
  })

  it('forbids cuts and scene changes inside the generated take', () => {
    const brief = buildShotExecutionBrief({ storyboard: storyboard(), index: 0, start: 'photograph', endsOnPhotograph: true })
    expect(brief).toContain('No cuts, scene changes')
    expect(brief).toContain('starts exactly on the supplied first frame')
  })

  it('shortens the director prose, never the rules, to fit a prompt limit', () => {
    const full = buildShotExecutionBrief({ storyboard: storyboard(), index: 0, start: 'photograph', endsOnPhotograph: false })
    const short = buildShotExecutionBrief({ storyboard: storyboard(), index: 0, start: 'photograph', endsOnPhotograph: false, maxLength: full.length - 40 })
    expect(short.length).toBeLessThanOrEqual(full.length - 40)
    expect(short).toContain('Never morph, replace, restyle or swap it')
  })
})

describe('a video from several photographs', () => {
  const several = { durations: [4, 6, 8], minSeconds: 4, maxSeconds: 16, maxShots: 2, photos: 2 }
  const scenes = () => {
    const board = storyboard()
    const hook = { ...board.shots[0]!, role: 'hook' as const, motion: 'strong' as const, photoIndex: 1, shotSize: 'close' as const }
    const close = { ...board.shots[0]!, role: 'close' as const, motion: 'medium' as const, photoIndex: 0, shotSize: 'wide' as const }
    return { ...board, shots: [hook, close] }
  }

  it('accepts one scene per photograph, closing on the main one', () => {
    expect(storyboardProblems(scenes(), several)).toEqual([])
    expect(directorStoryboardSchema.safeParse(scenes()).success).toBe(true)
  })

  it('rejects a cut that skips a photograph or closes on another', () => {
    const skipped = scenes()
    skipped.shots[0]!.photoIndex = 0
    expect(storyboardProblems(skipped, several).join(' ')).toContain('different photographs')
    const swapped = scenes()
    swapped.shots[0]!.photoIndex = 0
    swapped.shots[1]!.photoIndex = 1
    expect(storyboardProblems(swapped, several).join(' ')).toContain('photograph 1')
  })

  it('briefs the director for a cut with one scene per photograph', () => {
    const brief = directorInstructions({ ...input, limits: several })
    expect(brief).toContain('told in exactly 2 shots, one scene per supplied photograph')
    expect(brief).toContain('Return exactly 2 shots')
    expect(brief).not.toContain('reference evidence for identity only')
  })
})
