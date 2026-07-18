import { useMemo, useState, type ComponentType } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  AudioLines,
  BadgeCheck,
  Blocks,
  Bot,
  BookOpen,
  Check,
  ExternalLink,
  Languages,
  Loader2,
  Package,
  Power,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  X,
  type LucideProps,
} from 'lucide-react'
import {
  AI_CHAT_EXTENSION_ID,
  PROFESSIONAL_TRANSLATION_EXTENSION_ID,
  TRANSLATION_EXTENSION_ID,
  TTS_EXTENSION_ID,
  type RebookExtensionCatalogItem,
} from 'rebook'
import {
  installMarketplaceExtension,
  listExtensionMarketplaceItems,
  loadExtensionMarketplaceState,
  parseExtensionMarketplaceCatalog,
  saveExtensionMarketplaceState,
  setMarketplaceExtensionEnabled,
  uninstallMarketplaceExtension,
  type ExtensionMarketplaceState,
} from '../../lib/extension-marketplace'
import { iconButtonClass, primaryButtonClass, toolbarButtonClass } from '../../lib/ui-classes'

type StoreFilter = 'all' | 'installed' | 'reader' | 'ai' | 'translation' | 'tts'
type ExtensionIcon = ComponentType<LucideProps>

const filters: Array<{ id: StoreFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'installed', label: '已安装' },
  { id: 'reader', label: '阅读' },
  { id: 'ai', label: 'AI' },
  { id: 'translation', label: '翻译' },
  { id: 'tts', label: '朗读' },
]

const builtInMetadata: Record<string, {
  title: string
  description: string
  icon: ExtensionIcon
}> = {
  [TRANSLATION_EXTENSION_ID]: {
    title: '智能翻译',
    description: '使用语言模型翻译书籍内容，支持双语对照与替换原文。',
    icon: Languages,
  },
  [PROFESSIONAL_TRANSLATION_EXTENSION_ID]: {
    title: '专业翻译',
    description: '连接 rebook-service 的专业翻译工作流，并复用已缓存的段落结果。',
    icon: Sparkles,
  },
  [TTS_EXTENSION_ID]: {
    title: '文本朗读',
    description: '为书籍添加语音播放、预取与多角色朗读能力。',
    icon: AudioLines,
  },
  [AI_CHAT_EXTENSION_ID]: {
    title: '书籍对话',
    description: '围绕当前书籍搜索、提问、引用原文并辅助改写内容。',
    icon: Bot,
  },
}

