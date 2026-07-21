import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  AI_CHAT_EXTENSION_ID,
  PROFESSIONAL_TRANSLATION_EXTENSION_ID,
  TRANSLATION_EXTENSION_ID,
  TTS_EXTENSION_ID,
} from 'rebook'
import { ApiRequestError, apiRequest } from '../../lib/api'
import { READER_CONFIG_STORAGE_KEY } from '../../lib/extension-marketplace'
import { READER_FONT_DEFAULTS } from '../../lib/reader-fonts'
import {
  LOCAL_PREFERENCES_CHANGED_EVENT,
  READER_CONFIG_CHANGED_EVENT,
} from '../../lib/preference-events'
import { useAuth } from '../auth/AuthContext'
import {
  APP_LANGUAGE_STORAGE_KEY,
  normalizeAppLanguage,
  useI18n,
  type AppLanguage,
} from '../i18n/LanguageContext'
import { useAppTheme, type AppTheme } from '../theme/ThemeContext'

const THEME_STORAGE_KEY = 'rebook-web-app-theme'
const CACHE_PREFIX = 'rebook-cloud-preferences:'
const OUTBOX_PREFIX = 'rebook-cloud-preferences-outbox:'
const SYNC_DELAY_MS = 800

export type PreferenceSyncStatus = 'local' | 'loading' | 'syncing' | 'synced' | 'offline'

type ExtensionInstallationPreference = {
  enabled: boolean
  version?: string
}

export type CloudPreferenceSections = {
  appearance: {
    theme: AppTheme
    language: AppLanguage
  }
  typography: {
    fontSize: string
    defaultFont: string
    defaultCJKFont: string
    serifFont: string
    sansSerifFont: string
    monospaceFont: string
    overrideBookFonts: boolean
  }
  reading: {
    layout: 'paginated' | 'scrolled'
    spread: string
    pageFit: 'auto' | 'paper' | 'viewport'
    hyphenate: boolean
  }
  translation: {
    enabled: boolean
    professional: boolean
    preferredProvider: 'browser' | 'ai'
    targetLanguage: AppLanguage | 'interface'
    mode: 'bilingual' | 'replace'
    translateTOC: boolean
    prefetchPages: string
  }
  tts: {
    enabled: boolean
    speed: string
    segmentChars: string
    multiSpeaker: boolean
  }
  chat: {
    enabled: boolean
    maxContentChars: string
  }
  extensions: {
    installations: Record<string, ExtensionInstallationPreference>
  }
}

type CloudPreferencePatch = Partial<CloudPreferenceSections>

type CloudPreferenceResponse = {
  exists: boolean
  schemaVersion: 1
  revision: number
  updatedAt: string | null
  settings: CloudPreferencePatch
}

type PreferenceSyncContextValue = {
  status: PreferenceSyncStatus
  syncNow(): Promise<void>
}

const PreferenceSyncContext = createContext<PreferenceSyncContextValue | null>(null)

