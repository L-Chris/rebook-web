import { Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { BookOpen, Cloud, LogOut, UserRound } from 'lucide-react'
import { AuthProvider, useAuth } from './features/auth/AuthContext'
import {
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from './features/auth/AuthPages'
import { CloudDrivePage } from './features/cloud-drive/CloudDrivePage'
import ReaderWorkspace from './features/reader/ReaderWorkspace'
import { ShelfPage } from './features/shelf/ShelfPage'

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
        <Route path="/register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/forgot-password" element={<GuestOnly><ForgotPasswordPage /></GuestOnly>} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/reader" element={<LocalReaderPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<LibraryLayout />}>
            <Route path="/shelf" element={<ShelfPage />} />
            <Route path="/settings/cloud-drives" element={<CloudDrivePage />} />
          </Route>
          <Route path="/reader/:bookId" element={<ShelfReaderPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}

function HomeRedirect() {
  const { user, loading } = useAuth()
  if (loading) return <FullPageLoading />
  return <Navigate to={user ? '/shelf' : '/reader'} replace />
}

function ProtectedRoute() {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <FullPageLoading />
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <Outlet />
}

function GuestOnly({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <FullPageLoading />
  return user ? <Navigate to="/shelf" replace /> : children
}

function LibraryLayout() {
  const auth = useAuth()
  const navigate = useNavigate()
  return (
    <div className="h-full overflow-y-auto bg-[linear-gradient(180deg,#f7faf9_0,#eef2f5_42%,#e9eef2_100%)]">
      <header className="sticky top-0 z-40 border-b border-white/70 bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 md:px-7">
          <button className="flex items-center gap-2.5" onClick={() => navigate('/shelf')}>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-teal-700 text-white">
              <BookOpen className="h-5 w-5" />
            </span>
            <span className="text-lg font-semibold tracking-tight text-slate-950">rebook</span>
          </button>
          <nav className="flex items-center gap-1">
            <button className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-950" onClick={() => navigate('/settings/cloud-drives')}>
              <Cloud className="h-4 w-4" />
              <span className="hidden sm:inline">WebDAV</span>
            </button>
            <div className="ml-1 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-2 py-1.5">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-slate-100 text-slate-500">
                <UserRound className="h-4 w-4" />
              </span>
              <div className="hidden max-w-44 sm:block">
                <div className="truncate text-xs font-medium text-slate-800">
                  {auth.user?.displayName || auth.user?.email}
                </div>
              </div>
              <button
                className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
                title="退出登录"
                onClick={() => void auth.logout().then(() => navigate('/login'))}
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </nav>
        </div>
      </header>
      <Outlet />
    </div>
  )
}

function LocalReaderPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  return (
    <ReaderWorkspace
      onExit={() => navigate(user ? '/shelf' : '/login')}
    />
  )
}

function ShelfReaderPage() {
  const { bookId = '' } = useParams()
  const navigate = useNavigate()
  return (
    <ReaderWorkspace
      libraryBookId={bookId}
      onExit={() => navigate('/shelf')}
    />
  )
}

function FullPageLoading() {
  return (
    <div className="grid h-full place-items-center bg-slate-100 text-sm text-slate-500">
      加载中…
    </div>
  )
}
