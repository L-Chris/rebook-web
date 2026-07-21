import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
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
  PackagePlus,
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
  REBOOK_EXTENSION_HOST_API_VERSION,
  TRANSLATION_EXTENSION_ID,
  TTS_EXTENSION_ID,
  type RebookExtensionCatalogItem,
} from 'rebook'
import {
  installMarketplaceExtension,
  fetchExtensionMarketplaceCatalogJSON,
  listExtensionMarketplaceItems,
  loadExtensionMarketplaceState,
  parseExtensionMarketplaceCatalog,
  saveExtensionMarketplaceState,
  setMarketplaceExtensionEnabled,
  uninstallMarketplaceExtension,
  type ExtensionMarketplaceState,
} from '../../lib/extension-marketplace'
import { iconButtonClass, primaryButtonClass, toolbarButtonClass } from '../../lib/ui-classes'
import { READER_CONFIG_CHANGED_EVENT } from '../../lib/preference-events'
import { useI18n, type MessageKey, type Translate } from '../i18n/LanguageContext'

type StoreFilter = 'all' | 'installed' | 'reader' | 'ai' | 'translation' | 'tts'
type ExtensionIcon = ComponentType<LucideProps>

const filters: Array<{ id: StoreFilter; labelKey: MessageKey }> = [
  { id: 'all', labelKey: 'store.all' },
  { id: 'installed', labelKey: 'store.installed' },
  { id: 'reader', labelKey: 'store.reader' },
  { id: 'ai', labelKey: 'store.ai' },
  { id: 'translation', labelKey: 'store.translation' },
  { id: 'tts', labelKey: 'store.tts' },
]

const builtInMetadata: Record<string, {
  titleKey: MessageKey
  descriptionKey: MessageKey
  icon: ExtensionIcon
}> = {
  [TRANSLATION_EXTENSION_ID]: {
    titleKey: 'store.smartTranslation',
    descriptionKey: 'store.smartTranslationDescription',
    icon: Languages,
  },
  [PROFESSIONAL_TRANSLATION_EXTENSION_ID]: {
    titleKey: 'store.professionalTranslation',
    descriptionKey: 'store.professionalTranslationDescription',
    icon: Sparkles,
  },
  [TTS_EXTENSION_ID]: {
    titleKey: 'store.textToSpeech',
    descriptionKey: 'store.textToSpeechDescription',
    icon: AudioLines,
  },
  [AI_CHAT_EXTENSION_ID]: {
    titleKey: 'store.bookChat',
    descriptionKey: 'store.bookChatDescription',
    icon: Bot,
  },
}

