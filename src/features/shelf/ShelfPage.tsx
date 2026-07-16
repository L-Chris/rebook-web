import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BookOpen,
  Cloud,
  Loader2,
  Search,
  Trash2,
  Upload,
} from 'lucide-react'
import {
  apiRequest,
  apiUrl,
  type ImportJob,
  type ShelfItem,
  type ShelfList,
} from '../../lib/api'

const STATUS_TABS = [
  ['all', '全部'],
  ['reading', '在读'],
  ['wantToRead', '想读'],
  ['finished', '已读'],
  ['archived', '归档'],
] as const

export function ShelfPage() {
  const navigate = useNavigate()
  const fileInput = useRef<HTMLInputElement>(null)
  const [data, setData] = useState<ShelfList | null>(null)
  const [status, setStatus] = useState('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: '24',
      })
      if (status !== 'all') params.set('status', status)
      if (query.trim()) params.set('query', query.trim())
      setData(await apiRequest<ShelfList>(`/shelf/items?${params}`))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '书架加载失败')
    } finally {
      setLoading(false)
    }
  }, [page, query, status])

  useEffect(() => {
    void load()
  }, [load])

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploading(true)
    setError('')
    setNotice(`正在上传 ${file.name}…`)
    try {
      const form = new FormData()
      form.append('file', file)
      const job = await apiRequest<ImportJob>('/shelf/uploads', {
        method: 'POST',
        body: form,
      })
      const completed = await waitForImport(job.id, setNotice)
      await load()
      if (completed.bookId) {
        navigate(`/reader/${completed.bookId}`)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '上传失败')
      setNotice('')
    } finally {
      setUploading(false)
    }
  }

  const changeStatus = async (item: ShelfItem, nextStatus: string) => {
    await apiRequest(`/shelf/items/${item.id}`, {
      method: 'PATCH',
      json: { status: nextStatus },
    })
    await load()
  }

  const removeItem = async (item: ShelfItem) => {
    if (!window.confirm(`确定把《${item.title}》移出书架吗？`)) return
    await apiRequest(`/shelf/items/${item.id}`, {
      method: 'DELETE',
      json: {},
    })
    await load()
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-7 md:px-7 md:py-10">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-teal-700">MY LIBRARY</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">我的书架</h1>
          <p className="mt-2 text-sm text-slate-500">在任意设备继续上次的阅读位置。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInput}
            className="hidden"
            type="file"
            accept=".epub,.pdf,.mobi,.azw,.azw3,.fb2,.fbz,.cbz"
            onChange={upload}
          />
          <button
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-60"
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            上传书籍
          </button>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-teal-300 hover:text-teal-800"
            onClick={() => navigate('/settings/cloud-drives')}
          >
            <Cloud className="h-4 w-4" />
            WebDAV
          </button>
        </div>
      </div>

      <div className="mt-7 flex flex-col gap-4 rounded-2xl border border-slate-200/80 bg-white/90 p-3 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="flex max-w-full gap-1 overflow-x-auto">
          {STATUS_TABS.map(([key, label]) => (
            <button
              key={key}
              className={`whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-medium transition ${
                status === key
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
              onClick={() => {
                setStatus(key)
                setPage(1)
              }}
            >
              {label}
              <span className={`ml-1.5 text-xs ${status === key ? 'text-slate-300' : 'text-slate-400'}`}>
                {data?.counts[key] ?? 0}
              </span>
            </button>
          ))}
        </div>
        <label className="flex h-10 min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 md:w-72">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
            placeholder="搜索书名或作者"
            value={query}
            onChange={event => {
              setQuery(event.target.value)
              setPage(1)
            }}
          />
        </label>
      </div>

      {notice ? (
        <div className="mt-5 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="grid min-h-80 place-items-center text-teal-700">
          <Loader2 className="h-7 w-7 animate-spin" />
        </div>
      ) : data?.items.length ? (
        <>
          <div className="mt-7 grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {data.items.map(item => (
              <article key={item.id} className="group min-w-0">
                <button
                  className="relative block aspect-[3/4.25] w-full overflow-hidden rounded-2xl bg-gradient-to-br from-slate-200 to-slate-300 text-left shadow-[0_12px_28px_rgba(15,23,42,.12)] transition duration-200 group-hover:-translate-y-1 group-hover:shadow-[0_20px_40px_rgba(15,23,42,.18)]"
                  onClick={() => navigate(`/reader/${item.id}`)}
                >
                  {item.coverUrl ? (
                    <img className="h-full w-full object-cover" src={apiUrl(item.coverUrl.replace(/^\/api/, ''))} alt="" />
                  ) : (
                    <div className="flex h-full flex-col justify-between p-4 text-slate-700">
                      <BookOpen className="h-7 w-7 opacity-50" />
                      <div>
                        <div className="line-clamp-4 font-serif text-lg font-semibold leading-snug">{item.title}</div>
                        <div className="mt-2 line-clamp-2 text-xs opacity-70">{item.author || item.sourceType.toUpperCase()}</div>
                      </div>
                    </div>
                  )}
                  {item.progress > 0 ? (
                    <div className="absolute inset-x-0 bottom-0 h-1.5 bg-black/20">
                      <div className="h-full bg-teal-400" style={{ width: `${Math.round(item.progress * 100)}%` }} />
                    </div>
                  ) : null}
                  <span className="absolute right-2 top-2 rounded-full bg-black/55 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-white backdrop-blur">
                    {item.storageProvider === 'webdav' ? 'WebDAV' : item.sourceType}
                  </span>
                </button>

                <div className="mt-3 min-w-0">
                  <button
                    className="line-clamp-2 text-left text-sm font-semibold leading-5 text-slate-900 hover:text-teal-800"
                    onClick={() => navigate(`/reader/${item.id}`)}
                  >
                    {item.title}
                  </button>
                  <p className="mt-1 truncate text-xs text-slate-500">
                    {item.author || '未知作者'} · {Math.round(item.progress * 100)}%
                  </p>
                  <div className="mt-2 flex items-center gap-1.5">
                    <select
                      className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600 outline-none"
                      value={item.status}
                      onChange={event => void changeStatus(item, event.target.value)}
                    >
                      <option value="reading">在读</option>
                      <option value="wantToRead">想读</option>
                      <option value="finished">已读</option>
                      <option value="archived">归档</option>
                    </select>
                    <button
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                      title="移出书架"
                      onClick={() => void removeItem(item)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>

          {data.totalPages > 1 ? (
            <div className="mt-10 flex justify-center gap-2">
              <button className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm disabled:opacity-40" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一页</button>
              <span className="px-3 py-2 text-sm text-slate-500">{page} / {data.totalPages}</span>
              <button className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm disabled:opacity-40" disabled={page >= data.totalPages} onClick={() => setPage(value => value + 1)}>下一页</button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="mt-7 grid min-h-96 place-items-center rounded-3xl border border-dashed border-slate-300 bg-white/60 px-6 text-center">
          <div>
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-400">
              <BookOpen className="h-7 w-7" />
            </span>
            <h2 className="mt-4 text-lg font-semibold text-slate-900">书架还是空的</h2>
            <p className="mt-2 text-sm text-slate-500">上传本地电子书，或者从 WebDAV 导入。</p>
          </div>
        </div>
      )}
    </div>
  )
}

async function waitForImport(
  jobId: string,
  setNotice: (message: string) => void,
) {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const job = await apiRequest<ImportJob>(`/shelf/import-jobs/${jobId}`)
    setNotice(`正在导入书籍… ${job.progress}%`)
    if (job.status === 'completed') return job
    if (job.status === 'failed') {
      throw new Error(job.errorMessage || '书籍导入失败')
    }
    await new Promise(resolve => window.setTimeout(resolve, 1000))
  }
  throw new Error('书籍导入超时')
}
