/**
 * Readiness-line parsing for the dsh web backend. The backend prints one line
 * once its HTTP server binds — `dsh web: http://127.0.0.1:<port>` with an
 * optional LAN suffix — and the desktop shell waits for it before loading the
 * window. This module has no Electron dependency so it is unit-testable under
 * plain Node.
 * @module @deepseek-ai/dsh-desktop/url
 */

/** Matches the backend's readiness line and captures the loopback URL. */
const WEB_URL_PATTERN = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)/

/**
 * Extract the loopback URL from one backend stdout line.
 * @param line - one line of backend stdout.
 * @returns the URL, or undefined when the line is not the readiness line.
 */
export function parseWebUrlLine(line: string): string | undefined {
  return WEB_URL_PATTERN.exec(line.trim())?.[1]
}

/**
 * Extract the loopback URL from a full stdout snapshot, scanning line by line.
 * @param output - accumulated backend stdout.
 * @returns the URL, or undefined when the readiness line has not appeared yet.
 */
export function findWebUrl(output: string): string | undefined {
  for (const line of output.split('\n')) {
    const url = parseWebUrlLine(line)
    if (url !== undefined) return url
  }
  return undefined
}

/**
 * Test whether a target belongs to the exact loopback origin served by the backend.
 * @param appUrl - backend base URL from the readiness line.
 * @param target - requested navigation URL.
 * @returns true only when both URLs have the same origin.
 */
export function isAllowedAppNavigation(appUrl: string, target: string): boolean {
  try {
    return new URL(target).origin === new URL(appUrl).origin
  } catch {
    return false
  }
}
