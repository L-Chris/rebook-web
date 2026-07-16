const configuredApiBase = String(
  import.meta.env.VITE_REBOOK_SERVICE_URL ?? '',
).trim()

const apiBase = configuredApiBase
  ? configuredApiBase.replace(/\/+$/, '').replace(/\/api$/i, '')
  : ''

let csrfToken = ''

export type AuthUser = {
  id: string
  email: string
  displayName: string | null
  avatarUrl: string | null
  emailVerifiedAt: string | null
  status: string
  role: string
}

export type ShelfItem = {
  id: string
  title: string
  author: string | null
  language: string | null
  sourceType: string
  sourceFileName: string | null
  status: string
  progress: number
  locator: {
    unitIndex?: number
    fraction?: number
    totalFraction?: number
    tocLabel?: string
  } | null
  lastReadAt: string | null
  finishedAt: string | null
  addedAt: string
  updatedAt: string
  coverUrl: string | null
  fileName: string | null
  fileSize: number | null
  storageProvider: string | null
}

export type ShelfList = {
  items: ShelfItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  counts: Record<'all' | 'wantToRead' | 'reading' | 'finished' | 'archived', number>
}

export type ImportJob = {
  id: string
  sourceType: string
  status: string
  progress: number
  errorMessage: string | null
  bookId: string | null
  alreadyImported?: boolean
}

export type CloudDriveAccount = {
  id: string
  provider: 'webdav'
  providerUserId: string
  displayName: string | null
  serverUrl: string
  username: string
  rootPath: string
  status: string
  lastSyncedAt: string | null
  createdAt: string
  updatedAt: string
}

export type CloudDriveItem = {
  id: string
  accountId: string
  fileId: string
  parentFileId: string | null
  name: string
  path: string | null
  type: string
  ext: string | null
  mimeType: string | null
  size: number | null
  etag: string | null
  providerUpdatedAt: string | null
  syncStatus: string
  bookId: string | null
}

export function setCsrfToken(value?: string | null) {
  csrfToken = value || ''
}

export function apiUrl(path: string) {
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${apiBase}/api${suffix}`
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const method = (init.method || 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken) {
    headers.set('X-CSRF-Token', csrfToken)
  }
  const response = await fetch(apiUrl(path), {
    ...init,
    method,
    headers,
    credentials: 'include',
  })
  if (response.status === 401) {
    window.dispatchEvent(new Event('rebook:unauthorized'))
  }
  return response
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const headers = new Headers(init.headers)
  let body = init.body
  if ('json' in init) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(init.json)
  }
  const response = await apiFetch(path, { ...init, headers, body })
  const text = await response.text()
  const data = text ? parseJson(text) : null
  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data
        ? String(data.error)
        : `HTTP ${response.status}`
    throw new Error(message)
  }
  return data as T
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}