export function PreferencesSyncProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth()
  const { theme, setTheme } = useAppTheme()
  const { language, setLanguage } = useI18n()
  const [status, setStatus] = useState<PreferenceSyncStatus>('local')
  const activeUserId = useRef<string | null>(null)
  const initialized = useRef(false)
  const generation = useRef(0)
  const revision = useRef(0)
  const lastSynced = useRef<CloudPreferencePatch>({})
  const syncTimer = useRef<number | null>(null)
  const syncPromise = useRef<Promise<void> | null>(null)
  const scheduleFlushRef = useRef<() => void>(() => undefined)

  const readCurrent = useCallback(
    () => readLocalPreferences(theme, language),
    [language, theme],
  )

  const flush = useCallback(async () => {
    const userId = activeUserId.current
    if (!userId || !initialized.current) return
    if (syncPromise.current) return syncPromise.current

    const operation = (async () => {
      let queued = readOutbox(userId)
      if (!hasSections(queued)) {
        queued = changedSections(lastSynced.current, readLocalPreferences())
      }
      if (!hasSections(queued)) {
        setStatus('synced')
        return
      }

      setStatus('syncing')
      try {
        let response: CloudPreferenceResponse
        try {
          response = await patchPreferences(revision.current, queued)
        } catch (error) {
          if (!(error instanceof ApiRequestError) || error.status !== 409) throw error
          const latest = await getPreferences()
          revision.current = latest.revision
          lastSynced.current = latest.settings
          applyCloudPreferences({ ...latest.settings, ...queued }, setTheme, setLanguage)
          response = await patchPreferences(latest.revision, queued)
        }
        if (activeUserId.current !== userId) return
        revision.current = response.revision
        lastSynced.current = response.settings
        writeCache(userId, response)
        removeSyncedOutboxSections(userId, queued)
        if (hasSections(readOutbox(userId))) {
          setStatus('syncing')
          scheduleFlushRef.current()
        } else {
          setStatus('synced')
        }
      } catch {
        if (activeUserId.current === userId) setStatus('offline')
      }
    })().finally(() => {
      syncPromise.current = null
    })
    syncPromise.current = operation
    return operation
  }, [setLanguage, setTheme])

  const scheduleFlush = useCallback(() => {
    if (syncTimer.current != null) window.clearTimeout(syncTimer.current)
    syncTimer.current = window.setTimeout(() => {
      syncTimer.current = null
      void flush()
    }, SYNC_DELAY_MS)
  }, [flush])

  scheduleFlushRef.current = scheduleFlush

  const queueCurrentChanges = useCallback(() => {
    const userId = activeUserId.current
    if (!userId || !initialized.current) return
    const changes = changedSections(lastSynced.current, readCurrent())
    if (!hasSections(changes)) return
    writeOutbox(userId, { ...readOutbox(userId), ...changes })
    scheduleFlush()
  }, [readCurrent, scheduleFlush])

  useEffect(() => {
    const handleChange = () => queueCurrentChanges()
    const handleOnline = () => {
      if (activeUserId.current) scheduleFlush()
    }
    window.addEventListener(LOCAL_PREFERENCES_CHANGED_EVENT, handleChange)
    window.addEventListener('online', handleOnline)
    window.addEventListener('focus', handleOnline)
    return () => {
      window.removeEventListener(LOCAL_PREFERENCES_CHANGED_EVENT, handleChange)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('focus', handleOnline)
    }
  }, [queueCurrentChanges, scheduleFlush])

  useEffect(() => {
    queueCurrentChanges()
  }, [language, queueCurrentChanges, theme])

  useEffect(() => {
    const runGeneration = ++generation.current
    initialized.current = false
    activeUserId.current = user?.id ?? null
    revision.current = 0
    lastSynced.current = {}
    if (syncTimer.current != null) {
      window.clearTimeout(syncTimer.current)
      syncTimer.current = null
    }

    if (authLoading) {
      setStatus('loading')
      return
    }
    if (!user) {
      setStatus('local')
      return
    }

    const userId = user.id
    let localAtStart = readLocalPreferences()
    const cached = readCache(userId)
    if (cached) {
      revision.current = cached.revision
      lastSynced.current = cached.settings
      applyCloudPreferences(cached.settings, setTheme, setLanguage)
      localAtStart = { ...localAtStart, ...cached.settings }
    }
    setStatus('loading')

    void getPreferences().then(async remote => {
      if (generation.current !== runGeneration || activeUserId.current !== userId) return
      const changesDuringLoad = changedSections(localAtStart, readLocalPreferences())
      const queued = { ...readOutbox(userId), ...changesDuringLoad }

      if (!remote.exists) {
        const local = readLocalPreferences()
        const created = await patchPreferences(0, local)
        if (generation.current !== runGeneration || activeUserId.current !== userId) return
        revision.current = created.revision
        lastSynced.current = created.settings
        writeCache(userId, created)
        clearOutbox(userId)
        initialized.current = true
        setStatus('synced')
        return
      }

      revision.current = remote.revision
      lastSynced.current = remote.settings
      writeCache(userId, remote)
      const desired = { ...remote.settings, ...queued }
      applyCloudPreferences(desired, setTheme, setLanguage)
      initialized.current = true
      if (hasSections(queued)) {
        writeOutbox(userId, queued)
        scheduleFlush()
      } else {
        setStatus('synced')
      }
    }).catch(() => {
      if (generation.current !== runGeneration || activeUserId.current !== userId) return
      if (!cached) lastSynced.current = readLocalPreferences()
      initialized.current = true
      setStatus('offline')
    })
  }, [authLoading, scheduleFlush, setLanguage, setTheme, user])

  useEffect(() => () => {
    if (syncTimer.current != null) window.clearTimeout(syncTimer.current)
  }, [])

  const value = useMemo<PreferenceSyncContextValue>(() => ({
    status,
    syncNow: flush,
  }), [flush, status])

  return (
    <PreferenceSyncContext.Provider value={value}>
      {children}
    </PreferenceSyncContext.Provider>
  )
}

