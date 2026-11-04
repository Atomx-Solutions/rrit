import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createError } from 'h3'
import {
  downloadVideoContent,
  pollVideoJob,
  submitVideoJob,
  videoProviderSettings,
} from '../../server/utils/ai-video-provider'

beforeEach(() => {
  vi.stubGlobal('createError', createError)
})

const settings = videoProviderSettings({
  OPENROUTER_VIDEO_POLL_SECONDS: '2',
  OPENROUTER_VIDEO_TIMEOUT_SECONDS: '60',
  OPENROUTER_VIDEO_MAX_FAILURES: '3',
  OPENROUTER_VIDEO_SUBMIT_ATTEMPTS: '3',
})

function fakeClock() {
  let time = 0
  return {
    now: () => time,
    sleep: vi.fn(async (ms: number) => {
      time += ms
    }),
  }
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers })

describe('following a video job', () => {
  it('asks again after a dropped connection, a busy provider or an answer that is not JSON', async () => {
    // Two failures, an answer that resets the count, then a third failure:
    // never three in a row, so the job is followed to the end.
    const answers = [
      () => Promise.reject(new Error('socket hang up')),
      () => Promise.resolve(json({ error: 'busy' }, 503)),
      () => Promise.resolve(json({ status: 'in_progress' })),
      () => Promise.resolve(new Response('<html>gateway</html>', { status: 200 })),
      () => Promise.resolve(json({ status: 'completed', usage: { cost: 0.4 } })),
    ]
    const ask = vi.fn(() => answers.shift()!())
    await expect(pollVideoJob(ask, settings, fakeClock())).resolves.toMatchObject({ status: 'completed' })
    expect(ask).toHaveBeenCalledTimes(5)
  })

  it('gives up after too many failed asks in a row', async () => {
    const ask = vi.fn(() => Promise.resolve(json({}, 502)))
    await expect(pollVideoJob(ask, settings, fakeClock())).rejects.toMatchObject({ statusCode: 502 })
    expect(ask).toHaveBeenCalledTimes(3)
  })

  it('ends at once when the provider says the job failed or refuses the question', async () => {
    await expect(
      pollVideoJob(() => Promise.resolve(json({ status: 'failed', error: 'content policy' })), settings, fakeClock()),
    ).rejects.toMatchObject({ message: 'content policy' })
    const refused = vi.fn(() => Promise.resolve(json({ error: { message: 'not found' } }, 404)))
    await expect(pollVideoJob(refused, settings, fakeClock())).rejects.toMatchObject({ message: 'not found' })
    expect(refused).toHaveBeenCalledTimes(1)
  })

  it('stops waiting once the job has taken longer than the timeout', async () => {
    const ask = vi.fn(() => Promise.resolve(json({ status: 'in_progress' })))
    await expect(pollVideoJob(ask, settings, fakeClock())).rejects.toMatchObject({
      statusCode: 504,
      message: 'server.VIDEO_GENERATION_TIMEOUT',
    })
    expect(ask).toHaveBeenCalledTimes(30)
  })
})

describe('downloading a finished video', () => {
  it('asks again when the download drops, so a paid video is not lost', async () => {
    const answers = [
      () => Promise.reject(new Error('reset')),
      () => Promise.resolve(new Response('busy', { status: 503 })),
      () => Promise.resolve(new Response(new Uint8Array([1, 2, 3]))),
    ]
    const bytes = await downloadVideoContent(() => answers.shift()!(), settings, fakeClock())
    expect([...bytes]).toEqual([1, 2, 3])
  })

  it('does not ask again when the file is refused', async () => {
    const download = vi.fn(() => Promise.resolve(new Response('gone', { status: 404 })))
    await expect(downloadVideoContent(download, settings, fakeClock())).rejects.toMatchObject({
      message: 'server.VIDEO_DOWNLOAD_FAILED',
    })
    expect(download).toHaveBeenCalledTimes(1)
  })
})

describe('submitting a video job', () => {
  it('sends a rate-limited submission again after the wait the provider asks for', async () => {
    const clock = fakeClock()
    const answers = [json({ error: 'slow down' }, 429, { 'retry-after': '7' }), json({ id: 'job-1' })]
    const send = vi.fn(() => Promise.resolve(answers.shift()!))
    await expect(submitVideoJob(send, settings, clock)).resolves.toMatchObject({ id: 'job-1' })
    expect(clock.sleep).toHaveBeenCalledWith(7000)
  })

  it('never sends twice a submission that may already have started a paid job', async () => {
    const send = vi.fn(() => Promise.resolve(json({ error: 'upstream' }, 502)))
    await expect(submitVideoJob(send, settings, fakeClock())).rejects.toMatchObject({ message: 'upstream' })
    expect(send).toHaveBeenCalledTimes(1)
  })
})
