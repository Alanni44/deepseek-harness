/** Parse the loopback readiness line from bounded backend startup output. */

/**
 * Return the first valid dsh web loopback URL in output.
 * @param {string} output - stdout and stderr received while starting the backend.
 * @returns {string | undefined} the ready URL, when present.
 */
export function findPackagedReadyUrl(output) {
  return /(?:^|\r?\n)dsh web: (http:\/\/127\.0\.0\.1:\d+)(?:\r?\n|$)/u.exec(output)?.[1]
}
