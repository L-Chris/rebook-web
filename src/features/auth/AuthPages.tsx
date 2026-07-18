import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { BookOpen, Loader2 } from 'lucide-react'
import { useAuth } from './AuthContext'
import { inputClass, primaryButtonClass } from '../../lib/ui-classes'

export function LoginPage() {
  const auth = useAuth()
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
      setError(reason instanceof Error ? reason.message : '登录失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthCard title="登录 rebook" description="同步你的书架、阅读进度和 WebDAV 文件">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="邮箱" type="email" value={email} onChangeValue={setEmail} autoComplete="email" />
        <Field label="密码" type="password" value={password} onChangeValue={setPassword} autoComplete="current-password" />
        <FormError message={error} />
        <SubmitButton busy={busy}>登录</SubmitButton>
      </form>
      <div className="mt-5 flex items-center justify-between text-ui-md">
        <Link className="text-accent-text transition-colors duration-150 hover:text-accent-hover" to="/register">注册账号</Link>
        <Link className="text-muted transition-colors duration-150 hover:text-ink" to="/forgot-password">忘记密码</Link>
      </div>
      <Link className="mt-6 block text-center text-ui-sm text-muted transition-colors duration-150 hover:text-ink" to="/">
        暂不登录，返回本地书架
      </Link>
    </AuthCard>
  )
}

export function RegisterPage() {
  const auth = useAuth()
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
      setError('两次输入的密码不一致')
      return
    }
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await auth.register({ email, password, displayName })
      setMessage(result.message)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '注册失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthCard title="创建账号" description="邮箱验证后即可使用云书架">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="昵称（可选）" value={displayName} onChangeValue={setDisplayName} autoComplete="nickname" />
        <Field label="邮箱" type="email" value={email} onChangeValue={setEmail} autoComplete="email" />
        <Field label="密码（至少 12 个字符）" type="password" value={password} onChangeValue={setPassword} autoComplete="new-password" />
        <Field label="确认密码" type="password" value={confirmPassword} onChangeValue={setConfirmPassword} autoComplete="new-password" />
        <FormError message={error} />
        {message ? <Notice>{message}</Notice> : null}
        <SubmitButton busy={busy}>注册</SubmitButton>
      </form>
      <p className="mt-5 text-center text-ui-md text-muted">
        已有账号？ <Link className="text-accent-text transition-colors duration-150 hover:text-accent-hover" to="/login">登录</Link>
      </p>
    </AuthCard>
  )
}

export function VerifyEmailPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const started = useRef(false)
  const [status, setStatus] = useState(token ? '正在验证邮箱…' : '验证链接缺少 token')
  const [failed, setFailed] = useState(!token)

  useEffect(() => {
    if (!token || started.current) return
    started.current = true
    auth.verifyEmail(token)
      .then(() => {
        setStatus('邮箱验证成功，正在进入书架…')
        window.setTimeout(() => navigate('/', { replace: true }), 600)
      })
      .catch(reason => {
        setFailed(true)
        setStatus(reason instanceof Error ? reason.message : '邮箱验证失败')
      })
  }, [auth, navigate, token])

  return (
    <AuthCard title="邮箱验证" description={status}>
      {failed ? (
        <Link className={`${primaryButtonClass} h-10 w-full`} to="/login">
          返回登录
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
      setError(reason instanceof Error ? reason.message : '发送失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthCard title="找回密码" description="我们会向已注册邮箱发送重置链接">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="邮箱" type="email" value={email} onChangeValue={setEmail} autoComplete="email" />
        <FormError message={error} />
        {message ? <Notice>{message}</Notice> : null}
        <SubmitButton busy={busy}>发送重置链接</SubmitButton>
      </form>
      <Link className="mt-5 block text-center text-ui-md text-muted transition-colors duration-150 hover:text-ink" to="/login">
        返回登录
      </Link>
    </AuthCard>
  )
}

export function ResetPasswordPage() {
  const auth = useAuth()
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
      setError('重置链接缺少 token')
      return
    }
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致')
      return
    }
    setBusy(true)
    setError('')
    try {
      await auth.resetPassword(token, password)
      navigate('/', { replace: true })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '密码重置失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthCard title="设置新密码" description="新密码至少包含 12 个字符">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="新密码" type="password" value={password} onChangeValue={setPassword} autoComplete="new-password" />
        <Field label="确认新密码" type="password" value={confirmPassword} onChangeValue={setConfirmPassword} autoComplete="new-password" />
        <FormError message={error} />
        <SubmitButton busy={busy}>重置密码</SubmitButton>
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
}: {
  label: string
  value: string
  onChangeValue: (value: string) => void
  type?: string
  autoComplete?: string
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-ui-md font-medium text-ink-soft">{label}</span>
      <input
        className={inputClass}
        type={type}
        value={value}
        autoComplete={autoComplete}
        required={label !== '昵称（可选）'}
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
  return message ? (
    <div className="rounded-xl border border-danger-line bg-danger-soft px-3.5 py-2.5 text-ui-md text-danger">
      {translateError(message)}
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

function translateError(message: string) {
  if (message.includes('email or password')) return '邮箱或密码不正确'
  if (message.includes('verification is required')) return '请先完成邮箱验证'
  if (message.includes('12 to 128')) return '密码长度需要在 12 到 128 个字符之间'
  if (message.includes('too many requests')) return '操作过于频繁，请稍后再试'
  return message
}
