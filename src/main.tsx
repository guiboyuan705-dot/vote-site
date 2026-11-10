import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { appBasename } from './lib/urls'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('找不到页面根节点')

createRoot(root).render(
  <StrictMode>
    <BrowserRouter basename={appBasename()}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
