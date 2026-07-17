import { ArrowLeft, Cloud, LogIn, Moon, Sun, UserRound } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useAppTheme } from '../theme/ThemeContext'

export function SettingsPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const { theme, setTheme } = useAppTheme()

  return (
    <main className="h-full overflow-y-auto bg-[var(--library-bg)] text-[var(--library-text)]">
      <header className="sticky top-0 z-30 border-b border-[var(--library-border)] bg-[var(--library-header)] px-4 backdrop-blur-xl md:px-7">
        <div className="mx-auto flex h-16 max-w-4xl items-center gap-3">
          <button
            className="grid h-10 w-10 place-items-center rounded-xl text-[var(--library-muted)] transition hover:bg-[var(--library-hover)] hover:text-[var(--library-text)]"
            type="button"
            aria-label="返回书架"
            onClick={() => navigate('/')}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-semibold">设置</h1>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-4xl gap-6 px-4 py-8 md:px-7 md:py-10">
        <SettingsSection title="外观" description="选择书架与应用菜单的显示主题。">
          <div className="grid gap-3 sm:grid-cols-2">
            <ThemeOption
              active={theme === 'light'}
              icon={<Sun className="h-5 w-5" />}
              label="Light Mode"
              description="明亮、柔和的书架界面"
              onClick={() => setTheme('light')}
            />
            <ThemeOption
              active={theme === 'dark'}
              icon={<Moon className="h-5 w-5" />}
              label="Dark Mode"
              description="适合弱光环境的深色界面"
              onClick={() => setTheme('dark')}
            />
          </div>
        </SettingsSection>

        <SettingsSection title="账号与云端" description="本地书架无需登录；登录后可连接云端书架和 WebDAV。">
          {auth.user ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-center gap-3 rounded-2xl border border-[var(--library-border)] bg-[var(--library-surface)] p-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--library-control)] text-[var(--library-muted)]">
                  <UserRound className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{auth.user.displayName || auth.user.email}</div>
                  <div className="mt-1 text-xs text-[var(--library-muted)]">已登录</div>
                </div>
              </div>
              <button
                className="flex items-center gap-3 rounded-2xl border border-[var(--library-border)] bg-[var(--library-surface)] p-4 text-left transition hover:border-[var(--library-border-strong)] hover:bg-[var(--library-hover)]"
                type="button"
                onClick={() => navigate('/settings/cloud-drives')}
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--library-control)] text-[var(--library-muted)]">
                  <Cloud className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-sm font-semibold">WebDAV</span>
                  <span className="mt-1 block text-xs text-[var(--library-muted)]">管理云端书籍来源</span>
                </span>
              </button>
            </div>
          ) : (
            <button
              className="flex w-full items-center gap-3 rounded-2xl border border-[var(--library-border)] bg-[var(--library-surface)] p-4 text-left transition hover:border-[var(--library-border-strong)] hover:bg-[var(--library-hover)]"
              type="button"
              onClick={() => navigate('/login', { state: { from: '/settings' } })}
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--library-control)] text-[var(--library-muted)]">
                <LogIn className="h-5 w-5" />
              </span>
              <span>
                <span className="block text-sm font-semibold">登录</span>
                <span className="mt-1 block text-xs text-[var(--library-muted)]">同步云端书架和 WebDAV</span>
              </span>
            </button>
          )}
        </SettingsSection>
      </div>
    </main>
  )
}

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-3xl border border-[var(--library-border)] bg-[var(--library-surface)] p-5 shadow-[0_18px_55px_var(--library-shadow)] md:p-6">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1.5 text-sm text-[var(--library-muted)]">{description}</p>
      <div className="mt-5">{children}</div>
    </section>
  )
}

function ThemeOption({
  active,
  icon,
  label,
  description,
  onClick,
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  description: string
  onClick(): void
}) {
  return (
    <button
      className={`flex items-center gap-3 rounded-2xl border p-4 text-left transition ${
        active
          ? 'border-[var(--library-accent)] bg-[var(--library-accent-soft)]'
          : 'border-[var(--library-border)] bg-[var(--library-bg)] hover:border-[var(--library-border-strong)]'
      }`}
      type="button"
      aria-pressed={active}
      onClick={onClick}
    >
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${
        active
          ? 'bg-[var(--library-accent)] text-white'
          : 'bg-[var(--library-control)] text-[var(--library-muted)]'
      }`}>
        {icon}
      </span>
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        <span className="mt-1 block text-xs text-[var(--library-muted)]">{description}</span>
      </span>
    </button>
  )
}
