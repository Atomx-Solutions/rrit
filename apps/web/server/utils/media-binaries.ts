import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'

// The programs that compose and inspect videos. A host that provides its own
// names them in FFMPEG_PATH / FFPROBE_PATH; otherwise the builds packaged with
// the app are used, since a Vercel function has none on its PATH.
export function ffmpegBinary() {
  return process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg'
}

export function ffprobeBinary() {
  return process.env.FFPROBE_PATH || ffprobeStatic.path || 'ffprobe'
}
