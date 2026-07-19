import {
  AI_CHAT_EXTENSION_ID,
  PROFESSIONAL_TRANSLATION_EXTENSION_ID,
  TRANSLATION_EXTENSION_ID,
  TRIAL_LIMIT_EXTENSION_ID,
  TTS_EXTENSION_ID,
  createBuiltInRebookExtensionCatalog,
  createRebookExtensionCatalog,
  createRebookExtensionManager,
  parseRebookExtensionCatalogEntries,
  type RebookExtensionCatalogEntry,
  type RebookExtensionCatalogItem,
  type RebookExtensionInstallation,
} from 'rebook'

export const READER_CONFIG_STORAGE_KEY = 'rebook-web-config'
export const AI_CHAT_DEFAULTS_VERSION = 1
export const TRANSLATION_DEFAULTS_VERSION = 2
export const BUILT_IN_EXTENSION_DEFAULTS_VERSION = TRANSLATION_DEFAULTS_VERSION

type ExtensionInstallations = Record<string, RebookExtensionInstallation>

export interface ExtensionMarketplaceState {
  extensionDefaultsVersion: number
  extensionCatalogURL: string
  extensionCatalogJSON: string
  extensionInstallations: ExtensionInstallations
  translate: boolean
  professionalTranslation: boolean
  tts: boolean
  chat: boolean
}

export interface ExtensionCatalogResult {
  entries: readonly RebookExtensionCatalogEntry[]
  error: string
}

const builtInCatalog = createBuiltInRebookExtensionCatalog()

export function loadExtensionMarketplaceState(): ExtensionMarketplaceState {
  const stored = readStoredConfig()
  const extensionInstallations = normalizeInstallations(stored.extensionInstallations)
  const storedDefaultsVersion = numberValue(stored.extensionDefaultsVersion)
  const shouldEnableTranslationByDefault = storedDefaultsVersion < TRANSLATION_DEFAULTS_VERSION
  return normalizeState({
    extensionDefaultsVersion: BUILT_IN_EXTENSION_DEFAULTS_VERSION,
    extensionCatalogURL: stringValue(stored.extensionCatalogURL),
    extensionCatalogJSON: stringValue(stored.extensionCatalogJSON),
    extensionInstallations,
    translate: shouldEnableTranslationByDefault || stored.translate === true,
    professionalTranslation: shouldEnableTranslationByDefault
      ? false
      : stored.professionalTranslation === true,
    tts: stored.tts === true,
    // AI Chat has always been exposed by the reader UI. Treat legacy configs
    // without an installation record as enabled, while preserving an explicit
    // disabled installation created by the extension store.
    chat: storedDefaultsVersion < AI_CHAT_DEFAULTS_VERSION
      ? true
      : extensionInstallations[AI_CHAT_EXTENSION_ID]
        ? stored.chat !== false && extensionInstallations[AI_CHAT_EXTENSION_ID].enabled !== false
        : true,
  })
}

export function saveExtensionMarketplaceState(state: ExtensionMarketplaceState): void {
  const stored = readStoredConfig()
  localStorage.setItem(READER_CONFIG_STORAGE_KEY, JSON.stringify({
    ...stored,
    ...normalizeState(state),
  }))
}

export function parseExtensionMarketplaceCatalog(state: ExtensionMarketplaceState): ExtensionCatalogResult {
  const source = state.extensionCatalogJSON.trim()
  if (!source) return { entries: [], error: '' }
  try {
    return {
      entries: parseRebookExtensionCatalogEntries(JSON.parse(source), { source: 'marketplace' })
        .filter(entry => entry.manifest.id !== TRIAL_LIMIT_EXTENSION_ID),
      error: '',
    }
  } catch (error) {
    return {
      entries: [],
      error: error instanceof Error ? error.message : '扩展目录格式无效',
    }
  }
}

export function listExtensionMarketplaceItems(state: ExtensionMarketplaceState): readonly RebookExtensionCatalogItem[] {
  return createManager(state).listItems()
}

export function installMarketplaceExtension(
  state: ExtensionMarketplaceState,
  extensionId: string,
): ExtensionMarketplaceState {
  const manager = createManager(state)
  manager.install(extensionId, { enabled: true })
  return withManager(setFeatureEnabled(state, extensionId, true), manager)
}

export function setMarketplaceExtensionEnabled(
  state: ExtensionMarketplaceState,
  extensionId: string,
  enabled: boolean,
): ExtensionMarketplaceState {
  const manager = createManager(state)
  if (!manager.isInstalled(extensionId)) manager.install(extensionId, { enabled })
  else manager.setEnabled(extensionId, enabled)

  if (enabled && extensionId === TRANSLATION_EXTENSION_ID && manager.isInstalled(PROFESSIONAL_TRANSLATION_EXTENSION_ID)) {
    manager.disable(PROFESSIONAL_TRANSLATION_EXTENSION_ID)
  }
  if (enabled && extensionId === PROFESSIONAL_TRANSLATION_EXTENSION_ID && manager.isInstalled(TRANSLATION_EXTENSION_ID)) {
    manager.disable(TRANSLATION_EXTENSION_ID)
  }

  let next = setFeatureEnabled(state, extensionId, enabled)
  if (enabled && extensionId === TRANSLATION_EXTENSION_ID) {
    next = setFeatureEnabled(next, PROFESSIONAL_TRANSLATION_EXTENSION_ID, false)
  }
  if (enabled && extensionId === PROFESSIONAL_TRANSLATION_EXTENSION_ID) {
    next = setFeatureEnabled(next, TRANSLATION_EXTENSION_ID, false)
  }
  return withManager(next, manager)
}