export function ExtensionStorePage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [state, setState] = useState<ExtensionMarketplaceState>(() => loadExtensionMarketplaceState())
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<StoreFilter>('all')
  const [sourceOpen, setSourceOpen] = useState(false)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const initialCatalogLoadStarted = useRef(false)

  const catalogResult = useMemo(() => parseExtensionMarketplaceCatalog(state), [state])
  const items = useMemo(() => listExtensionMarketplaceItems(state), [state])
  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return items.filter(item => {
      if (filter === 'installed' && !item.installed) return false
      if (filter !== 'all' && filter !== 'installed' && !item.manifest.categories?.includes(filter)) return false
      if (!normalizedQuery) return true
      const searchable = [
        extensionTitle(item, t),
        item.manifest.name,
        item.manifest.description,
        item.manifest.publisher,
        item.manifest.id,
        ...(item.manifest.categories || []),
        ...(item.manifest.keywords || []),
      ].filter(Boolean).join(' ').toLocaleLowerCase()
      return searchable.includes(normalizedQuery)
    })
  }, [filter, items, query, t])
  const installedCount = items.filter(item => item.installed).length

  const commit = (next: ExtensionMarketplaceState, message: string) => {
    try {
      saveExtensionMarketplaceState(next)
      setState(next)
      setError('')
      setNotice(message)
    } catch (reason) {
      setNotice('')
      setError(reason instanceof Error ? reason.message : t('store.saveFailed'))
    }
  }

  const install = (item: RebookExtensionCatalogItem) => {
    if (!canExecuteExtension(item)) {
      setNotice('')
      setError(t('store.notExecutable'))
      return
    }
    const updating = item.installed && item.installation?.version !== item.manifest.version
    if (updating && !window.confirm(t('store.updateConfirm', {
      title: extensionTitle(item, t),
      version: item.manifest.version,
      permissions: formatExtensionPermissions(item, t),
    }))) return
    commit(
      installMarketplaceExtension(state, item.manifest.id),
      t(updating ? 'store.updatedNotice' : 'store.installedNotice', { title: extensionTitle(item, t) }),
    )
  }

  const toggle = (item: RebookExtensionCatalogItem) => {
    const enabled = !item.enabled
    if (enabled && !canExecuteExtension(item)) {
      setNotice('')
      setError(t('store.notExecutable'))
      return
    }
    commit(
      setMarketplaceExtensionEnabled(state, item.manifest.id, enabled),
      t(enabled ? 'store.enabledNotice' : 'store.disabledNotice', { title: extensionTitle(item, t) }),
    )
  }

  const uninstall = (item: RebookExtensionCatalogItem) => {
    const title = extensionTitle(item, t)
    if (!window.confirm(t('store.uninstallConfirm', { title }))) return
    commit(uninstallMarketplaceExtension(state, item.manifest.id), t('store.uninstalledNotice', { title }))
  }

  const loadCatalog = async () => {
    const url = state.extensionCatalogURL.trim()
    if (!url) {
      setError(t('store.enterCatalogUrl'))
      return
    }
    setCatalogLoading(true)
    setError('')
    setNotice('')
    try {
      const text = await fetchExtensionMarketplaceCatalogJSON(url)
      const next = { ...state, extensionCatalogJSON: text }
      const parsed = parseExtensionMarketplaceCatalog(next)
      if (parsed.error) throw new Error(parsed.error)
      commit(next, t('store.catalogUpdated', { count: parsed.entries.length }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('store.catalogLoadFailed'))
    } finally {
      setCatalogLoading(false)
    }
  }

  useEffect(() => {
    if (initialCatalogLoadStarted.current) return
    initialCatalogLoadStarted.current = true
    void loadCatalog()
  }, [])

  useEffect(() => {
    const syncStoredState = () => setState(loadExtensionMarketplaceState())
    window.addEventListener(READER_CONFIG_CHANGED_EVENT, syncStoredState)
    return () => window.removeEventListener(READER_CONFIG_CHANGED_EVENT, syncStoredState)
  }, [])

  return (
    <main className="h-full overflow-y-auto bg-bg text-ink">
      <header className="sticky top-0 z-40 border-b border-line bg-surface/92 px-4 backdrop-blur-xl md:px-7">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3">
          <button className={iconButtonClass} type="button" aria-label={t('common.backToShelf')} onClick={() => navigate('/')}>
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex min-w-0 items-center gap-2">
            <Blocks className="h-4 w-4 text-accent-text" />
            <h1 className="truncate text-ui-lg font-semibold">{t('store.title')}</h1>
          </div>
          <label className="ml-auto hidden h-9 w-full max-w-sm items-center gap-2 rounded-lg border border-line bg-bg px-3 transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-softer sm:flex">
            <Search className="h-4 w-4 shrink-0 text-muted" />
            <input
              className="min-w-0 flex-1 bg-transparent text-ui-md outline-none placeholder:text-muted"
              value={query}
              placeholder={t('store.searchPlaceholder')}
              onChange={event => setQuery(event.target.value)}
            />
            {query ? (
              <button type="button" aria-label={t('common.clearSearch')} className="text-muted hover:text-ink" onClick={() => setQuery('')}>
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </label>
          <button
            className={toolbarButtonClass}
            type="button"
            onClick={() => navigate('/extensions/publish')}
          >
            <PackagePlus className="h-4 w-4" />
            <span className="hidden sm:inline">{t('publisher.publishAction')}</span>
          </button>
          <button
            className={toolbarButtonClass}
            type="button"
            aria-expanded={sourceOpen}
            onClick={() => setSourceOpen(open => !open)}
          >
            <Settings2 className="h-4 w-4" />
            <span className="hidden sm:inline">{t('store.source')}</span>
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
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('store.heroTitle')}</h2>
              <p className="mt-3 max-w-xl text-ui-md leading-6 text-muted">
                {t('store.heroDescription')}
              </p>
              <div className="mt-5 flex flex-wrap gap-2 text-ui-sm text-muted">
                <span className="rounded-full bg-surface-muted px-3 py-1.5">{t('store.availableCount', { count: items.length })}</span>
                <span className="rounded-full bg-accent-soft px-3 py-1.5 text-accent-text">{t('store.installedCount', { count: installedCount })}</span>
              </div>
            </div>
          </div>
        </section>

        <label className="mt-5 flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-3 transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-softer sm:hidden">
          <Search className="h-4 w-4 shrink-0 text-muted" />
          <input
            className="min-w-0 flex-1 bg-transparent text-ui-md outline-none placeholder:text-muted"
            value={query}
            placeholder={t('store.searchPlaceholder')}
            onChange={event => setQuery(event.target.value)}
          />
        </label>

        {sourceOpen ? (
          <section className="mt-5 rounded-xl border border-line bg-surface p-4 shadow-menu sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-ui-lg font-semibold">{t('store.customSource')}</h2>
                <p className="mt-1 text-ui-sm text-muted">{t('store.customSourceDescription')}</p>
              </div>
              <button className={iconButtonClass} type="button" aria-label={t('store.closeSource')} onClick={() => setSourceOpen(false)}>
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
                {catalogLoading ? t('store.loadingCatalog') : t('store.loadCatalog')}
              </button>
            </div>
            <p className={`mt-2 text-ui-sm ${catalogResult.error ? 'text-danger' : 'text-muted'}`}>
              {catalogResult.error || t('store.customCatalogCount', { count: catalogResult.entries.length })}
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
              {t(item.labelKey)}
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
              <h2 className="mt-3 text-ui-lg font-semibold">{t('store.noMatches')}</h2>
              <p className="mt-1 text-ui-md text-muted">{t('store.noMatchesHint')}</p>
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
  const { t } = useI18n()
  const metadata = builtInMetadata[item.manifest.id]
  const Icon = metadata?.icon || extensionIcon(item)
  const title = extensionTitle(item, t)
  const executable = canExecuteExtension(item)
  const sandboxed = item.manifest.runtime?.kind === 'worker' || item.manifest.runtime?.kind === 'iframe'
  const updateAvailable = item.installed && item.source !== 'builtin' && item.installation?.version !== item.manifest.version
  return (
    <article className="group flex min-h-64 flex-col rounded-xl border border-line bg-surface p-5 transition duration-150 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-menu">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-text">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h2 className="truncate text-ui-xl font-semibold">{title}</h2>
            {item.verified ? <BadgeCheck className="h-4 w-4 shrink-0 text-accent-text" aria-label={t('store.verified')} /> : null}
            {sandboxed ? <span className="rounded-full bg-surface-muted px-2 py-0.5 text-ui-xs font-medium text-muted">{t('store.sandboxed')}</span> : null}
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
          {updateAvailable
            ? t('store.updateAvailable')
            : item.enabled
              ? t('store.enabled')
              : item.installed
                ? t('store.disabled')
                : executable ? t('store.available') : t('store.reviewRequired')}
        </span>
      </div>

      <p className="mt-4 line-clamp-3 text-ui-md leading-5 text-muted">
        {metadata ? t(metadata.descriptionKey) : item.manifest.description || t('store.noDescription')}
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {(item.manifest.categories || []).slice(0, 3).map(category => (
          <span key={category} className="rounded-md bg-surface-muted px-2 py-1 text-ui-xs font-medium text-muted">
            {categoryLabel(category, t)}
          </span>
        ))}
        <span className="rounded-md bg-surface-muted px-2 py-1 text-ui-xs font-medium text-muted">
          {item.source === 'builtin' ? t('store.builtIn') : t('store.marketplace')}
        </span>
        <span className="rounded-md bg-surface-muted px-2 py-1 text-ui-xs font-medium text-muted">
          {t('store.permissions', { permissions: formatExtensionPermissions(item, t) })}
        </span>
      </div>

      <div className="mt-auto flex items-center gap-2 pt-5">
        {item.installed ? (
          <>
            {updateAvailable ? (
              <button className={primaryButtonClass} type="button" disabled={!executable} onClick={onInstall}>
                <Package className="h-4 w-4" />
                {t('common.update')}
              </button>
            ) : null}
            <button className={item.enabled ? toolbarButtonClass : primaryButtonClass} type="button" disabled={!item.enabled && !executable} title={!executable ? t('store.notExecutable') : undefined} onClick={onToggle}>
              <Power className="h-4 w-4" />
              {item.enabled ? t('common.disable') : t('common.enable')}
            </button>
            {item.source !== 'builtin' ? (
              <button className={toolbarButtonClass} type="button" onClick={onUninstall}>
                <Trash2 className="h-4 w-4" />
                {t('common.uninstall')}
              </button>
            ) : null}
          </>
        ) : (
          <button className={primaryButtonClass} type="button" disabled={!executable} title={!executable ? t('store.notExecutable') : undefined} onClick={onInstall}>
            {t('common.install')}
          </button>
        )}
        {item.manifest.homepage ? (
          <a
            className={`${iconButtonClass} ml-auto`}
            href={item.manifest.homepage}
            target="_blank"
            rel="noreferrer"
            aria-label={t('store.openHomepage', { title })}
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        ) : null}
      </div>
    </article>
  )
}

function canExecuteExtension(item: RebookExtensionCatalogItem): boolean {
  if (item.source === 'builtin' || item.trust === 'builtin') return true
  if (item.manifest.engines?.hostApi !== String(REBOOK_EXTENSION_HOST_API_VERSION)) return false
  if (!item.artifact) return false
  const runtime = item.manifest.runtime?.kind
  if (runtime === 'worker' || runtime === 'iframe') return true
  return runtime === 'trusted' && item.trust === 'verified' && item.verified === true
}

function extensionTitle(item: RebookExtensionCatalogItem, t: Translate): string {
  const metadata = builtInMetadata[item.manifest.id]
  return (metadata ? t(metadata.titleKey) : '') || item.manifest.displayName || item.manifest.name
}

function extensionIcon(item: RebookExtensionCatalogItem): ExtensionIcon {
  const categories = item.manifest.categories || []
  if (categories.includes('translation')) return Languages
  if (categories.includes('tts')) return AudioLines
  if (categories.includes('ai')) return Bot
  if (categories.includes('reader')) return BookOpen
  return Blocks
}

function formatExtensionPermissions(item: RebookExtensionCatalogItem, t: Translate): string {
  return item.manifest.permissions?.length
    ? item.manifest.permissions.join(', ')
    : t('store.noPermissions')
}

function categoryLabel(category: string, t: Translate): string {
  switch (category) {
    case 'reader': return t('store.reader')
    case 'utility': return t('store.utility')
    case 'translation': return t('store.translation')
    case 'ai': return t('store.ai')
    case 'tts': return t('store.tts')
    default: return category
  }
}
