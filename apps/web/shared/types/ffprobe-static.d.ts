// ffprobe-static ships no types of its own: it exports the path of the
// ffprobe build for the platform it is installed on.
declare module 'ffprobe-static' {
  const ffprobe: { path: string }
  export default ffprobe
}
