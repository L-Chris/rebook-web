import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  CheckCircle2,
  Cloud,
  FileText,
  FolderSync,
  Loader2,
  Trash2,
  Upload,
} from 'lucide-react'
import {
  apiRequest,
  type CloudDriveAccount,
  type CloudDriveItem,
  type ImportJob,
} from '../../lib/api'
import { inputClass, primaryButtonClass, toolbarButtonClass } from '../../lib/ui-classes'
import { useI18n, type Translate } from '../i18n/LanguageContext'

type SyncJob = {
  id: string
  status: string
  totalItems: number
  processedItems: number
  errorMessage: string | null
}

export function CloudDrivePage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const uploadInput = useRef<HTMLInputElement>(null)
  const [accounts, setAccounts] = useState<CloudDriveAccount[]>([])
  const [activeId, setActiveId] = useState('')
  const [items, setItems] = useState<CloudDriveItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    displayName: t('cloud.defaultName'),
    serverUrl: 'https://dav.jianguoyun.com/dav',
    username: '',
    password: '',
    rootPath: '/rebook/books',
  })

  const activeAccount = accounts.find(account => account.id === activeId) || accounts[0]

  const loadItems = useCallback(async (accountId: string) => {
    if (!accountId) {
      setItems([])
      return
    }
    const result = await apiRequest<{ items: CloudDriveItem[] }>(
      `/cloud-drive/accounts/${accountId}/items?page=1&pageSize=100`,
    )
    setItems(result.items)
  }, [])

  const loadAccounts = useCallback(async () => {
    setLoading(true)
    try {
      const result = await apiRequest<{ items: CloudDriveAccount[] }>('/cloud-drive/accounts')
      setAccounts(result.items)
      const nextId =
        activeId && result.items.some(item => item.id === activeId)
          ? activeId
          : result.items[0]?.id || ''
      setActiveId(nextId)
      await loadItems(nextId)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('cloud.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [activeId, loadItems, t])

  useEffect(() => {
    void loadAccounts()
  }, [])

  const connect = async () => {
    setBusy('connect')
    setError('')
    setMessage('')
    try {
      const account = await apiRequest<CloudDriveAccount>('/cloud-drive/webdav/accounts', {
        method: 'POST',
        json: form,
      })
      setForm(value => ({ ...value, password: '' }))
      setMessage(t('cloud.connectedNotice'))
      setActiveId(account.id)
      await loadAccounts()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('cloud.connectFailed'))
    } finally {
      setBusy('')
    }
  }

  const sync = async () => {
    if (!activeAccount) return
    setBusy('sync')
    setError('')
    setMessage(t('cloud.syncingFiles'))
    try {
      const job = await apiRequest<SyncJob>(
        `/cloud-drive/accounts/${activeAccount.id}/sync`,
        { method: 'POST', json: {} },
      )
      const completed = await waitForSync(job.id, setMessage, t)
      setMessage(t('cloud.syncCompleted', { count: completed.totalItems }))
      await loadItems(activeAccount.id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('cloud.syncFailed'))
      setMessage('')
    } finally {
      setBusy('')
    }
  }

  const importItem = async (item: CloudDriveItem) => {
    setBusy(`import:${item.id}`)
    setError('')
    setMessage(t('cloud.importingFile', { name: item.name }))
    try {
      const result = await apiRequest<ImportJob & { alreadyImported?: boolean }>(
        `/cloud-drive/items/${item.id}/import`,
        { method: 'POST', json: {} },
      )
      const completed =
        result.status === 'completed'
          ? result
          : await waitForImport(result.id, setMessage, t)
      await loadItems(item.accountId)
      if (completed.bookId) {
        navigate(`/reader/${completed.bookId}`)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('cloud.importFailed'))
      setMessage('')
    } finally {
      setBusy('')
    }
  }

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !activeAccount) return
    setBusy('upload')
    setError('')
    setMessage(t('cloud.uploadingFile', { name: file.name }))
    try {
      const formData = new FormData()
      formData.append('file', file)
      const job = await apiRequest<ImportJob>(
        `/cloud-drive/accounts/${activeAccount.id}/upload`,
        { method: 'POST', body: formData },
      )
      const completed = await waitForImport(job.id, setMessage, t)
      await loadItems(activeAccount.id)
      if (completed.bookId) navigate(`/reader/${completed.bookId}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('cloud.uploadFailed'))
      setMessage('')
    } finally {
      setBusy('')
    }
  }

  const unbind = async () => {
    if (!activeAccount || !window.confirm(t('cloud.unbindConfirm'))) return
    setBusy('unbind')
    try {
      await apiRequest(`/cloud-drive/accounts/${activeAccount.id}`, {
        method: 'DELETE',
        json: {},
      })
      setMessage(t('cloud.unbound'))
      setActiveId('')
      await loadAccounts()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('cloud.unbindFailed'))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-7 md:px-7 md:py-10">
      <button className="inline-flex items-center gap-2 text-ui-md text-muted transition-colors duration-150 hover:text-ink" onClick={() => navigate('/')}>
        <ArrowLeft className="h-4 w-4" />
        {t('common.backToShelf')}
      </button>
      <div className="mt-5">
        <p className="text-ui-sm font-medium tracking-wide text-accent-text">CLOUD STORAGE</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">WebDAV</h1>
        <p className="mt-2 text-ui-md text-muted">{t('cloud.description')}</p>
      </div>

      {(message || error) ? (
        <div className={`mt-6 rounded-xl border px-4 py-3 text-ui-md ${
          error ? 'border-danger-line bg-danger-soft text-danger' : 'border-success-line bg-success-soft text-success'
        }`}>
          {error || message}
        </div>
      ) : null}

      {loading ? (
        <div className="grid min-h-80 place-items-center text-accent-text">
          <Loader2 className="h-7 w-7 animate-spin" />
        </div>
      ) : (
        <div className="mt-7 space-y-6">
          <section className="overflow-hidden rounded-xl border border-line bg-surface">
            <div className="flex flex-col gap-4 border-b border-line p-5 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-accent-soft text-accent-text">
                  <Cloud className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-ui-lg font-semibold text-ink">{t('cloud.account')}</h2>
                  <p className="mt-0.5 text-ui-sm text-muted">{activeAccount ? t('cloud.connected') : t('cloud.connectHint')}</p>
                </div>
              </div>
              {activeAccount ? (
                <div className="flex flex-wrap gap-2">
                  <input ref={uploadInput} className="hidden" type="file" accept=".epub,.pdf,.mobi,.azw,.azw3,.fb2,.fbz,.cbz" onChange={upload} />
                  <ActionButton busy={busy === 'sync'} onClickAction={() => void sync()} icon={<FolderSync className="h-4 w-4" />}>{t('cloud.sync')}</ActionButton>
                  <ActionButton busy={busy === 'upload'} onClickAction={() => uploadInput.current?.click()} icon={<Upload className="h-4 w-4" />}>{t('cloud.upload')}</ActionButton>
                  <ActionButton busy={busy === 'unbind'} onClickAction={() => void unbind()} icon={<Trash2 className="h-4 w-4" />}>{t('cloud.unbind')}</ActionButton>
                </div>
              ) : null}
            </div>

            <div className="p-5">
              {accounts.length ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {accounts.map(account => (
                    <button
                      key={account.id}
                      className={`flex items-center justify-between rounded-xl border p-4 text-left transition-colors duration-150 ${
                        activeAccount?.id === account.id
                          ? 'border-accent bg-accent-soft'
                          : 'border-line hover:border-line-strong'
                      }`}
                      onClick={() => {
                        setActiveId(account.id)
                        void loadItems(account.id)
                      }}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-ui-md font-medium text-ink">{account.displayName || 'WebDAV'}</div>
                        <div className="mt-1 truncate text-ui-sm text-muted">{account.username}</div>
                        <div className="mt-1 truncate text-ui-sm text-muted">{account.rootPath}</div>
                      </div>
                      {activeAccount?.id === account.id ? <CheckCircle2 className="h-4 w-4 shrink-0 text-accent-text" /> : null}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  <Input label={t('cloud.displayName')} value={form.displayName} onChangeValue={value => setForm(current => ({ ...current, displayName: value }))} />
                  <Input label={t('cloud.serverUrl')} value={form.serverUrl} onChangeValue={value => setForm(current => ({ ...current, serverUrl: value }))} />
                  <Input label={t('cloud.username')} value={form.username} onChangeValue={value => setForm(current => ({ ...current, username: value }))} />
                  <Input label={t('cloud.appPassword')} type="password" value={form.password} onChangeValue={value => setForm(current => ({ ...current, password: value }))} />
                  <Input label={t('cloud.booksDirectory')} value={form.rootPath} onChangeValue={value => setForm(current => ({ ...current, rootPath: value }))} />
                  <div className="flex items-end">
                    <button
                      className={`${primaryButtonClass} h-10 w-full`}
                      disabled={busy === 'connect'}
                      onClick={() => void connect()}
                    >
                      {busy === 'connect' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
                      {t('cloud.connect')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          {activeAccount ? (
            <section className="overflow-hidden rounded-xl border border-line bg-surface">
              <div className="border-b border-line p-5">
                <h2 className="text-ui-lg font-semibold text-ink">{t('cloud.remoteBooks')}</h2>
                <p className="mt-1 text-ui-sm text-muted">{t('cloud.remoteBooksDescription')}</p>
              </div>
              {items.length ? (
                <div className="divide-y divide-line">
                  {items.map(item => (
                    <div key={item.id} className="flex items-center gap-3 px-5 py-4">
                      <FileText className="h-4 w-4 shrink-0 text-muted" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-ui-md font-medium text-ink">{item.name}</div>
                        <div className="mt-1 truncate text-ui-sm text-muted">
                          {formatSize(item.size)} · {item.path}
                        </div>
                      </div>
                      <span className="hidden rounded-full bg-surface-muted px-2 py-1 text-ui-sm text-muted sm:inline">
                        {statusLabel(item.syncStatus, t)}
                      </span>
                      <button
                        className={primaryButtonClass}
                        disabled={item.syncStatus === 'unsupported' || busy === `import:${item.id}`}
                        onClick={() => void importItem(item)}
                      >
                        {busy === `import:${item.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                        {item.bookId ? t('common.open') : t('common.import')}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-5 py-16 text-center text-ui-md text-muted">
                  {t('cloud.empty')}
                </div>
              )}
            </section>
          ) : null}
        </div>
      )}
    </div>
  )
}

