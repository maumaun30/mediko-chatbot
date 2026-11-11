/**
 * Normalize a Philippine mobile number to 639XXXXXXXXX.
 * Accepts +639XXXXXXXXX or 09XXXXXXXXX (spaces and dashes ignored).
 * @param {string} raw
 * @returns {string|null}
 */
export function normalizePhMobile(raw) {
  const s = String(raw ?? '').replace(/[\s-]/g, '')
  if (!/^(\+639|09)\d{9}$/.test(s)) return null
  return s.startsWith('+') ? s.slice(1) : `63${s.slice(1)}`
}
