import { useState } from 'react'
import { hostnameOf, safeHttpUrl } from '../lib/urls'

export function Favicon({ src, pageUrl }: { src: string | null; pageUrl: string | null }) {
  const host = pageUrl ? hostnameOf(pageUrl) : ''
  const google = host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64` : null
  const initial = safeHttpUrl(src) || google
  const [current, setCurrent] = useState(initial)

  if (!current) return <span className="favicon-fallback" aria-hidden="true">链</span>

  return (
    <img
      className="favicon"
      src={current}
      alt=""
      width={28}
      height={28}
      onError={() => {
        if (google && current !== google) setCurrent(google)
        else setCurrent(null)
      }}
    />
  )
}
