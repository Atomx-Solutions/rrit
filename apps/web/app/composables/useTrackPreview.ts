// One player for every music list on the page, so starting a track stops the
// one playing in another list instead of the two playing over each other.
const playing = ref<string | null>(null)
let player: HTMLAudioElement | null = null

function stop() {
  player?.pause()
  playing.value = null
}

function toggle(trackId: string) {
  if (playing.value === trackId) return stop()
  player ||= new Audio()
  player.onended = stop
  player.src = `/api/music/${trackId}`
  playing.value = trackId
  player.play().catch(stop)
}

export function useTrackPreview() {
  return { playing: readonly(playing), toggle, stop }
}
