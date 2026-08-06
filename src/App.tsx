import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { LanguageProvider } from './features/i18n/LanguageContext'
import ReaderWorkspace from './features/reader/ReaderWorkspace'
import { ShelfPage } from './features/shelf/ShelfPage'
import { SyncProvider } from './features/sync/SyncContext'
import { ThemeProvider } from './features/theme/ThemeContext'

export default function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <SyncProvider>
          <Routes>
            <Route path="/" element={<ShelfPage />} />
            <Route path="/reader" element={<Navigate to="/" replace />} />
            <Route path="/reader/:bookId" element={<ShelfReaderPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </SyncProvider>
      </LanguageProvider>
    </ThemeProvider>
  )
}

function ShelfReaderPage() {
  const { bookId = '' } = useParams()
  const navigate = useNavigate()
  return (
    <ReaderWorkspace
      libraryBookId={bookId}
      onExit={() => navigate('/')}
    />
  )
}
