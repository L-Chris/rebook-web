/**
 * App-level WebDAV sync wiring: owns the sync lifecycle and exposes status
 * plus `syncNow()` to the UI.
 *
 * Triggers (all throttled to at most one run per 2 minutes):
 *  - app start (once, when enabled)
 *  - `rebook:local-book-imported` (shelf import finished a book)
 *  - leaving the reader route back to the shelf (delayed so the reader's
 *    final progress flush lands first)
 *  - an interval timer per `settings.intervalMinutes` while the tab is
 *    visible, plus a run when the tab becomes visible again
 *
 * Everything is a no-op when sync is disabled or the settings are
 * incomplete. The engine itself lives in `./engine`; storage adaptation in
 * `./adapter`.
 */
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
import { useLocation } from 'react-router-dom'

import {
  applySyncedProgress,
  createLocalLibrary,
  exportLocalAnnotations,
  finalizeExportedAnnotations,
  importSyncedAnnotations,
  publishLocalProgress,
} from './adapter'
import { runSync } from './engine'
import {
  loadSyncSettings,
  normalizeSyncSettings,
  validateSyncSettings,
  type SyncSettings,
} from './providers'
import { openSyncStore } from './store'
import { getLocalBookAnnotationIdentity } from '../../lib/local-library'
import { READER_CONFIG_CHANGED_EVENT } from '../../lib/preference-events'

export type SyncStatus = 'idle' | 'syncing' | 'success' | 'error'

export interface SyncContextValue {
  status: SyncStatus
  /** Epoch milliseconds of the last successful sync; null when never. */
  lastSyncAt: number | null
  lastError: string | null
  settings: SyncSettings
  syncNow(): Promise<void>
  /** Record a shelf-removal tombstone so the engine stops re-downloading. */
  markLocalBookRemoved(libraryBookId: string): Promise<void>
}

const SyncContext = createContext<SyncContextValue | null>(null)

const STATUS_STORAGE_KEY = 'rebook-webdav-sync-status'
const SYNC_THROTTLE_MS = 2 * 60 * 1000
const READER_ROUTE_PREFIX = '/reader/'

interface PersistedSyncStatus {
  lastSyncAt: number | null
  lastError: string | null
}

function loadPersistedStatus(): PersistedSyncStatus {
  try {
    const value = JSON.parse(localStorage.getItem(STATUS_STORAGE_KEY) || '{}')
    return {
      lastSyncAt: typeof value.lastSyncAt === 'number' ? value.lastSyncAt : null,
      lastError: typeof value.lastError === 'string' ? value.lastError : null,
    }
  } catch {
    return { lastSyncAt: null, lastError: null }
  }
}

function persistStatus(status: PersistedSyncStatus): void {
  try {
    localStorage.setItem(STATUS_STORAGE_KEY, JSON.stringify(status))
  } catch {
    // Status persistence is best-effort.
  }
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  const [settings, setSettings] = useState<SyncSettings>(() => loadSyncSettings())
  const [status, setStatus] = useState<SyncStatus>('idle')
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(() => loadPersistedStatus().lastSyncAt)
  const [lastError, setLastError] = useState<string | null>(() => loadPersistedStatus().lastError)
  const runningRef = useRef<Promise<void> | null>(null)
  const lastAttemptRef = useRef(0)
  const openBookIdRef = useRef<string | null>(null)

  openBookIdRef.current = location.pathname.startsWith(READER_ROUTE_PREFIX)
    ? decodeURIComponent(location.pathname.slice(READER_ROUTE_PREFIX.length)) || null
    : null

  const syncNow = useCallback((): Promise<void> => {
    if (runningRef.current) return runningRef.current
    const now = Date.now()
    if (now - lastAttemptRef.current < SYNC_THROTTLE_MS) return Promise.resolve()
    lastAttemptRef.current = now

    const task = (async () => {
      const current = normalizeSyncSettings(loadSyncSettings())
      if (!current.enabled) return
      try {
        validateSyncSettings(current)
      } catch {
        return // Incomplete settings: stay quiet until the user finishes the form.
      }
      setStatus('syncing')
      setLastError(null)
      try {
        const store = await openSyncStore(current.deviceId)
        await publishLocalProgress(store)
        const exported = await exportLocalAnnotations(store)
        await runSync({ settings: current, library: createLocalLibrary(), store })
        await finalizeExportedAnnotations(exported)
        await importSyncedAnnotations(store)
        await applySyncedProgress(store, openBookIdRef.current)
        const completedAt = Date.now()
        persistStatus({ lastSyncAt: completedAt, lastError: null })
        setLastSyncAt(completedAt)
        setStatus('success')
        window.dispatchEvent(new Event('rebook:cloud-sync-completed'))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        persistStatus({ lastSyncAt: loadPersistedStatus().lastSyncAt, lastError: message })
        setLastError(message)
        setStatus('error')
      }
    })()
    runningRef.current = task
    return task.finally(() => {
      if (runningRef.current) runningRef.current = null
    })
  }, [])

  const markLocalBookRemoved = useCallback(async (libraryBookId: string): Promise<void> => {
    try {
      const identity = await getLocalBookAnnotationIdentity(libraryBookId)
      if (!identity) return
      const store = await openSyncStore(loadSyncSettings().deviceId)
      await store.setBookPresent(identity.contentHash, false)
    } catch {
      // The tombstone is a hint for future syncs; losing it only means the
      // book may be re-downloaded once.
    }
  }, [])

  // Reload settings when the settings dialog saves, so interval/enabled
  // changes take effect without a reload.
  useEffect(() => {
    const reload = () => setSettings(loadSyncSettings())
    window.addEventListener(READER_CONFIG_CHANGED_EVENT, reload)
    return () => window.removeEventListener(READER_CONFIG_CHANGED_EVENT, reload)
  }, [])

  // App start: one sync attempt (no-op when disabled).
  useEffect(() => {
    void syncNow()
  }, [syncNow])

  // Shelf import finished a book.
  useEffect(() => {
    const onImported = () => void syncNow()
    window.addEventListener('rebook:local-book-imported', onImported)
    return () => window.removeEventListener('rebook:local-book-imported', onImported)
  }, [syncNow])

  // Leaving the reader back to the shelf. Delayed so the reader's unmount
  // progress flush reaches IndexedDB before the engine reads it.
  const previousPathRef = useRef(location.pathname)
  useEffect(() => {
    const previous = previousPathRef.current
    previousPathRef.current = location.pathname
    if (!previous.startsWith(READER_ROUTE_PREFIX) || location.pathname.startsWith(READER_ROUTE_PREFIX)) {
      return
    }
    const timer = window.setTimeout(() => void syncNow(), 2000)
    return () => window.clearTimeout(timer)
  }, [location.pathname, syncNow])

  // Interval timer while the tab is visible + a run on tab-visible.
  useEffect(() => {
    if (!settings.enabled) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void syncNow()
    }, settings.intervalMinutes * 60 * 1000)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void syncNow()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [settings.enabled, settings.intervalMinutes, syncNow])

  const value = useMemo<SyncContextValue>(() => ({
    status,
    lastSyncAt,
    lastError,
    settings,
    syncNow,
    markLocalBookRemoved,
  }), [status, lastSyncAt, lastError, settings, syncNow, markLocalBookRemoved])

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}

export function useSync(): SyncContextValue {
  const value = useContext(SyncContext)
  if (!value) throw new Error('useSync must be used inside SyncProvider')
  return value
}
