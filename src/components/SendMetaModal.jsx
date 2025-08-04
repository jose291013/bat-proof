import { useEffect, useState } from 'react'

export default function SendMetaModal({ open, onClose, meta, setMeta, pageDims, defaultVersion }) {
  const [versionStr, setVersionStr] = useState('')
  const [sentAtStr, setSentAtStr]   = useState('')
  const [fileName, setFileName]     = useState('')
  const [trimW, setTrimW]           = useState('')
  const [trimH, setTrimH]           = useState('')
  const [comment, setComment]       = useState('')

  // Pré-remplir à l’ouverture
  useEffect(() => {
    if (!open) return
    setVersionStr(String(meta.version ?? defaultVersion ?? 1))
    setSentAtStr((meta.sentAt ? new Date(meta.sentAt) : new Date()).toISOString().slice(0,16))
    setFileName(meta.fileName ?? '')
    // Si pas de Trim dans meta, propose taille page 1 si dispo
    const d1 = pageDims?.[1]
    setTrimW(meta.trimWmm != null ? String(meta.trimWmm) : (d1?.wMm != null ? String(d1.wMm) : ''))
    setTrimH(meta.trimHmm != null ? String(meta.trimHmm) : (d1?.hMm != null ? String(d1.hMm) : ''))
    setComment(meta.comment ?? '')
  }, [open, meta, pageDims, defaultVersion])

  if (!open) return null

  const overlayStyle = {
    position:'fixed', inset:0, background:'rgba(0,0,0,.35)',
    display:'flex', alignItems:'center', justifyContent:'center', zIndex:1100
  }
  const cardStyle = {
    background:'#fff', width:'min(560px, 92vw)', borderRadius:12,
    padding:16, boxShadow:'0 10px 30px rgba(0,0,0,.2)'
  }
  const gridStyle = {
    display:'grid', gridTemplateColumns:'140px 1fr', gap:10, alignItems:'center'
  }

  const save = () => {
    setMeta(m => ({
      ...m,
      version: versionStr === '' ? undefined : Number(versionStr),
      sentAt: new Date(sentAtStr).toISOString(),
      fileName: fileName || undefined,
      trimWmm: trimW === '' ? undefined : Number(trimW),
      trimHmm: trimH === '' ? undefined : Number(trimH),
      comment: comment || undefined,
    }))
    onClose()
    alert('📤 Métadonnées enregistrées (local).')
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={cardStyle} onClick={e=>e.stopPropagation()}>
        <h3 style={{margin:'0 0 12px', fontSize:18, fontWeight:600}}>Préparer l’envoi</h3>

        <div style={gridStyle}>
          <label>Version</label>
          <input className="border rounded px-2 py-1"
                 value={versionStr}
                 onChange={(e)=> setVersionStr(e.target.value)} />

          <label>Date d’envoi</label>
          <input type="datetime-local" className="border rounded px-2 py-1"
                 value={sentAtStr}
                 onChange={(e)=> setSentAtStr(e.target.value)} />

          <label>Nom du fichier</label>
          <input className="border rounded px-2 py-1"
                 value={fileName}
                 onChange={(e)=> setFileName(e.target.value)} />

          <label>Trim largeur (mm)</label>
          <input className="border rounded px-2 py-1"
                 value={trimW}
                 onChange={(e)=> setTrimW(e.target.value)} />

          <label>Trim hauteur (mm)</label>
          <input className="border rounded px-2 py-1"
                 value={trimH}
                 onChange={(e)=> setTrimH(e.target.value)} />

          <label>Commentaire</label>
          <textarea className="border rounded px-2 py-1" rows={3}
                    value={comment}
                    onChange={(e)=> setComment(e.target.value)} />
        </div>

        <div style={{display:'flex', gap:8, justifyContent:'flex-end', marginTop:14}}>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-success" onClick={save}>Enregistrer</button>
        </div>
      </div>
    </div>
  )
}
