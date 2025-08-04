import { useEffect, useState } from 'react'
const key = (fileId) => `bat-meta::${fileId}`

export function useProofMeta(fileId) {
  const [meta, setMeta] = useState(() => {
    try { return JSON.parse(localStorage.getItem(key(fileId)) || 'null') || {} }
    catch { return {} }
  })
  useEffect(() => { localStorage.setItem(key(fileId), JSON.stringify(meta)) }, [fileId, meta])
  return { meta, setMeta }
}
