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
  Blocks,
  Cloud,
  CloudUpload,
  HardDrive,
  Loader2,
  LogIn,
  LogOut,
  Menu,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Trash2,
  UserRound,
} from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { useCloudSync } from '../cloud-sync/CloudSyncContext'
import { useI18n } from '../i18n/LanguageContext'
import { useAppTheme } from '../theme/ThemeContext'
import {
  apiRequest,
  assetUrl,
  type ShelfItem,
  type ShelfList,
} from '../../lib/api'
import {
  importLocalBook,
  getSyncedServerBookIds,
  isLocalBookId,
  listLocalBooks,
  removeLocalBook,
} from '../../lib/local-library'
import { ensureReaderFontsLoaded } from '../../lib/reader-fonts'
import { iconButtonClass, menuRowClass } from '../../lib/ui-classes'
import { READER_CONFIG_CHANGED_EVENT } from '../../lib/preference-events'
import {
  ReaderSettingsDialog,
  loadReaderConfig,
  saveReaderConfig,
  type DemoConfig,
  type SettingsSection,
} from '../reader/ReaderWorkspace'

const SUPPORTED_BOOKS = '.epub,.pdf,.mobi,.azw,.azw3,.fb2,.fbz,.cbz'

export function ShelfPage() {
  const auth = useAuth()
  const cloudSync = useCloudSync()
  const { t } = useI18n()
  const { theme, toggleTheme } = useAppTheme()
  const navigate = useNavigate()
  const fileInput = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [items, setItems] = useState<ShelfItem[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general')
  const [settingsConfig, setSettingsConfig] = useState<DemoConfig>(() => loadReaderConfig())
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [cloudPromptDismissed, setCloudPromptDismissed] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const localItems = await listLocalBooks(query)
      const syncedServerBookIds = await getSyncedServerBookIds()
      let cloudItems: ShelfItem[] = []
      if (auth.user) {
        try {
          const params = new URLSearchParams({ page: '1', pageSize: '100' })
          if (query.trim()) params.set('query', query.trim())
          const cloud = await apiRequest<ShelfList>(`/shelf/items?${params}`)
          cloudItems = cloud.items
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : t('shelf.cloudLoadFailed'))
        }
      }
      setItems([
        ...localItems,
        ...cloudItems.filter(item => !syncedServerBookIds.has(item.id)),
      ])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('shelf.localLoadFailed'))
    } finally {
      setLoading(false)
    }
  }, [auth.user, query, t])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const reload = () => void load()
    window.addEventListener('rebook:local-library-changed', reload)
    window.addEventListener('rebook:cloud-sync-completed', reload)
    return () => {
      window.removeEventListener('rebook:local-library-changed', reload)
      window.removeEventListener('rebook:cloud-sync-completed', reload)
    }
  }, [load])

  useEffect(() => {
    if (!auth.user) {
      setCloudPromptDismissed(false)
      return
    }
    setCloudPromptDismissed(
      localStorage.getItem(cloudPromptKey(auth.user.id)) === 'dismissed',
    )
  }, [auth.user])

  useEffect(() => {
    if (!menuOpen) return
    const closeMenu = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeMenu)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeMenu)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])

  useEffect(() => {
    if (!settingsOpen) return
    void ensureReaderFontsLoaded(settingsConfig)
  }, [
    settingsOpen,
    settingsConfig.defaultFont,
    settingsConfig.defaultCJKFont,
    settingsConfig.serifFont,
    settingsConfig.sansSerifFont,
    settingsConfig.monospaceFont,
  ])

  useEffect(() => {
    const syncStoredConfig = () => {
      if (!settingsOpen) setSettingsConfig(loadReaderConfig())
    }
    window.addEventListener(READER_CONFIG_CHANGED_EVENT, syncStoredConfig)
    return () => window.removeEventListener(READER_CONFIG_CHANGED_EVENT, syncStoredConfig)
  }, [settingsOpen])

  const openSettings = () => {
    setMenuOpen(false)
    setSettingsConfig(loadReaderConfig())
    setSettingsSection('general')
    setSettingsOpen(true)
  }

  const openCloudSettings = () => {
    setMenuOpen(false)
    setSettingsConfig(loadReaderConfig())
    setSettingsSection('cloud')
    setSettingsOpen(true)
  }

  const closeSettings = () => {
    setSettingsOpen(false)
  }

  const applySettings = () => {
    saveReaderConfig(settingsConfig)
    closeSettings()
  }

  const importBooks = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return
    setUploading(true)
    setError('')
    setNotice(t('shelf.importing', { count: files.length }))
    try {
      for (const file of files) await importLocalBook(file)
      await load()
      if (auth.user && !cloudSync.accounts.length) {
        localStorage.removeItem(cloudPromptKey(auth.user.id))
        setCloudPromptDismissed(false)
      }
      setNotice(t(
        cloudSync.accounts.length ? 'shelf.importedSyncing' : 'shelf.imported',
        { count: files.length },
      ))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('shelf.importFailed'))
      setNotice('')
    } finally {
      setUploading(false)
    }
  }

  const removeItem = async (item: ShelfItem) => {
    if (!window.confirm(t('shelf.removeConfirm', { title: item.title }))) return
    try {
      if (isLocalBookId(item.id)) {
        if (item.serverBookId) {
          await apiRequest(`/shelf/items/${item.serverBookId}`, {
            method: 'DELETE',
            json: {},
          })
        }
        await removeLocalBook(item.id)
      } else {
        await apiRequest(`/shelf/items/${item.id}`, {
          method: 'DELETE',
          json: {},
        })
      }
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('shelf.removeFailed'))
    }
  }

  return (
    <main className="h-full overflow-y-auto bg-bg text-ink">
      <input
        ref={fileInput}
        className="hidden"
        type="file"
        accept={SUPPORTED_BOOKS}
        multiple
        onChange={importBooks}
      />

      <header className="sticky top-0 z-40 border-b border-line bg-surface/92 px-3 py-2.5 backdrop-blur-xl md:px-5">
        <div className="flex items-center gap-2.5">
          <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-surface px-3 transition-colors duration-150 focus-within:ring-2 focus-within:ring-accent-softer">
            <Search className="h-4 w-4 shrink-0 text-muted" />
            <input
              className="min-w-0 flex-1 bg-transparent text-ui-md text-ink outline-none placeholder:text-muted"
              placeholder={t('shelf.searchPlaceholder', { count: items.length })}
              value={query}
              onChange={event => setQuery(event.target.value)}
            />
          </label>

          <span className="hidden h-6 w-px bg-line-strong sm:block" />
          <button
            className={iconButtonClass}
            type="button"
            title={t('shelf.importLocal')}
            aria-label={t('shelf.importLocal')}
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          </button>

          <div className="relative" ref={menuRef}>
            <button
              className={`${iconButtonClass} ${menuOpen ? 'bg-accent-soft text-accent-text' : ''}`}
              type="button"
              aria-label={t('shelf.openMenu')}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(open => !open)}
            >
              <Menu className="h-4 w-4" />
            </button>
            {menuOpen ? (
              <div className="absolute right-0 top-12 w-60 rounded-xl border border-line bg-surface-raised p-1.5 shadow-menu animate-pop motion-reduce:animate-none">
                {auth.user ? (
                  <div className="mb-1 flex items-center gap-2.5 border-b border-line px-3 py-2.5">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-muted text-muted">
                      <UserRound className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-ui-md font-medium text-ink">
                        {auth.user.displayName || auth.user.email}
                      </div>
                      <div className="mt-0.5 text-ui-sm text-muted">
                        {cloudSync.accounts.length
                          ? t('shelf.cloudConnected')
                          : t('shelf.accountSignedIn')}
                      </div>
                    </div>
                  </div>
                ) : (
                  <MenuAction
                    icon={<LogIn className="h-4 w-4" />}
                    label={t('common.signIn')}
                    onClick={() => navigate('/login', { state: { from: '/' } })}
                  />
                )}
                <div className="mx-1 my-1 border-t border-line" />
                <MenuAction
                  icon={theme === 'light' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                  label={theme === 'light' ? t('common.lightMode') : t('common.darkMode')}
                  onClick={toggleTheme}
                />
                <div className="mx-1 my-1 border-t border-line" />
                <MenuAction
                  icon={<Blocks className="h-4 w-4" />}
                  label={t('shelf.extensionStore')}
                  onClick={() => navigate('/extensions')}
                />
                <MenuAction
                  icon={<Settings className="h-4 w-4" />}
                  label={t('common.settings')}
                  onClick={openSettings}
                />
                {auth.user ? (
                  <MenuAction
                    icon={<LogOut className="h-4 w-4" />}
                    label={t('common.signOut')}
                    onClick={() => void auth.logout().then(() => setMenuOpen(false))}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="px-3 pb-10 pt-5 md:px-5 md:pt-7">
        {auth.user
          && !cloudSync.loading
          && !cloudSync.error
          && !cloudSync.accounts.length
          && !cloudPromptDismissed ? (
            <CloudDrivePrompt
              localOnlyCount={cloudSync.localOnlyCount}
              onConfigure={openCloudSettings}
              onDismiss={() => {
                localStorage.setItem(cloudPromptKey(auth.user!.id), 'dismissed')
                setCloudPromptDismissed(true)
              }}
            />
          ) : null}
        {notice ? (
          <div className="mb-5 rounded-xl border border-success-line bg-success-soft px-4 py-3 text-ui-md text-success">
            {notice}
          </div>
        ) : null}
        {error ? (
          <div className="mb-5 rounded-xl border border-danger-line bg-danger-soft px-4 py-3 text-ui-md text-danger">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="grid min-h-72 place-items-center text-ui-md text-muted">
            <Loader2 className="h-7 w-7 animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(128px,160px))] gap-x-5 gap-y-7">
            {items.map(item => (
              <BookCard
                key={item.id}
                item={item}
                onOpen={() => navigate(`/reader/${item.id}`)}
                onRemove={() => void removeItem(item)}
              />
            ))}
            {!query ? (
              <button
                className="group min-w-0 text-left"
                type="button"
                onClick={() => fileInput.current?.click()}
              >
                <span className="grid aspect-[2/3] w-full place-items-center rounded-[3px] bg-surface-raised text-muted shadow-menu transition group-hover:-translate-y-1 group-hover:text-ink group-hover:shadow-dialog">
                  <Plus className="h-12 w-12 stroke-[1.2]" />
                </span>
                <span className="mt-3 block text-ui-md font-medium text-muted">{t('shelf.importLocal')}</span>
                <span className="mt-1 block text-ui-sm text-muted">{t('shelf.savedInBrowser')}</span>
              </button>
            ) : null}
          </div>
        )}

        {!loading && query && !items.length ? (
          <div className="py-20 text-center text-ui-md text-muted">{t('shelf.noMatches')}</div>
        ) : null}
      </div>

      {settingsOpen ? (
        <ReaderSettingsDialog
          section={settingsSection}
          setSection={setSettingsSection}
          config={settingsConfig}
          setConfig={setSettingsConfig}
          onClose={closeSettings}
          onApply={applySettings}
        />
      ) : null}
    </main>
  )
}

function BookCard({
  item,
  onOpen,
  onRemove,
}: {
  item: ShelfItem
  onOpen(): void
  onRemove(): void
}) {
  const { t } = useI18n()
  const local = isLocalBookId(item.id)
  const syncState = item.syncState || (local ? 'local' : 'synced')
  const progress = Math.round(item.progress * 100)
  return (
    <article className="group min-w-0">
      <div className="relative">
        <button
          className="relative block aspect-[2/3] w-full overflow-hidden rounded-[3px] bg-surface-raised text-left shadow-menu transition duration-200 group-hover:-translate-y-1 group-hover:shadow-dialog"
          type="button"
          onClick={onOpen}
        >
          {item.coverUrl ? (
            <img
              className="h-full w-full object-contain"
              src={assetUrl(item.coverUrl)}
              alt={t('shelf.coverAlt', { title: item.title })}
            />
          ) : (
            <span
              className="flex h-full flex-col justify-between p-[12%]"
              style={{ background: coverBackground(item.id) }}
            >
              <BookOpen className="h-5 w-5 text-white/55" />
              <span>
                <span className="line-clamp-5 block font-serif text-[clamp(1.05rem,1.5vw,1.45rem)] font-semibold leading-tight text-white drop-shadow-sm">
                  {item.title}
                </span>
                <span className="mt-3 line-clamp-2 block text-ui-sm text-white/70">
                  {item.author || item.sourceType.toUpperCase()}
                </span>
              </span>
            </span>
          )}
          {progress > 0 ? (
            <span className="absolute inset-x-0 bottom-0 h-1 bg-black/25">
              <span className="block h-full bg-accent" style={{ width: `${progress}%` }} />
            </span>
          ) : null}
        </button>
        <button
          className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-ink/65 text-surface opacity-0 backdrop-blur transition-colors duration-150 hover:bg-danger hover:text-accent-contrast group-hover:opacity-100 focus:opacity-100"
          type="button"
          title={t('shelf.remove')}
          aria-label={t('shelf.removeAria', { title: item.title })}
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <button
        className="mt-3 block w-full truncate text-left text-ui-md font-semibold text-ink transition-colors duration-150 hover:text-accent-text"
        type="button"
        onClick={onOpen}
      >
        {item.title}
      </button>
      <div className="mt-1 flex items-center justify-between gap-2 text-ui-sm text-muted">
        <span>{progress}%</span>
        <span className="inline-flex items-center gap-1">
          {syncState === 'syncing' || syncState === 'queued' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : syncState === 'synced' ? (
            <Cloud className="h-3.5 w-3.5" />
          ) : (
            <HardDrive className="h-3.5 w-3.5" />
          )}
          {syncState === 'syncing' || syncState === 'queued'
            ? t('shelf.syncing')
            : syncState === 'failed'
              ? t('shelf.syncFailed')
              : syncState === 'synced'
                ? t('shelf.synced')
                : t('common.local')}
        </span>
      </div>
    </article>
  )
}

function CloudDrivePrompt({
  localOnlyCount,
  onConfigure,
  onDismiss,
}: {
  localOnlyCount: number
  onConfigure(): void
  onDismiss(): void
}) {
  const { t } = useI18n()
  return (
    <section className="mb-5 flex flex-col gap-4 rounded-xl border border-accent/25 bg-accent-soft px-4 py-4 text-accent-text sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface text-accent-text shadow-sm">
          <CloudUpload className="h-4.5 w-4.5" />
        </span>
        <div>
          <h2 className="text-ui-md font-semibold">{t('shelf.configureCloudTitle')}</h2>
          <p className="mt-1 text-ui-sm leading-relaxed text-muted">
            {localOnlyCount
              ? t('shelf.configureCloudLocalBooks', { count: localOnlyCount })
              : t('shelf.configureCloudDescription')}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 pl-12 sm:pl-0">
        <button className="rounded-lg px-3 py-2 text-ui-sm text-muted hover:bg-surface" type="button" onClick={onDismiss}>
          {t('shelf.configureCloudLater')}
        </button>
        <button className="rounded-lg bg-accent px-3 py-2 text-ui-sm font-medium text-accent-contrast hover:opacity-90" type="button" onClick={onConfigure}>
          {t('shelf.configureCloudAction')}
        </button>
      </div>
    </section>
  )
}

function MenuAction({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  onClick(): void
}) {
  return (
    <button
      className={menuRowClass}
      type="button"
      onClick={onClick}
    >
      <span className="text-muted">{icon}</span>
      {label}
    </button>
  )
}

function coverBackground(id: string) {
  const palettes = [
    ['#173f5f', '#20639b'],
    ['#5f2c3e', '#9b4b5f'],
    ['#345b43', '#6b8f71'],
    ['#5a462f', '#9c7a4f'],
    ['#3e355b', '#7567a8'],
    ['#354d52', '#5c7c81'],
  ]
  const index = Array.from(id).reduce((sum, value) => sum + value.charCodeAt(0), 0) % palettes.length
  const [start, end] = palettes[index]
  return `linear-gradient(145deg, ${start}, ${end})`
}

function cloudPromptKey(userId: string) {
  return `rebook-cloud-drive-prompt:${userId}:v1`
}
