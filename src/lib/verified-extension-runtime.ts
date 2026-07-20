import {
  REBOOK_EXTENSION_HOST_API_VERSION,
  loadRebookExtensionModule,
  type RebookExtension,
  type RebookExtensionCatalogEntry,
} from 'rebook'
import { apiUrl } from './api'

const MAX_TRUSTED_ARTIFACT_SIZE = 10 * 1024 * 1024

export function getVerifiedExtensionCacheKey(entry: RebookExtensionCatalogEntry): string {
  const artifact = requireExecutableArtifact(entry, 'trusted')
  return `${entry.manifest.id}@${entry.manifest.version}@${artifact.integrity}`
}

export function getSandboxedExtensionCacheKey(entry: RebookExtensionCatalogEntry): string {
  const artifact = requireExecutableArtifact(entry, 'sandbox')
  return `${entry.manifest.id}@${entry.manifest.version}@${entry.manifest.runtime?.kind}@${artifact.integrity}@${JSON.stringify(entry.manifest)}`
}

export async function loadVerifiedMarketplaceExtension(
  entry: RebookExtensionCatalogEntry,
): Promise<RebookExtension> {
  const artifact = requireExecutableArtifact(entry, 'trusted')
  const bytes = await fetchIntegrityPinnedExtensionArtifact(entry, 'trusted')
  const objectURL = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], {
    type: artifact.contentType || 'text/javascript',
  }))
  try {
    return await loadRebookExtensionModule(
      objectURL,
      url => import(/* @vite-ignore */ url),
      { catalogEntry: entry },
    )
  } finally {
    URL.revokeObjectURL(objectURL)
  }
}

export async function fetchIntegrityPinnedExtensionArtifact(
  entry: RebookExtensionCatalogEntry,
  mode: 'trusted' | 'sandbox',
): Promise<Uint8Array> {
  const artifact = requireExecutableArtifact(entry, mode)
  const serviceBaseURL = new URL(apiUrl('/extensions/catalog'), window.location.href)
  const artifactURL = new URL(artifact.url, serviceBaseURL).href
  assertTrustedArtifactURL(artifactURL)
  const response = await fetch(artifactURL, {
    cache: 'no-cache',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  })
  if (!response.ok) throw new Error(`Artifact request failed with HTTP ${response.status}.`)
  if (response.url) assertTrustedArtifactURL(response.url)

  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength !== artifact.size) {
    throw new Error(`Artifact size mismatch: expected ${artifact.size}, received ${declaredLength}.`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength !== artifact.size) {
    throw new Error(`Artifact size mismatch: expected ${artifact.size}, received ${bytes.byteLength}.`)
  }
  const actualIntegrity = await sha256Integrity(bytes)
  if (actualIntegrity !== artifact.integrity) {
    throw new Error(`Artifact integrity mismatch for ${entry.manifest.id}@${entry.manifest.version}.`)
  }
  return bytes
}

function assertTrustedArtifactURL(rawURL: string): void {
  const url = new URL(rawURL)
  const serviceOrigin = new URL(apiUrl('/extensions/catalog'), window.location.href).origin
  const configuredOrigins = String(import.meta.env.VITE_REBOOK_EXTENSION_ARTIFACT_ORIGINS ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => new URL(value).origin)
  if (url.origin === serviceOrigin) {
    if (!url.pathname.startsWith('/api/extensions/artifacts/')) {
      throw new Error('Trusted extension artifacts must use the immutable service artifact endpoint.')
    }
    return
  }
  if (!configuredOrigins.includes(url.origin)) {
    throw new Error(`Extension artifact origin "${url.origin}" is not trusted by this host.`)
  }
}

function requireExecutableArtifact(entry: RebookExtensionCatalogEntry, mode: 'trusted' | 'sandbox') {
  if (entry.source === 'builtin' || entry.trust === 'builtin') {
    throw new Error('Built-in extensions are loaded by the application bundle, not the marketplace runtime loader.')
  }
  if (entry.manifest.engines?.hostApi !== String(REBOOK_EXTENSION_HOST_API_VERSION)) {
    throw new Error(`Marketplace extension "${entry.manifest.id}" does not target Host API ${REBOOK_EXTENSION_HOST_API_VERSION}.`)
  }
  if (mode === 'trusted') {
    if (entry.trust !== 'verified' || entry.verified !== true) {
      throw new Error(`Marketplace extension "${entry.manifest.id}" is not verified and cannot run in the trusted host.`)
    }
    if (entry.manifest.runtime?.kind !== 'trusted') {
      throw new Error(`Marketplace extension "${entry.manifest.id}" requests runtime "${entry.manifest.runtime?.kind ?? 'unspecified'}"; trusted loading requires a reviewed trusted runtime.`)
    }
  } else if (entry.manifest.runtime?.kind !== 'worker' && entry.manifest.runtime?.kind !== 'iframe') {
    throw new Error(`Marketplace extension "${entry.manifest.id}" does not request a supported sandbox runtime.`)
  }
  const artifact = entry.artifact
  if (!artifact) throw new Error(`Marketplace extension "${entry.manifest.id}" does not provide an integrity-pinned artifact.`)
  if (!artifact.url.trim()) throw new Error('Extension artifact URL is empty.')
  if (!/^sha256-[A-Za-z0-9+/]{43}=$/.test(artifact.integrity)) throw new Error('Extension artifact integrity is invalid.')
  if (!Number.isSafeInteger(artifact.size) || artifact.size <= 0 || artifact.size > MAX_TRUSTED_ARTIFACT_SIZE) {
    throw new Error('Extension artifact size is invalid or exceeds 10 MiB.')
  }
  return artifact
}

async function sha256Integrity(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('WebCrypto SHA-256 is unavailable; refusing to execute unverified bytes.')
  }
  const digestInput = bytes.slice().buffer as ArrayBuffer
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', digestInput))
  return `sha256-${btoa(String.fromCharCode(...digest))}`
}