export function uninstallMarketplaceExtension(
  state: ExtensionMarketplaceState,
  extensionId: string,
): ExtensionMarketplaceState {
  if (builtInCatalog.has(extensionId)) {
    return setMarketplaceExtensionEnabled(state, extensionId, false)
  }
  const manager = createManager(state)
  manager.uninstall(extensionId)
  return withManager(setFeatureEnabled(state, extensionId, false), manager)
}

function normalizeState(state: ExtensionMarketplaceState): ExtensionMarketplaceState {
  const manager = createManager(state)
  for (const extensionId of [
    TRANSLATION_EXTENSION_ID,
    PROFESSIONAL_TRANSLATION_EXTENSION_ID,
    TTS_EXTENSION_ID,
    AI_CHAT_EXTENSION_ID,
  ]) {
    const enabled = isFeatureEnabled(state, extensionId)
    if (!manager.isInstalled(extensionId)) manager.install(extensionId, { enabled })
    else if (manager.isInstalled(extensionId) && manager.isEnabled(extensionId) !== enabled) {
      manager.setEnabled(extensionId, enabled)
    }
  }
  return withManager(state, manager)
}

function createManager(state: ExtensionMarketplaceState) {
  const catalogResult = parseExtensionMarketplaceCatalog(state)
  const catalog = createRebookExtensionCatalog([
    ...builtInCatalog.list(),
    ...catalogResult.entries,
  ].filter(entry => entry.manifest.id !== TRIAL_LIMIT_EXTENSION_ID))
  const manager = createRebookExtensionManager({
    catalog,
    installations: Object.values(state.extensionInstallations),
  })
  return manager
}

function withManager(
  state: ExtensionMarketplaceState,
  manager: ReturnType<typeof createRebookExtensionManager>,
): ExtensionMarketplaceState {
  return {
    ...state,
    extensionInstallations: Object.fromEntries(
      manager.toJSON().map(installation => [installation.id, installation]),
    ),
  }
}

function isFeatureEnabled(state: ExtensionMarketplaceState, extensionId: string): boolean {
  switch (extensionId) {
    case TRANSLATION_EXTENSION_ID:
      return state.translate && !state.professionalTranslation
    case PROFESSIONAL_TRANSLATION_EXTENSION_ID:
      return state.translate && state.professionalTranslation
    case TTS_EXTENSION_ID:
      return state.tts
    case AI_CHAT_EXTENSION_ID:
      return state.chat
    default:
      return false
  }
}

function setFeatureEnabled(
  state: ExtensionMarketplaceState,
  extensionId: string,
  enabled: boolean,
): ExtensionMarketplaceState {
  switch (extensionId) {
    case TRANSLATION_EXTENSION_ID:
      return enabled
        ? { ...state, translate: true, professionalTranslation: false }
        : state.professionalTranslation ? state : { ...state, translate: false }
    case PROFESSIONAL_TRANSLATION_EXTENSION_ID:
      return enabled
        ? { ...state, translate: true, professionalTranslation: true }
        : state.professionalTranslation
          ? { ...state, translate: false, professionalTranslation: false }
          : state
    case TTS_EXTENSION_ID:
      return { ...state, tts: enabled }
    case AI_CHAT_EXTENSION_ID:
      return { ...state, chat: enabled }
    default:
      return state
  }
}

function readStoredConfig(): Record<string, unknown> {
  try {
    const value = JSON.parse(localStorage.getItem(READER_CONFIG_STORAGE_KEY) || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

function normalizeInstallations(value: unknown): ExtensionInstallations {
  if (!value || typeof value !== 'object') return {}
  const entries = Array.isArray(value)
    ? value.map(item => [typeof item === 'object' && item && 'id' in item ? String(item.id) : '', item] as const)
    : Object.entries(value)
  const installations: ExtensionInstallations = {}
  for (const [key, raw] of entries) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const item = raw as Record<string, unknown>
    const id = stringValue(item.id).trim() || key.trim()
    if (!id || id === TRIAL_LIMIT_EXTENSION_ID) continue
    installations[id] = {
      id,
      version: stringValue(item.version) || undefined,
      enabled: item.enabled !== false,
      source: stringValue(item.source) || undefined,
      installedAt: stringValue(item.installedAt) || undefined,
      updatedAt: stringValue(item.updatedAt) || undefined,
    }
  }
  return installations
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
