import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { shotDirectionSchema, storedShotDirectionSchema } from '../../shared/schemas/monthly-plan'

describe('the strategy shot of a video slot', () => {
  it('names no camera move: the motion is the creative director’s', () => {
    const fields = Object.keys((z.toJSONSchema(shotDirectionSchema) as { properties: object }).properties)
    expect(fields.sort()).toEqual(['endCard', 'textZone'])
  })

  it('still reads a shot stored with the old camera presets', () => {
    const stored = storedShotDirectionSchema.parse({
      camera: 'slow_push',
      pacing: 'measured',
      subjectAnchor: 'centre',
      textZone: 'bottom',
      action: 'camera_only',
      endCard: false,
    })
    expect(stored).toEqual({ textZone: 'bottom', endCard: false })
    expect(storedShotDirectionSchema.parse({})).toEqual({ textZone: 'top', endCard: true })
  })
})
