/** Small browser actions, kept apart so tests can replace them. */

/** Copies to the clipboard where the browser allows it; false when it does not. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** Sends the browser to another site (a provider's sign-in page). */
export const navigation = { go: (url: string) => window.location.assign(url) }
