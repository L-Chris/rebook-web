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

type SyncJob = {
  id: string
  status: string
  totalItems: number
  processedItems: number
  errorMessage: string | null
}

export function CloudDrivePage() {
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
    displayName: '坚果云',
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
      setError(reason instanceof Error ? reason.message : 'WebDAV 设置加载失败')
    } finally {
      setLoading(false)
    }
  }, [activeId, loadItems])

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
      setMessage('WebDAV 绑定成功')
      setActiveId(account.id)
      await loadAccounts()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'WebDAV 绑定失败')
    } finally {
      setBusy('')
    }
  }

  const sync = async () => {
    if (!activeAccount) return
    setBusy('sync')
    setError('')
    setMessage('正在同步 WebDAV 文件…')
    try {
      const job = await apiRequest<SyncJob>(
        `/cloud-drive/accounts/${activeAccount.id}/sync`,
        { method: 'POST', json: {} },
      )
      const completed = await waitForSync(job.id, setMessage)
      setMessage(`同步完成，共发现 ${completed.totalItems} 个项目`)
      await loadItems(activeAccount.id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '同步失败')
      setMessage('')
    } finally {
      setBusy('')
    }
  }

  const importItem = async (item: CloudDriveItem) => {
    setBusy(`import:${item.id}`)
    setError('')
    setMessage(`正在导入 ${item.name}…`)
    try {
      const result = await apiRequest<ImportJob & { alreadyImported?: boolean }>(
        `/cloud-drive/items/${item.id}/import`,
        { method: 'POST', json: {} },
      )
      const completed =
        result.status === 'completed'
          ? result
          : await waitForImport(result.id, setMessage)
      await loadItems(item.accountId)
      if (completed.bookId) {
        navigate(`/reader/${completed.bookId}`)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '导入失败')
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
    setMessage(`正在上传 ${file.name} 到 WebDAV…`)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const job = await apiRequest<ImportJob>(
        `/cloud-drive/accounts/${activeAccount.id}/upload`,
        { method: 'POST', body: formData },
      )
      const completed = await waitForImport(job.id, setMessage)
      await loadItems(activeAccount.id)
      if (completed.bookId) navigate(`/reader/${completed.bookId}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '上传失败')
      setMessage('')
    } finally {
      setBusy('')
    }
  }

  const unbind = async () => {
    if (!activeAccount || !window.confirm('确定解绑这个 WebDAV 账号吗？已导入书籍不会删除。')) return
    setBusy('unbind')
    try {
      await apiRequest(`/cloud-drive/accounts/${activeAccount.id}`, {
        method: 'DELETE',
        json: {},
      })
      setMessage('WebDAV 已解绑')
      setActiveId('')
      await loadAccounts()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '解绑失败')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-7 md:px-7 md:py-10">
      <button className="inline-flex items-center gap-2 text-ui-md text-muted transition-colors duration-150 hover:text-ink" onClick={() => navigate('/')}>
        <ArrowLeft className="h-4 w-4" />
        返回书架
      </button>
      <div className="mt-5">
        <p className="text-ui-sm font-medium tracking-wide text-accent-text">CLOUD STORAGE</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">WebDAV</h1>
        <p className="mt-2 text-ui-md text-muted">支持坚果云、Nextcloud 和兼容 WebDAV 的自建存储。</p>
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
                  <h2 className="text-ui-lg font-semibold text-ink">WebDAV 账号</h2>
                  <p className="mt-0.5 text-ui-sm text-muted">{activeAccount ? '已连接' : '使用第三方应用密码连接'}</p>
                </div>
              </div>
              {activeAccount ? (
                <div className="flex flex-wrap gap-2">
                  <input ref={uploadInput} className="hidden" type="file" accept=".epub,.pdf,.mobi,.azw,.azw3,.fb2,.fbz,.cbz" onChange={upload} />
                  <ActionButton busy={busy === 'sync'} onClickAction={() => void sync()} icon={<FolderSync className="h-4 w-4" />}>同步</ActionButton>
                  <ActionButton busy={busy === 'upload'} onClickAction={() => uploadInput.current?.click()} icon={<Upload className="h-4 w-4" />}>上传</ActionButton>
                  <ActionButton busy={busy === 'unbind'} onClickAction={() => void unbind()} icon={<Trash2 className="h-4 w-4" />}>解绑</ActionButton>
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
                  <Input label="显示名称" value={form.displayName} onChangeValue={value => setForm(current => ({ ...current, displayName: value }))} />
                  <Input label="WebDAV 地址" value={form.serverUrl} onChangeValue={value => setForm(current => ({ ...current, serverUrl: value }))} />
                  <Input label="账号" value={form.username} onChangeValue={value => setForm(current => ({ ...current, username: value }))} />
                  <Input label="第三方应用密码" type="password" value={form.password} onChangeValue={value => setForm(current => ({ ...current, password: value }))} />
                  <Input label="书籍目录" value={form.rootPath} onChangeValue={value => setForm(current => ({ ...current, rootPath: value }))} />
                  <div className="flex items-end">
                    <button
                      className={`${primaryButtonClass} h-10 w-full`}
                      disabled={busy === 'connect'}
                      onClick={() => void connect()}
                    >
                      {busy === 'connect' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
                      绑定 WebDAV
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          {activeAccount ? (
            <section className="overflow-hidden rounded-xl border border-line bg-surface">
              <div className="border-b border-line p-5">
                <h2 className="text-ui-lg font-semibold text-ink">远程书籍</h2>
                <p className="mt-1 text-ui-sm text-muted">同步只读取文件元数据，点击导入后才会下载并解析。</p>
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
                        {statusLabel(item.syncStatus)}
                      </span>
                      <button
                        className={primaryButtonClass}
                        disabled={item.syncStatus === 'unsupported' || busy === `import:${item.id}`}
                        onClick={() => void importItem(item)}
                      >
                        {busy === `import:${item.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                        {item.bookId ? '打开' : '导入'}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-5 py-16 text-center text-ui-md text-muted">
                  暂无文件，点击“同步”扫描远程目录。
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

async function waitForSync(jobId: string, setMessage: (value: string) => void) {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const job = await apiRequest<SyncJob>(`/cloud-drive/sync-jobs/${jobId}`)
    setMessage(`正在同步… ${job.processedItems}/${Math.max(job.totalItems, job.processedItems)}`)
    if (job.status === 'completed') return job
    if (job.status === 'failed') throw new Error(job.errorMessage || '同步失败')
    await new Promise(resolve => window.setTimeout(resolve, 1000))
  }
  throw new Error('同步超时')
}

async function waitForImport(jobId: string, setMessage: (value: string) => void) {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const job = await apiRequest<ImportJob>(`/shelf/import-jobs/${jobId}`)
    setMessage(`正在导入书籍… ${job.progress}%`)
    if (job.status === 'completed') return job
    if (job.status === 'failed') throw new Error(job.errorMessage || '导入失败')
    await new Promise(resolve => window.setTimeout(resolve, 1000))
  }
  throw new Error('导入超时')
}

function formatSize(size: number | null) {
  if (!size) return '-'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function statusLabel(status: string) {
  if (status === 'imported') return '已导入'
  if (status === 'unsupported') return '不支持'
  if (status === 'importing') return '导入中'
  if (status === 'error') return '异常'
  return '可导入'
}
