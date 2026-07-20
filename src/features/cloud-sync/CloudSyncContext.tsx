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
  apiRequest,
  type CloudDriveAccount,
  type ImportJob,
  type SyncJob,
} from '../../lib/api'
import {
  getLocalLibrarySyncSummary,
  listLocalBooksForSync,
  updateLocalBookSync,
} from '../../lib/local-library'
import { useAuth } from '../auth/AuthContext'

const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000
const LAST_SYNC_KEY_PREFIX = 'rebook-cloud-auto-sync:'

type CloudSyncContextValue = {
  accounts: CloudDriveAccount[]
  loading: boolean
  syncing: boolean
  localBookCount: number
  localOnlyCount: number
  pendingCount: number
  error: string
  refreshAccounts(): Promise<void>
  syncNow(): Promise<void>
}

const CloudSyncContext = createContext<CloudSyncContextValue | null>(null)

export function CloudSyncProvider({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const [accounts, setAccounts] = useState<CloudDriveAccount[]>([])
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [localBookCount, setLocalBookCount] = useState(0)
  const [localOnlyCount, setLocalOnlyCount] = useState(0)
  const [pendingCount, setPendingCount] = useState(0)
  const [error, setError] = useState('')
  const accountRef = useRef<CloudDriveAccount | null>(null)
  const syncPromiseRef = useRef<Promise<void> | null>(null)

  const refreshSummary = useCallback(async () => {
    const summary = await getLocalLibrarySyncSummary()
    setLocalBookCount(summary.total)
    setLocalOnlyCount(summary.localOnly)
    setPendingCount(summary.pending)
  }, [])

  const runSync = useCallback(async (
    account: CloudDriveAccount,
    options: { forceRemote?: boolean } = {},
  ) => {
    if (!auth.user) return
    if (syncPromiseRef.current) return syncPromiseRef.current

    const task = (async () => {
      setSyncing(true)
      setError('')
      try {
        const lastSyncKey = `${LAST_SYNC_KEY_PREFIX}${auth.user!.id}:${account.id}`
        const lastSyncAt = Number(localStorage.getItem(lastSyncKey) || 0)
        if (options.forceRemote || Date.now() - lastSyncAt >= AUTO_SYNC_INTERVAL_MS) {
          try {
            const job = await apiRequest<SyncJob>(
              `/cloud-drive/accounts/${account.id}/sync`,
              { method: 'POST', json: {} },
            )
            await waitForSync(job)
            localStorage.setItem(lastSyncKey, String(Date.now()))
          } catch (reason) {
            setError(errorMessage(reason))
          }
        }

        const candidates = await listLocalBooksForSync(account.id)
        for (const candidate of candidates) {
          await updateLocalBookSync(candidate.id, {
            syncState: 'syncing',
            cloudAccountId: account.id,
            lastSyncError: null,
          })
          try {
            const body = new FormData()
            body.append('file', candidate.file)
            const job = await apiRequest<ImportJob>(
              `/cloud-drive/accounts/${account.id}/upload`,
              { method: 'POST', body },
            )
            const completed = job.status === 'completed' ? job : await waitForImport(job)
            if (!completed.bookId) throw new Error('Cloud import completed without a book ID')
            await updateLocalBookSync(candidate.id, {
              syncState: 'synced',
              cloudAccountId: account.id,
              serverBookId: completed.bookId,
              lastSyncError: null,
              retryCount: 0,
            })
          } catch (reason) {
            await updateLocalBookSync(candidate.id, {
              syncState: 'failed',
              cloudAccountId: account.id,
              lastSyncError: errorMessage(reason),
              retryCount: candidate.retryCount + 1,
            })
            setError(errorMessage(reason))
          }
        }
      } finally {
        await refreshSummary()
        setSyncing(false)
        window.dispatchEvent(new Event('rebook:cloud-sync-completed'))
      }
    })()
    syncPromiseRef.current = task
    try {
      await task
    } finally {
      syncPromiseRef.current = null
    }
  }, [auth.user, refreshSummary])

  const refreshAccounts = useCallback(async () => {
    if (!auth.user) {
      accountRef.current = null
      setAccounts([])
      await refreshSummary()
      return
    }
    setLoading(true)
    try {
      const result = await apiRequest<{ items: CloudDriveAccount[] }>('/cloud-drive/accounts')
      setAccounts(result.items)
      const account = result.items.find(item => item.status === 'active') || result.items[0] || null
      accountRef.current = account
      if (account) void runSync(account)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setLoading(false)
      await refreshSummary()
    }
  }, [auth.user, refreshSummary, runSync])

  const syncNow = useCallback(async () => {
    if (accountRef.current) await runSync(accountRef.current, { forceRemote: true })
  }, [runSync])

  useEffect(() => {
    void refreshAccounts()
  }, [refreshAccounts])

  useEffect(() => {
    const accountsChanged = () => void refreshAccounts()
    const localBookImported = () => {
      void refreshSummary()
      const account = accountRef.current
      if (account) {
        void runSync(account).then(() => {
          if (accountRef.current?.id === account.id) void runSync(account)
        })
      }
    }
    const resumeSync = () => {
      if (document.visibilityState === 'visible' && accountRef.current) {
        void runSync(accountRef.current)
      }
    }
    window.addEventListener('rebook:cloud-accounts-changed', accountsChanged)
    window.addEventListener('rebook:local-book-imported', localBookImported)
    window.addEventListener('online', resumeSync)
    document.addEventListener('visibilitychange', resumeSync)
    return () => {
      window.removeEventListener('rebook:cloud-accounts-changed', accountsChanged)
      window.removeEventListener('rebook:local-book-imported', localBookImported)
      window.removeEventListener('online', resumeSync)
      document.removeEventListener('visibilitychange', resumeSync)
    }
  }, [refreshAccounts, refreshSummary, runSync])

  const value = useMemo<CloudSyncContextValue>(() => ({
    accounts,
    loading,
    syncing,
    localBookCount,
    localOnlyCount,
    pendingCount,
    error,
    refreshAccounts,
    syncNow,
  }), [
    accounts,
    error,
    loading,
    localBookCount,
    localOnlyCount,
    pendingCount,
    refreshAccounts,
    syncNow,
    syncing,
  ])

  return <CloudSyncContext.Provider value={value}>{children}</CloudSyncContext.Provider>
}

export function useCloudSync() {
  const value = useContext(CloudSyncContext)
  if (!value) throw new Error('useCloudSync must be used inside CloudSyncProvider')
  return value
}

async function waitForSync(initial: SyncJob) {
  let job = initial
  for (let attempt = 0; attempt < 600; attempt += 1) {
    if (job.status === 'completed') return job
    if (job.status === 'failed') throw new Error(job.errorMessage || 'Cloud sync failed')
    await delay(500)
    job = await apiRequest<SyncJob>(`/cloud-drive/sync-jobs/${job.id}`)
  }
  throw new Error('Cloud sync timed out')
}

async function waitForImport(initial: ImportJob) {
  let job = initial
  for (let attempt = 0; attempt < 600; attempt += 1) {
    if (job.status === 'completed') return job
    if (job.status === 'failed') throw new Error(job.errorMessage || 'Cloud import failed')
    await delay(500)
    job = await apiRequest<ImportJob>(`/shelf/import-jobs/${job.id}`)
  }
  throw new Error('Cloud import timed out')
}

function delay(milliseconds: number) {
  return new Promise(resolve => window.setTimeout(resolve, milliseconds))
}

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason)
}
