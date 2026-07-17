import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { BookOpen, Loader2 } from 'lucide-react'
import { useAuth } from './AuthContext'

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
      <div className="mt-5 flex items-center justify-between text-sm">
        <Link className="text-teal-700 hover:text-teal-900" to="/register">注册账号</Link>
        <Link className="text-slate-500 hover:text-slate-800" to="/forgot-password">忘记密码</Link>
      </div>
      <Link className="mt-6 block text-center text-xs text-slate-400 hover:text-slate-700" to="/">
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
      <p className="mt-5 text-center text-sm text-slate-500">
        已有账号？ <Link className="text-teal-700 hover:text-teal-900" to="/login">登录</Link>
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
        <Link className="block rounded-xl bg-slate-900 px-4 py-3 text-center text-sm font-semibold text-white" to="/login">
          返回登录
        </Link>
      ) : (
        <div className="flex justify-center py-8 text-teal-700">
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
      <Link className="mt-5 block text-center text-sm text-slate-500 hover:text-slate-800" to="/login">
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
    <main className="flex min-h-full items-center justify-center overflow-y-auto bg-[radial-gradient(circle_at_top,#dff6f1_0,#eef2f5_42%,#e8edf2_100%)] px-4 py-10">
      <section className="w-full max-w-md rounded-[2rem] border border-white/80 bg-white/90 p-7 shadow-[0_30px_90px_rgba(15,23,42,.14)] backdrop-blur md:p-9">
        <div className="mb-7 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-teal-700 text-white shadow-lg shadow-teal-700/20">
            <BookOpen className="h-6 w-6" />
          </span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-950">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
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
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        className="h-11 rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
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
      className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:opacity-60"
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
    <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
      {translateError(message)}
    </div>
  ) : null
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-teal-200 bg-teal-50 px-3.5 py-2.5 text-sm leading-6 text-teal-800">
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
