/**
 * WebDAV sync settings model and provider presets.
 *
 * Settings (including the password, same as the AI keys) live inside the
 * existing `rebook-web-config` localStorage object under the `webdavSync`
 * key. `baseUrl` and `proxyPrefix` are prefilled from the selected provider
 * preset but stay user-overridable — the proxy prefix is what makes browser
 * requests possible at all, and some users run their own proxy.
 */
import { createClientUUID } from '../../lib/client-id'

// Same localStorage object that holds the AI keys (see
// src/lib/extension-marketplace.ts, READER_CONFIG_STORAGE_KEY). Duplicated as
// a literal so this module stays free of browser-only import chains.
const READER_CONFIG_STORAGE_KEY = 'rebook-web-config'

export type SyncProviderKind =
  | 'jianguoyun'
  | 'infinicloud'
  | 'koofr'
  | 'hidrive'
  | 'yandex'
  | 'custom'

export interface SyncProviderPreset {
  kind: SyncProviderKind
  label: string
  /** Null for `custom` (fully user-supplied). */
  baseUrl: string | null
  /** Default proxy prefix; empty means direct requests. */
  proxyPrefix: string
}

const SHARED_PROXY = 'https://torto-webdav-proxy.rethinkos.workers.dev'

export const SYNC_PROVIDER_PRESETS: readonly SyncProviderPreset[] = [
  {
    kind: 'jianguoyun',
    label: '坚果云',
    baseUrl: 'https://dav.jianguoyun.com/dav',
    proxyPrefix: 'https://webdav-proxy.torto.deno.net',
  },
  {
    kind: 'infinicloud',
    label: 'InfiniCLOUD',
    baseUrl: 'https://webdav.infini-cloud.net',
    proxyPrefix: SHARED_PROXY,
  },
  {
    kind: 'koofr',
    label: 'Koofr',
    baseUrl: 'https://app.koofr.net/dav/Koofr',
    proxyPrefix: SHARED_PROXY,
  },
  {
    kind: 'hidrive',
    label: 'STRATO HiDrive',
    baseUrl: 'https://webdav.hidrive.strato.com',
    proxyPrefix: SHARED_PROXY,
  },
  {
    kind: 'yandex',
    label: 'Yandex Disk',
    baseUrl: 'https://webdav.yandex.com',
    proxyPrefix: SHARED_PROXY,
  },
  { kind: 'custom', label: 'Custom', baseUrl: null, proxyPrefix: '' },
]

export function syncProviderPreset(kind: SyncProviderKind): SyncProviderPreset {
  return SYNC_PROVIDER_PRESETS.find(preset => preset.kind === kind) ?? SYNC_PROVIDER_PRESETS[0]
}

export const SYNC_INTERVAL_OPTIONS = [10, 30, 60, 180] as const
const DEFAULT_INTERVAL_MINUTES = 30

export interface SyncSettings {
  enabled: boolean
  provider: SyncProviderKind
  baseUrl: string
  proxyPrefix: string
  username: string
  password: string
  deviceId: string
  deviceName: string
  intervalMinutes: number
}

const SETTINGS_KEY = 'webdavSync'
const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

export function createDefaultSyncSettings(): SyncSettings {
  const preset = syncProviderPreset('jianguoyun')
  return {
    enabled: false,
    provider: preset.kind,
    baseUrl: preset.baseUrl ?? '',
    proxyPrefix: preset.proxyPrefix,
    username: '',
    password: '',
    deviceId: createClientUUID(),
    deviceName: 'Torto Web',
    intervalMinutes: DEFAULT_INTERVAL_MINUTES,
  }
}

/** Prefill endpoint fields when the provider changes, keeping credentials. */
export function selectSyncProvider(settings: SyncSettings, provider: SyncProviderKind): SyncSettings {
  const preset = syncProviderPreset(provider)
  return {
    ...settings,
    provider,
    baseUrl: preset.baseUrl ?? settings.baseUrl,
    proxyPrefix: preset.proxyPrefix,
  }
}

export function normalizeSyncSettings(settings: SyncSettings): SyncSettings {
  const normalized = { ...settings }
  normalized.baseUrl = normalized.baseUrl.trim().replace(/\/+$/, '')
  normalized.proxyPrefix = normalized.proxyPrefix.trim().replace(/\/+$/, '')
  normalized.username = normalized.username.trim()
  normalized.deviceName = normalized.deviceName.trim() || 'Torto Web'
  normalized.intervalMinutes = nearestInterval(normalized.intervalMinutes)
  if (!UUID_PATTERN.test(normalized.deviceId)) normalized.deviceId = createClientUUID()
  return normalized
}

export function validateSyncSettings(settings: SyncSettings): void {
  if (!settings.baseUrl) throw new Error('请输入 WebDAV 地址')
  assertHttpsUnlessLocal(settings.baseUrl, 'WebDAV 地址')
  if (settings.proxyPrefix) assertHttpsUnlessLocal(settings.proxyPrefix, 'WebDAV 代理地址')
  if (!settings.username) throw new Error('请输入 WebDAV 用户名')
  if (!settings.password) throw new Error('请输入 WebDAV 密码')
  if (!UUID_PATTERN.test(settings.deviceId)) throw new Error('同步设备标识无效')
}

export function loadSyncSettings(): SyncSettings {
  const stored = readStoredConfig()[SETTINGS_KEY]
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return createDefaultSyncSettings()
  const raw = stored as Record<string, unknown>
  const defaults = createDefaultSyncSettings()
  const provider = typeof raw.provider === 'string' && SYNC_PROVIDER_PRESETS.some(p => p.kind === raw.provider)
    ? raw.provider as SyncProviderKind
    : defaults.provider
  return normalizeSyncSettings({
    enabled: raw.enabled === true,
    provider,
    baseUrl: stringValue(raw.baseUrl, defaults.baseUrl),
    proxyPrefix: stringValue(raw.proxyPrefix, syncProviderPreset(provider).proxyPrefix),
    username: stringValue(raw.username, ''),
    password: stringValue(raw.password, ''),
    deviceId: stringValue(raw.deviceId, defaults.deviceId),
    deviceName: stringValue(raw.deviceName, defaults.deviceName),
    intervalMinutes: typeof raw.intervalMinutes === 'number' && Number.isFinite(raw.intervalMinutes)
      ? raw.intervalMinutes
      : defaults.intervalMinutes,
  })
}

export function saveSyncSettings(settings: SyncSettings): void {
  const config = readStoredConfig()
  config[SETTINGS_KEY] = normalizeSyncSettings(settings)
  localStorage.setItem(READER_CONFIG_STORAGE_KEY, JSON.stringify(config))
}

function readStoredConfig(): Record<string, unknown> {
  try {
    const value = JSON.parse(localStorage.getItem(READER_CONFIG_STORAGE_KEY) || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function nearestInterval(value: number): number {
  let nearest: number = DEFAULT_INTERVAL_MINUTES
  for (const candidate of SYNC_INTERVAL_OPTIONS) {
    if (Math.abs(candidate - value) < Math.abs(nearest - value)) nearest = candidate
  }
  return nearest
}

function assertHttpsUnlessLocal(raw: string, what: string): void {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`${what}无法解析：${raw}`)
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !local) throw new Error(`${what}默认只允许 HTTPS 地址`)
}