function Input({
  label,
  value,
  onChangeValue,
  type = 'text',
}: {
  label: string
  value: string
  onChangeValue: (value: string) => void
  type?: string
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-ui-md font-medium text-ink-soft">{label}</span>
      <input
        className={inputClass}
        type={type}
        value={value}
        onChange={event => onChangeValue(event.target.value)}
      />
    </label>
  )
}

function ActionButton({
  busy,
  onClickAction,
  icon,
  children,
}: {
  busy: boolean
  onClickAction: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      className={toolbarButtonClass}
      disabled={busy}
      onClick={onClickAction}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  )
}

async function waitForSync(jobId: string, setMessage: (value: string) => void, t: Translate) {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const job = await apiRequest<SyncJob>(`/cloud-drive/sync-jobs/${jobId}`)
    setMessage(t('cloud.syncProgress', { processed: job.processedItems, total: Math.max(job.totalItems, job.processedItems) }))
    if (job.status === 'completed') return job
    if (job.status === 'failed') throw new Error(job.errorMessage || t('cloud.syncFailed'))
    await new Promise(resolve => window.setTimeout(resolve, 1000))
  }
  throw new Error(t('cloud.syncTimeout'))
}

async function waitForImport(jobId: string, setMessage: (value: string) => void, t: Translate) {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const job = await apiRequest<ImportJob>(`/shelf/import-jobs/${jobId}`)
    setMessage(t('cloud.importProgress', { progress: job.progress }))
    if (job.status === 'completed') return job
    if (job.status === 'failed') throw new Error(job.errorMessage || t('cloud.importFailed'))
    await new Promise(resolve => window.setTimeout(resolve, 1000))
  }
  throw new Error(t('cloud.importTimeout'))
}

function formatSize(size: number | null) {
  if (!size) return '-'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function statusLabel(status: string, t: Translate) {
  if (status === 'imported') return t('cloud.statusImported')
  if (status === 'unsupported') return t('cloud.statusUnsupported')
  if (status === 'importing') return t('cloud.statusImporting')
  if (status === 'error') return t('cloud.statusError')
  return t('cloud.statusAvailable')
}
