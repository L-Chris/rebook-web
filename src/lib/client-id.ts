/**
 * Create a UUID for browser-local records.
 *
 * `crypto.randomUUID()` is restricted to secure contexts, so a development
 * server opened over plain HTTP on a LAN address may not expose it. Web Crypto
 * still exposes `getRandomValues()` there, which is enough to construct a
 * standards-shaped UUID v4.
 */
export function createClientUUID(): string {
  const webCrypto = globalThis.crypto
  if (typeof webCrypto?.randomUUID === 'function') {
    return webCrypto.randomUUID()
  }

  const bytes = new Uint8Array(16)
  if (typeof webCrypto?.getRandomValues === 'function') {
    webCrypto.getRandomValues(bytes)
  } else {
    // This ID only identifies a local IndexedDB record. Keep very old/test
    // environments usable when Web Crypto is absent altogether.
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }

  // RFC 4122 UUID v4 version and variant bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0'))
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`
}
