import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { BookOpen, Loader2 } from 'lucide-react'
import { useAuth } from './AuthContext'
import { useI18n, type Translate } from '../i18n/LanguageContext'
import { inputClass, primaryButtonClass } from '../../lib/ui-classes'

export function LoginPage() {
  const auth = useAuth()
  const { t } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await auth.login(email, password)
      const target = (location.state as { from?: string } | null)?.from || '/'
      navigate(target, { replace: true })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('auth.loginFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthCard title={t('auth.loginTitle')} description={t('auth.loginDescription')}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label={t('auth.email')} type="email" value={email} onChangeValue={setEmail} autoComplete="email" />
        <Field label={t('auth.password')} type="password" value={password} onChangeValue={setPassword} autoComplete="current-password" />
        <FormError message={error} />
        <SubmitButton busy={busy}>{t('common.signIn')}</SubmitButton>
      </form>
      <div className="mt-5 flex items-center justify-between text-ui-md">
        <Link className="text-accent-text transition-colors duration-150 hover:text-accent-hover" to="/register">{t('auth.registerAccount')}</Link>
        <Link className="text-muted transition-colors duration-150 hover:text-ink" to="/forgot-password">{t('auth.forgotPassword')}</Link>
      </div>
      <Link className="mt-6 block text-center text-ui-sm text-muted transition-colors duration-150 hover:text-ink" to="/">
        {t('auth.continueOffline')}
      </Link>
    </AuthCard>
  )
}

export function RegisterPage() {
  const auth = useAuth()
  const { t } = useI18n()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (password !== confirmPassword) {
      setError(t('auth.passwordMismatch'))
      return
    }
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await auth.register({ email, password, displayName })
      setMessage(result.message)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('auth.registerFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthCard title={t('auth.createAccount')} description={t('auth.createAccountDescription')}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label={t('auth.displayNameOptional')} value={displayName} onChangeValue={setDisplayName} autoComplete="nickname" required={false} />
        <Field label={t('auth.email')} type="email" value={email} onChangeValue={setEmail} autoComplete="email" />
        <Field label={t('auth.passwordRequirement')} type="password" value={password} onChangeValue={setPassword} autoComplete="new-password" />
        <Field label={t('auth.confirmPassword')} type="password" value={confirmPassword} onChangeValue={setConfirmPassword} autoComplete="new-password" />
        <FormError message={error} />
        {message ? <Notice>{message}</Notice> : null}
        <SubmitButton busy={busy}>{t('auth.register')}</SubmitButton>
      </form>
      <p className="mt-5 text-center text-ui-md text-muted">
        {t('auth.alreadyHaveAccount')} <Link className="text-accent-text transition-colors duration-150 hover:text-accent-hover" to="/login">{t('common.signIn')}</Link>
      </p>
    </AuthCard>
  )
}

export function VerifyEmailPage() {
  const auth = useAuth()
  const { t } = useI18n()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const started = useRef(false)
  const [status, setStatus] = useState(token ? t('auth.verifying') : t('auth.missingVerifyToken'))
  const [failed, setFailed] = useState(!token)

  useEffect(() => {
    if (!token || started.current) return
    started.current = true
    auth.verifyEmail(token)
      .then(() => {
        setStatus(t('auth.verifiedRedirecting'))
        window.setTimeout(() => navigate('/', { replace: true }), 600)
      })
      .catch(reason => {
        setFailed(true)
        setStatus(reason instanceof Error ? reason.message : t('auth.verifyFailed'))
      })
  }, [auth, navigate, t, token])

  return (
    <AuthCard title={t('auth.verifyTitle')} description={status}>
      {failed ? (
        <Link className={`${primaryButtonClass} h-10 w-full`} to="/login">
          {t('auth.backToLogin')}
        </Link>
      ) : (
        <div className="flex justify-center py-8 text-accent-text">
          <Loader2 className="h-7 w-7 animate-spin" />
        </div>
      )}
    </AuthCard>
  )
}

export function ForgotPasswordPage() {
  const auth = useAuth()
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await auth.requestPasswordReset(email)
      setMessage(result.message)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('auth.sendFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthCard title={t('auth.forgotTitle')} description={t('auth.forgotDescription')}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label={t('auth.email')} type="email" value={email} onChangeValue={setEmail} autoComplete="email" />
        <FormError message={error} />
        {message ? <Notice>{message}</Notice> : null}
        <SubmitButton busy={busy}>{t('auth.sendResetLink')}</SubmitButton>
      </form>
      <Link className="mt-5 block text-center text-ui-md text-muted transition-colors duration-150 hover:text-ink" to="/login">
        {t('auth.backToLogin')}
      </Link>
    </AuthCard>
  )
}

export function ResetPasswordPage() {
  const auth = useAuth()
  const { t } = useI18n()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!token) {
      setError(t('auth.missingResetToken'))
      return
    }
    if (password !== confirmPassword) {
      setError(t('auth.passwordMismatch'))
      return
    }
    setBusy(true)
    setError('')
    try {
      await auth.resetPassword(token, password)
      navigate('/', { replace: true })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('auth.resetFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthCard title={t('auth.newPasswordTitle')} description={t('auth.newPasswordDescription')}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label={t('auth.newPassword')} type="password" value={password} onChangeValue={setPassword} autoComplete="new-password" />
        <Field label={t('auth.confirmNewPassword')} type="password" value={confirmPassword} onChangeValue={setConfirmPassword} autoComplete="new-password" />
        <FormError message={error} />
        <SubmitButton busy={busy}>{t('auth.resetPassword')}</SubmitButton>
      </form>
    </AuthCard>
  )
}

function AuthCard({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <main className="flex min-h-full items-center justify-center overflow-y-auto bg-bg px-4 py-10">
      <section className="w-full max-w-md rounded-2xl border border-line bg-surface-raised p-7 shadow-dialog md:p-9">
        <div className="mb-7 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-accent text-accent-contrast shadow-menu">
            <BookOpen className="h-6 w-6" />
          </span>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink">{title}</h1>
          <p className="mt-2 text-ui-md text-muted">{description}</p>
        </div>
        {children}
      </section>
    </main>
  )
}

function Field({
  label,
  value,
  onChangeValue,
  type = 'text',
  autoComplete,
  required = true,
}: {
  label: string
  value: string
  onChangeValue: (value: string) => void
  type?: string
  autoComplete?: string
  required?: boolean
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-ui-md font-medium text-ink-soft">{label}</span>
      <input
        className={inputClass}
        type={type}
        value={value}
        autoComplete={autoComplete}
        required={required}
        onChange={event => onChangeValue(event.target.value)}
      />
    </label>
  )
}

function SubmitButton({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button
      className={`${primaryButtonClass} h-10 w-full`}
      disabled={busy}
      type="submit"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
  )
}

function FormError({ message }: { message: string }) {
  const { t } = useI18n()
  return message ? (
    <div className="rounded-xl border border-danger-line bg-danger-soft px-3.5 py-2.5 text-ui-md text-danger">
      {translateError(message, t)}
    </div>
  ) : null
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-success-line bg-success-soft px-3.5 py-2.5 text-ui-md text-success">
      {children}
    </div>
  )
}

function translateError(message: string, t: Translate) {
  if (message.includes('email or password')) return t('auth.invalidCredentials')
  if (message.includes('verification is required')) return t('auth.verificationRequired')
  if (message.includes('12 to 128')) return t('auth.passwordLength')
  if (message.includes('too many requests')) return t('auth.tooManyRequests')
  return message
}
