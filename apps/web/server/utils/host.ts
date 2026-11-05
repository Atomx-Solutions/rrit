/**
 * Whether this app runs as Vercel functions. Vercel sets VERCEL while it
 * builds, and the build keeps the answer in the runtime config, because a
 * running function is not guaranteed to see VERCEL itself. Reading it only at
 * runtime made production behave like a long-running server: the run meant to
 * start right after a request never started, and the timers meant for such a
 * server ran on every function instance instead.
 */
export function onVercel() {
  return Boolean(process.env.VERCEL) || useRuntimeConfig().onVercel === true
}