export function usePreferenceSync() {
  const value = useContext(PreferenceSyncContext)
  if (!value) throw new Error('usePreferenceSync must be used inside PreferencesSyncProvider')
  return value
}

function readLocalPreferences(
  themeOverride?: AppTheme,
  languageOverride?: AppLanguage,
): CloudPreferenceSections {
  const config = readRecord(READER_CONFIG_STORAGE_KEY)
  const theme = themeOverride ?? (readString(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light')
  const language = languageOverride ?? normalizeAppLanguage(readString(APP_LANGUAGE_STORAGE_KEY))
  const translate = config.translate !== false
  const professional = config.professionalTranslation === true
  const tts = config.tts === true
  const chat = config.chat !== false
  const storedInstallations = isRecord(config.extensionInstallations) ? config.extensionInstallations : {}

  return {
    appearance: { theme, language },
    typography: {
      fontSize: stringValue(config.fontSize, '16px'),
      defaultFont: stringValue(config.defaultFont, READER_FONT_DEFAULTS.defaultFont),
      defaultCJKFont: stringValue(config.defaultCJKFont, READER_FONT_DEFAULTS.defaultCJKFont),
      serifFont: stringValue(config.serifFont, READER_FONT_DEFAULTS.serifFont),
      sansSerifFont: stringValue(config.sansSerifFont, READER_FONT_DEFAULTS.sansSerifFont),
      monospaceFont: stringValue(config.monospaceFont, READER_FONT_DEFAULTS.monospaceFont),
      overrideBookFonts: config.overrideBookFonts === true,
    },
    reading: {
      layout: config.layout === 'scrolled' ? 'scrolled' : 'paginated',
      spread: stringValue(config.spread, '2'),
      pageFit: config.reflowablePageFit === 'auto' || config.reflowablePageFit === 'paper'
        ? config.reflowablePageFit
        : 'viewport',
      hyphenate: config.hyphenate !== false,
    },
    translation: {
      enabled: translate,
      professional,
      preferredProvider: config.translationProvider === 'ai' ? 'ai' : 'browser',
      targetLanguage: config.translationTargetLanguage === 'en' || config.translationTargetLanguage === 'zh-CN'
        ? config.translationTargetLanguage
        : 'interface',
      mode: config.translateMode === 'replace' ? 'replace' : 'bilingual',
      translateTOC: config.translateTOC === true,
      prefetchPages: stringValue(config.prefetchPages, '2'),
    },
    tts: {
      enabled: tts,
      speed: stringValue(config.ttsSpeed, '1'),
      segmentChars: stringValue(config.ttsSegmentChars, '500'),
      multiSpeaker: config.ttsMultiSpeaker === true,
    },
    chat: {
      enabled: chat,
      maxContentChars: stringValue(config.chatMaxContentChars, '6000'),
    },
    extensions: {
      installations: Object.fromEntries([
        [TRANSLATION_EXTENSION_ID, installationPreference(storedInstallations, TRANSLATION_EXTENSION_ID, translate && !professional)],
        [PROFESSIONAL_TRANSLATION_EXTENSION_ID, installationPreference(storedInstallations, PROFESSIONAL_TRANSLATION_EXTENSION_ID, translate && professional)],
        [TTS_EXTENSION_ID, installationPreference(storedInstallations, TTS_EXTENSION_ID, tts)],
        [AI_CHAT_EXTENSION_ID, installationPreference(storedInstallations, AI_CHAT_EXTENSION_ID, chat)],
      ]),
    },
  }
}

function applyCloudPreferences(
  settings: CloudPreferencePatch,
  setTheme: (theme: AppTheme) => void,
  setLanguage: (language: AppLanguage) => void,
) {
  if (settings.appearance) {
    localStorage.setItem(THEME_STORAGE_KEY, settings.appearance.theme)
    localStorage.setItem(APP_LANGUAGE_STORAGE_KEY, settings.appearance.language)
    setTheme(settings.appearance.theme)
    setLanguage(settings.appearance.language)
  }

  const config = readRecord(READER_CONFIG_STORAGE_KEY)
  if (settings.typography) {
    Object.assign(config, settings.typography)
  }
  if (settings.reading) {
    config.layout = settings.reading.layout
    config.spread = settings.reading.spread
    config.reflowablePageFit = settings.reading.pageFit
    config.hyphenate = settings.reading.hyphenate
  }
  if (settings.translation) {
    config.translate = settings.translation.enabled
    config.professionalTranslation = settings.translation.professional
    config.translationProvider = settings.translation.preferredProvider
    config.translationTargetLanguage = settings.translation.targetLanguage
    config.translateMode = settings.translation.mode
    config.translateTOC = settings.translation.translateTOC
    config.prefetchPages = settings.translation.prefetchPages
  }
  if (settings.tts) {
    config.tts = settings.tts.enabled
    config.ttsSpeed = settings.tts.speed
    config.ttsSegmentChars = settings.tts.segmentChars
    config.ttsMultiSpeaker = settings.tts.multiSpeaker
  }
  if (settings.chat) {
    config.chat = settings.chat.enabled
    config.chatMaxContentChars = settings.chat.maxContentChars
  }
  if (settings.extensions) {
    const current = isRecord(config.extensionInstallations) ? config.extensionInstallations : {}
    for (const [id, installation] of Object.entries(settings.extensions.installations)) {
      const previous = isRecord(current[id]) ? current[id] : {}
      current[id] = { ...previous, id, ...installation }
    }
    config.extensionInstallations = current
    const translation = settings.extensions.installations[TRANSLATION_EXTENSION_ID]
    const professional = settings.extensions.installations[PROFESSIONAL_TRANSLATION_EXTENSION_ID]
    const tts = settings.extensions.installations[TTS_EXTENSION_ID]
    const chat = settings.extensions.installations[AI_CHAT_EXTENSION_ID]
    if (translation || professional) {
      config.translate = Boolean(translation?.enabled || professional?.enabled)
      config.professionalTranslation = professional?.enabled === true
    }
    if (tts) config.tts = tts.enabled
    if (chat) config.chat = chat.enabled
  }
  localStorage.setItem(READER_CONFIG_STORAGE_KEY, JSON.stringify(config))
  window.dispatchEvent(new Event(READER_CONFIG_CHANGED_EVENT))
}

function installationPreference(
  installations: Record<string, unknown>,
  id: string,
  enabled: boolean,
): ExtensionInstallationPreference {
  const installation = isRecord(installations[id]) ? installations[id] : {}
  const version = typeof installation.version === 'string' ? installation.version : undefined
  return { enabled, ...(version ? { version } : {}) }
}

function changedSections(
  previous: CloudPreferencePatch,
  current: CloudPreferenceSections,
): CloudPreferencePatch {
  const changed: CloudPreferencePatch = {}
  for (const key of Object.keys(current) as Array<keyof CloudPreferenceSections>) {
    if (!sameValue(previous[key], current[key])) {
      Object.assign(changed, { [key]: current[key] })
    }
  }
  return changed
}

async function getPreferences() {
  return apiRequest<CloudPreferenceResponse>('/account/preferences')
}

async function patchPreferences(baseRevision: number, sections: CloudPreferencePatch) {
  return apiRequest<CloudPreferenceResponse>('/account/preferences', {
    method: 'PATCH',
    json: { baseRevision, schemaVersion: 1, sections },
  })
}

function readCache(userId: string): CloudPreferenceResponse | null {
  return readJSON(`${CACHE_PREFIX}${userId}`) as CloudPreferenceResponse | null
}

function writeCache(userId: string, value: CloudPreferenceResponse) {
  writeJSON(`${CACHE_PREFIX}${userId}`, value)
}

function readOutbox(userId: string): CloudPreferencePatch {
  const value = readJSON(`${OUTBOX_PREFIX}${userId}`)
  return isRecord(value) ? value as CloudPreferencePatch : {}
}

function writeOutbox(userId: string, value: CloudPreferencePatch) {
  writeJSON(`${OUTBOX_PREFIX}${userId}`, value)
}

function clearOutbox(userId: string) {
  localStorage.removeItem(`${OUTBOX_PREFIX}${userId}`)
}

function removeSyncedOutboxSections(userId: string, sent: CloudPreferencePatch) {
  const current = readOutbox(userId)
  for (const key of Object.keys(sent) as Array<keyof CloudPreferenceSections>) {
    if (sameValue(current[key], sent[key])) delete current[key]
  }
  if (hasSections(current)) writeOutbox(userId, current)
  else clearOutbox(userId)
}

function readRecord(key: string): Record<string, any> {
  const value = readJSON(key)
  return isRecord(value) ? { ...value } : {}
}

function readJSON(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null')
  } catch {
    return null
  }
}

function writeJSON(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
}

function readString(key: string) {
  try {
    return localStorage.getItem(key) || ''
  } catch {
    return ''
  }
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === 'string' ? value : fallback
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function hasSections(value: CloudPreferencePatch) {
  return Object.keys(value).length > 0
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}
