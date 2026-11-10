import { Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { isConfigured } from './lib/config'
import { CreatePage } from './pages/CreatePage'
import { HomePage } from './pages/HomePage'
import { NotFound } from './pages/NotFound'
import { PollPage } from './pages/PollPage'
import { SetupPage } from './pages/SetupPage'

export function App() {
  if (!isConfigured()) {
    return (
      <Layout>
        <SetupPage />
      </Layout>
    )
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/new" element={<CreatePage />} />
        <Route path="/p/:slug" element={<PollPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  )
}