export function ExtensionStorePage() {
  const navigate = useNavigate()
  const [state, setState] = useState<ExtensionMarketplaceState>(() => loadExtensionMarketplaceState())
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<StoreFilter>('all')
  const [sourceOpen, setSourceOpen] = useState(false)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const catalogResult = useMemo(() => parseExtensionMarketplaceCatalog(state), [state])
  const items = useMemo(() => listExtensionMarketplaceItems(state), [state])
  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return items.filter(item => {
      if (filter === 'installed' && !item.installed) return false
      if (filter !== 'all' && filter !== 'installed' && !item.manifest.categories?.includes(filter)) return false
      if (!normalizedQuery) return true
      const searchable = [
        extensionTitle(item),
        item.manifest.name,
        item.manifest.description,
        item.manifest.publisher,
        item.manifest.id,
        ...(item.manifest.categories || []),
        ...(item.manifest.keywords || []),
      ].filter(Boolean).join(' ').toLocaleLowerCase()
      return searchable.includes(normalizedQuery)
    })
  }, [filter, items, query])
  const installedCount = items.filter(item => item.installed).length

  const commit = (next: ExtensionMarketplaceState, message: string) => {
    try {
      saveExtensionMarketplaceState(next)
      setState(next)
      setError('')
      setNotice(message)
    } catch (reason) {
      setNotice('')
      setError(reason instanceof Error ? reason.message : '无法保存扩展状态')
    }
  }

  const install = (item: RebookExtensionCatalogItem) => {
    commit(installMarketplaceExtension(state, item.manifest.id), `“${extensionTitle(item)}”已安装`)
  }

  const toggle = (item: RebookExtensionCatalogItem) => {
    const enabled = !item.enabled
    commit(
      setMarketplaceExtensionEnabled(state, item.manifest.id, enabled),
      `“${extensionTitle(item)}”已${enabled ? '启用' : '停用'}`,
    )
  }

  const uninstall = (item: RebookExtensionCatalogItem) => {
    if (!window.confirm(`确定卸载“${extensionTitle(item)}”吗？`)) return
    commit(uninstallMarketplaceExtension(state, item.manifest.id), `“${extensionTitle(item)}”已卸载`)
  }

  const loadCatalog = async () => {
    const url = state.extensionCatalogURL.trim()
    if (!url) {
      setError('请先输入扩展目录地址')
      return
    }
    setCatalogLoading(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`扩展目录请求失败（${response.status}）`)
      const text = await response.text()
      const next = { ...state, extensionCatalogJSON: text }
      const parsed = parseExtensionMarketplaceCatalog(next)
      if (parsed.error) throw new Error(parsed.error)
      commit(next, `扩展目录已更新，共载入 ${parsed.entries.length} 个扩展`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '扩展目录加载失败')
    } finally {
      setCatalogLoading(false)
    }
  }

  return (
    <main className="h-full overflow-y-auto bg-bg text-ink">
      <header className="sticky top-0 z-40 border-b border-line bg-surface/92 px-4 backdrop-blur-xl md:px-7">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3">
          <button className={iconButtonClass} type="button" aria-label="返回书架" onClick={() => navigate('/')}>
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex min-w-0 items-center gap-2">
            <Blocks className="h-4 w-4 text-accent-text" />
            <h1 className="truncate text-ui-lg font-semibold">扩展商店</h1>
          </div>
          <label className="ml-auto hidden h-9 w-full max-w-sm items-center gap-2 rounded-lg border border-line bg-bg px-3 transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-softer sm:flex">
            <Search className="h-4 w-4 shrink-0 text-muted" />
            <input
              className="min-w-0 flex-1 bg-transparent text-ui-md outline-none placeholder:text-muted"
              value={query}
              placeholder="搜索扩展…"
              onChange={event => setQuery(event.target.value)}
            />
            {query ? (
              <button type="button" aria-label="清空搜索" className="text-muted hover:text-ink" onClick={() => setQuery('')}>
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </label>
          <button
            className={toolbarButtonClass}
            type="button"
            aria-expanded={sourceOpen}
            onClick={() => setSourceOpen(open => !open)}
          >
            <Settings2 className="h-4 w-4" />
            <span className="hidden sm:inline">扩展源</span>
          </button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-4 py-7 md:px-7 md:py-10">
        <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-menu">
          <div className="relative px-5 py-7 sm:px-8 sm:py-9">
            <div className="pointer-events-none absolute -right-12 -top-16 h-56 w-56 rounded-full bg-accent-soft blur-3xl" />
            <div className="relative max-w-2xl">
              <div className="mb-3 flex items-center gap-2 text-ui-sm font-semibold uppercase tracking-[0.14em] text-accent-text">
                <Sparkles className="h-4 w-4" />
                Rebook Extensions
              </div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">让阅读器按你的方式工作</h2>
              <p className="mt-3 max-w-xl text-ui-md leading-6 text-muted">
                安装翻译、语音、AI 对话等扩展。扩展状态保存在当前浏览器，打开任意书籍时自动生效。
              </p>
              <div className="mt-5 flex flex-wrap gap-2 text-ui-sm text-muted">
                <span className="rounded-full bg-surface-muted px-3 py-1.5">{items.length} 个可用扩展</span>
                <span className="rounded-full bg-accent-soft px-3 py-1.5 text-accent-text">{installedCount} 个已安装</span>
              </div>
            </div>
          </div>
        </section>

        <label className="mt-5 flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-3 transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-softer sm:hidden">
          <Search className="h-4 w-4 shrink-0 text-muted" />
          <input
            className="min-w-0 flex-1 bg-transparent text-ui-md outline-none placeholder:text-muted"
            value={query}
            placeholder="搜索扩展…"
            onChange={event => setQuery(event.target.value)}
          />
        </label>

        {sourceOpen ? (
          <section className="mt-5 rounded-xl border border-line bg-surface p-4 shadow-menu sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-ui-lg font-semibold">自定义扩展源</h2>
                <p className="mt-1 text-ui-sm text-muted">加载兼容 schemaVersion 1 的 Rebook 扩展目录。</p>
              </div>
              <button className={iconButtonClass} type="button" aria-label="关闭扩展源设置" onClick={() => setSourceOpen(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <input
                className="h-9 min-w-0 flex-1 rounded-lg border border-line-strong bg-bg px-3 text-ui-md outline-none placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent-softer"
                value={state.extensionCatalogURL}
                placeholder="https://example.com/rebook-extension-catalog.json"
                onChange={event => setState(current => ({ ...current, extensionCatalogURL: event.target.value }))}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !catalogLoading) void loadCatalog()
                }}
              />
              <button
                className={primaryButtonClass}
                type="button"
                disabled={catalogLoading || !state.extensionCatalogURL.trim()}
                onClick={() => void loadCatalog()}
              >
                {catalogLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {catalogLoading ? '加载中' : '加载目录'}
              </button>
            </div>
            <p className={`mt-2 text-ui-sm ${catalogResult.error ? 'text-danger' : 'text-muted'}`}>
              {catalogResult.error || `当前自定义目录包含 ${catalogResult.entries.length} 个扩展`}
            </p>
          </section>
        ) : null}

        {notice ? (
          <div className="mt-5 flex items-center gap-2 rounded-xl border border-success-line bg-success-soft px-4 py-3 text-ui-md text-success">
            <Check className="h-4 w-4 shrink-0" />
            {notice}
          </div>
        ) : null}
        {error ? (
          <div className="mt-5 rounded-xl border border-danger-line bg-danger-soft px-4 py-3 text-ui-md text-danger">
            {error}
          </div>
        ) : null}

        <div className="mt-7 flex gap-2 overflow-x-auto pb-1">
          {filters.map(item => (
            <button
              key={item.id}
              className={`shrink-0 rounded-full px-3.5 py-2 text-ui-md font-medium transition-colors ${
                filter === item.id
                  ? 'bg-accent text-accent-contrast'
                  : 'border border-line bg-surface text-ink-soft hover:border-line-strong hover:bg-surface-muted'
              }`}
              type="button"
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {filteredItems.length ? (
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {filteredItems.map(item => (
              <ExtensionCard
                key={item.manifest.id}
                item={item}
                onInstall={() => install(item)}
                onToggle={() => toggle(item)}
                onUninstall={() => uninstall(item)}
              />
            ))}
          </div>
        ) : (
          <div className="mt-5 grid min-h-64 place-items-center rounded-xl border border-dashed border-line-strong bg-surface text-center">
            <div className="px-6">
              <Package className="mx-auto h-9 w-9 text-muted" />
              <h2 className="mt-3 text-ui-lg font-semibold">没有匹配的扩展</h2>
              <p className="mt-1 text-ui-md text-muted">换个关键词或筛选条件试试。</p>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}

function ExtensionCard({
  item,
  onInstall,
  onToggle,
  onUninstall,
}: {
  item: RebookExtensionCatalogItem
  onInstall(): void
  onToggle(): void
  onUninstall(): void
}) {
  const metadata = builtInMetadata[item.manifest.id]
  const Icon = metadata?.icon || extensionIcon(item)
  const title = extensionTitle(item)
  return (
    <article className="group flex min-h-64 flex-col rounded-xl border border-line bg-surface p-5 transition duration-150 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-menu">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-text">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h2 className="truncate text-ui-xl font-semibold">{title}</h2>
            {item.verified ? <BadgeCheck className="h-4 w-4 shrink-0 text-accent-text" aria-label="已验证" /> : null}
          </div>
          <p className="mt-0.5 text-ui-sm text-muted">
            {item.manifest.publisher || 'Unknown'} · v{item.manifest.version}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-ui-xs font-semibold ${
          item.enabled
            ? 'bg-success-soft text-success'
            : item.installed
              ? 'bg-surface-muted text-muted'
              : 'bg-accent-soft text-accent-text'
        }`}>
          {item.enabled ? '已启用' : item.installed ? '已停用' : '可安装'}
        </span>
      </div>

      <p className="mt-4 line-clamp-3 text-ui-md leading-5 text-muted">
        {metadata?.description || item.manifest.description || '暂无扩展说明。'}
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {(item.manifest.categories || []).slice(0, 3).map(category => (
          <span key={category} className="rounded-md bg-surface-muted px-2 py-1 text-ui-xs font-medium text-muted">
            {categoryLabel(category)}
          </span>
        ))}
        <span className="rounded-md bg-surface-muted px-2 py-1 text-ui-xs font-medium text-muted">
          {item.source === 'builtin' ? '内置' : '商店'}
        </span>
      </div>

      <div className="mt-auto flex items-center gap-2 pt-5">
        {item.installed ? (
          <>
            <button className={item.enabled ? toolbarButtonClass : primaryButtonClass} type="button" onClick={onToggle}>
              <Power className="h-4 w-4" />
              {item.enabled ? '停用' : '启用'}
            </button>
            {item.source !== 'builtin' ? (
              <button className={toolbarButtonClass} type="button" onClick={onUninstall}>
                <Trash2 className="h-4 w-4" />
                卸载
              </button>
            ) : null}
          </>
        ) : (
          <button className={primaryButtonClass} type="button" onClick={onInstall}>
            安装
          </button>
        )}
        {item.manifest.homepage ? (
          <a
            className={`${iconButtonClass} ml-auto`}
            href={item.manifest.homepage}
            target="_blank"
            rel="noreferrer"
            aria-label={`打开 ${title} 主页`}
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        ) : null}
      </div>
    </article>
  )
}

function extensionTitle(item: RebookExtensionCatalogItem): string {
  return builtInMetadata[item.manifest.id]?.title || item.manifest.displayName || item.manifest.name
}

function extensionIcon(item: RebookExtensionCatalogItem): ExtensionIcon {
  const categories = item.manifest.categories || []
  if (categories.includes('translation')) return Languages
  if (categories.includes('tts')) return AudioLines
  if (categories.includes('ai')) return Bot
  if (categories.includes('reader')) return BookOpen
  return Blocks
}

function categoryLabel(category: string): string {
  switch (category) {
    case 'reader': return '阅读'
    case 'utility': return '工具'
    case 'translation': return '翻译'
    case 'ai': return 'AI'
    case 'tts': return '朗读'
    default: return category
  }
}
