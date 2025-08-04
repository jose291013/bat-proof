import { useEffect, useState } from 'react'

const key = (fileId) => `bat-annotations::${fileId}`

export function useAnnotations(fileId) {
  const [data, setData] = useState(() => {
    try {
      const raw = localStorage.getItem(key(fileId))
      if (raw) return JSON.parse(raw)
    } catch {}
    return { fileId, pages: {} } // { [pageNumber]: Annotation[] }
  })

  useEffect(() => {
    localStorage.setItem(key(fileId), JSON.stringify(data))
  }, [fileId, data])

  const add = (page, anno) =>
    setData(d => ({ ...d, pages: { ...d.pages, [page]: [...(d.pages[page]||[]), anno] }}))

  const update = (page, id, patch) =>
    setData(d => ({
      ...d,
      pages: { ...d.pages, [page]: (d.pages[page]||[]).map(a => a.id===id ? {...a, ...patch} : a) }
    }))

  const remove = (page, id) =>
    setData(d => ({ ...d, pages: { ...d.pages, [page]: (d.pages[page]||[]).filter(a => a.id!==id) }}))

  const clear = () => setData({ fileId, pages: {} })

  const exportJSON = () =>
    new Blob([JSON.stringify(data, null, 2)], { type:'application/json' })

  const importJSON = (obj) => {
    if (!obj || obj.fileId !== fileId) throw new Error('Fichier/ID différent')
    setData(obj)
  }

  return { pages: data.pages, add, update, remove, clear, exportJSON, importJSON }
}
