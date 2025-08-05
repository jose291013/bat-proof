import { useEffect, useMemo, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import AnnotationLayer from './components/AnnotationLayer.jsx'
import { useAnnotations } from './hooks/useAnnotations.js'
import { useProofState } from './hooks/useProofState.js'
import { useProofMeta } from './hooks/useProofMeta.js'
import 'react-pdf/dist/Page/TextLayer.css'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import SendMetaModal from './components/SendMetaModal.jsx'

const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:4000'

// Worker ESM depuis /public (évite le bug de worker détruit)
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

// util tailles réelles
const PT_PER_IN = 72
const MM_PER_IN = 25.4
const ptToMm = (pt) => pt * MM_PER_IN / PT_PER_IN

export default function App() {
  // Source PDF
  const [file, setFile] = useState('/monBAT_v1.pdf') // string ou {data:Uint8Array}
  const [fileKey, setFileKey] = useState(0)          // force remount Document
  const [numPages, setNumPages] = useState(null)
  const [scale, setScale] = useState(1.2)
  const [tool, setTool] = useState('select')         // 'select' | 'pin' | 'rect'
  const [urlInput, setUrlInput] = useState('')
  const [sendOpen, setSendOpen] = useState(false)

  // Mode & version depuis l’URL
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const mode = params.get('mode') || 'admin'
  const isClient = mode === 'client'
  const versionFromUrl = Number(params.get('v') || params.get('ver') || 1)
  const proofId = params.get('id') || null

  // Fit-to-width, container, page visible, molette
  const [fit, setFit] = useState(true)
  const cardRef = useRef(null)
  const [containerW, setContainerW] = useState(800)
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setContainerW(Math.max(320, e.contentRect.width - 32)))
    if (cardRef.current) ro.observe(cardRef.current)
    return () => ro.disconnect()
  }, [])
  const [currentPage, setCurrentPage] = useState(1)
  const pageRefs = useRef([])

  // centrer par défaut en fit sur mobile
  useEffect(() => {
    if (window.matchMedia('(max-width: 768px)').matches) setFit(true)
  }, [])

  // menu outils admin (dropdown)
  const [toolsOpen, setToolsOpen] = useState(false)
  const toolsRef = useRef(null)
  useEffect(() => {
    const onDown = (e) => { if (toolsRef.current && !toolsRef.current.contains(e.target)) setToolsOpen(false) }
    const onEsc  = (e) => { if (e.key === 'Escape') setToolsOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onEsc)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onEsc) }
  }, [])

  // observer de page visible (pour pagination)
  useEffect(() => {
    if (!numPages || sendOpen) return
    // cache des ratios visibles par page
  const ratios = {}
  // initialiser à 0
  for (let i = 1; i <= numPages; i++) ratios[i] = 0

  const io = new IntersectionObserver((entries) => {
    if (isProgScroll.current) return  // ← ignore pendant le scroll forcé
   // MAJ du cache pour chaque page concernée par ce batch
    for (const e of entries) {
     const pn = +e.target.dataset.pn
      ratios[pn] = e.isIntersecting ? e.intersectionRatio : 0
   }
    // choisir la page la plus visible (max ratio)
   let bestPn = 1, bestRatio = -1
    for (let i = 1; i <= numPages; i++) {
      const r = ratios[i] ?? 0
      if (r > bestRatio) { bestRatio = r; bestPn = i }
    }
    if (bestPn !== (currentPage || 1)) setCurrentPage(bestPn)
  }, {
    root: null,
    threshold: [0, 0.15, 0.3, 0.5, 0.7, 0.85, 1],
    // décale le viewport logique pour ignorer la barre du haut
    rootMargin: "-64px 0px -64px 0px",
  })
    pageRefs.current.forEach(el => el && io.observe(el))
    return () => io.disconnect()
  // ⚠️ on lit currentPage dans le callback → ajoute-le en dep (ok ici)
}, [numPages, fileKey, sendOpen, currentPage])

  function onWheelZoom(e) {
    if (!e.ctrlKey || fit) return
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.05 : 0.05
    setScale(s => Math.min(3, Math.max(0.5, +(s + delta).toFixed(2))))
  }

  // ID stable pour stockage
  const fileId = useMemo(() => (typeof file === 'string' ? file : `local-${fileKey}`), [file, fileKey])
  const { pages, add, update, remove, clear, exportJSON, importJSON } = useAnnotations(fileId)
  const { locked, approvedAt, approve, unlock } = useProofState(fileId)
  const { meta, setMeta } = useProofMeta(fileId)
  const canAnnotate = !(isClient && locked)

  // dimensions réelles (mm) par page
  const [pageDims, setPageDims] = useState({})
  const dims = pageDims[currentPage] || pageDims[1]
  const trimStr = (meta.trimWmm && meta.trimHmm)
    ? `${meta.trimWmm} × ${meta.trimHmm} mm`
    : (dims ? `${dims.wMm} × ${dims.hMm} mm` : '—')

  const source = useMemo(() => file, [file])

  // chargement doc
  const onDocLoad = ({ numPages }) => {
    setNumPages(numPages)
    setMeta(m => ({ ...m, pages: numPages, version: m.version ?? versionFromUrl }))
  }

  // scroll vers une page
  const isProgScroll = useRef(false)
  function getHeaderOffset() {
   const h = document.querySelector('.appbar')
   return (h?.getBoundingClientRect().height || 0) + 12 // +12px margin
 }
 function scrollToPageEl(el) {
  const sc = cardRef.current
  const offset = getHeaderOffset()
  // Est-ce que la colonne est réellement scrollable ?
  const scrollsInside =
    sc && sc.scrollHeight > sc.clientHeight + 8 &&
    getComputedStyle(sc).overflowY !== 'visible'
    console.log('scrollInside?', scrollsInside)

  if (scrollsInside) {
    // Scroll interne à .doc-col
    const top = el.offsetTop - sc.offsetTop - 12
    sc.scrollTo({ top, behavior: 'smooth' })
  } else {
    // Scroll de la fenêtre
    const top = window.scrollY + el.getBoundingClientRect().top - offset
    window.scrollTo({ top, behavior: 'smooth' })
  }
 }
  const gotoPage = (n) => {
    if (!numPages) return
    const p = Math.max(1, Math.min(numPages, n))
    setCurrentPage(p) // optimiste : l'observer confirmera
    const el = pageRefs.current[p - 1]
   if (el) {
     // optimistic state so the UI updates instantly
     setCurrentPage(p)
     isProgScroll.current = true      // gèle l'IO pendant le scroll
  scrollToPageEl(el)
  setTimeout(() => { isProgScroll.current = false }, 600)
   }
  }

  // pagination clavier
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') gotoPage((currentPage || 1) - 1)
      if (e.key === 'ArrowRight') gotoPage((currentPage || 1) + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [currentPage, numPages])

  // Charger BAT depuis l’API si ?id=...
  useEffect(() => {
    if (!proofId) return
    (async () => {
      const res = await fetch(`${API}/api/proofs/${proofId}`)
      if (!res.ok) { console.error('Proof introuvable'); return }
      const { fileUrl, meta: m, locked: lk /*, approvedAt: ap*/ } = await res.json()
      setFile(fileUrl); setFileKey(k => k + 1); setNumPages(null)
      setMeta(m2 => ({ ...m2, ...m }))
      if (lk) {
        // Si ton hook expose un setter, utilise-le. Sinon, on peut appeler approve() pour verrouiller visuellement.
        approve()
      }
    })()
  }, [proofId])

  // Charger les annotations existantes (option simple)
  useEffect(() => {
    if (!proofId || !numPages) return
    ;(async () => {
      for (let p = 1; p <= numPages; p++) {
        try {
          const r = await fetch(`${API}/api/proofs/${proofId}/annos/${p}`)
          if (!r.ok) continue
          const { annos } = await r.json()
          if (Array.isArray(annos) && annos.length && (!pages[p] || pages[p].length === 0)) {
            annos.forEach(a => add(p, a))
          }
        } catch {}
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proofId, numPages, fileKey])

  // sauvegarder la page p vers l’API
  async function savePageToAPI(p) {
    if (!proofId) return
    const annos = pages[p] || []
    await fetch(`${API}/api/proofs/${proofId}/annos/${p}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ annos })
    }).catch(console.error)
  }

  // approuver côté serveur si id, sinon local
  async function handleApprove() {
    if (proofId) {
      const r = await fetch(`${API}/api/proofs/${proofId}/approve`, { method: 'POST' })
      if (r.ok) {
        // const { approvedAt } = await r.json()
        approve()
        alert('✅ BAT approuvé (serveur & UI).')
      } else {
        alert('Erreur lors de l’approbation serveur.')
      }
    } else {
      approve()
      alert('✅ BAT approuvé (local).')
    }
  }

  // Actions client (placeholder)
  function handleRequestChanges() {
    const note = prompt('Que souhaitez-vous modifier ?') || ''
    if (!note) return
    alert('📝 Demande enregistrée (démo) : ' + note)
  }

  return (
    <>
      {/* HEADER */}
      <header className="appbar">
        <div className="appbar-inner">
          <div className="appbar-spacer" aria-hidden />

          {/* Gauche : titre */}
          <div className="appbar-left">
            <strong>BAT Viewer</strong>
          </div>

          {/* Centre : barre segmentée (client & admin) */}
          <div className="appbar-center">
            <div className="segbar">
              <div className="seg" aria-label="Annotations">
                <span className="seg-title">Annotations</span>
                <button className={`btn-mode ${tool==='select'?'is-active':''}`} onClick={()=>setTool('select')}>Sélection</button>
                <button className={`btn-mode ${tool==='pin'?'is-active':''}`} onClick={()=>setTool('pin')}>Épingle</button>
                <button className={`btn-mode ${tool==='rect'?'is-active':''}`} onClick={()=>setTool('rect')}>Rectangle</button>
              </div>

              <div className="seg" aria-label="Zoom">
                <span className="seg-title">Zoom</span>
                <button className="btn" onClick={()=> setScale(s => Math.max(0.5, +(s-0.1).toFixed(2)))}>–</button>
                <span>{Math.round(scale*100)}%</span>
                <button className="btn" onClick={()=> setScale(s => Math.min(3, +(s+0.1).toFixed(2)))}>+</button>
              </div>

              <div className="seg" aria-label="Affichage">
                <span className="seg-title">Affichage</span>
                <button className={`btn ${fit ? 'btn-success' : ''}`} onClick={()=> setFit(true)}>Ajuster</button>
                <button className={`btn ${!fit ? 'btn-success' : ''}`} onClick={()=> setFit(false)}>Taille libre</button>
              </div>

              <div className="seg" aria-label="Pagination">
                <span className="seg-title">Page</span>
                <button className="btn" onClick={()=> gotoPage((currentPage||1)-1)} disabled={!numPages || currentPage<=1}>‹</button>
                <span className="badge">{currentPage || '—'}/{numPages || '—'}</span>
                <button className="btn" onClick={()=> gotoPage((currentPage||1)+1)} disabled={!numPages || currentPage>=numPages}>›</button>
              </div>
            </div>
          </div>

          {/* Droite (ligne 2) : outils admin */}
          {!isClient && (
            <div className="appbar-right">
              {locked
                ? (<><span className="badge badge-success">Approuvé ✓</span><button className="btn" onClick={unlock}>Déverrouiller</button></>)
                : <span className="badge">Brouillon</span>}

              <div className="menu" ref={toolsRef}>
                <button className="menu-btn" onClick={()=> setToolsOpen(o=>!o)}>⋯ Outils</button>

                {toolsOpen && (
                  <div className="menu-panel">
                    <button className="menu-item" onClick={()=>{ setSendOpen(true); setToolsOpen(false); }}>
                      Préparer l’envoi
                    </button>

                    <button className="menu-item" onClick={async ()=>{
                      let fileUrl = typeof file === 'string' ? file : null
                      if (!fileUrl) {
                        alert("Le PDF actuel n'a pas d'URL publique. Place-le dans /public ou active l’upload serveur.")
                        return
                      }
                      const res = await fetch(`${API}/api/proofs`, {
                        method:'POST',
                        headers:{'Content-Type':'application/json'},
                        body: JSON.stringify({ fileUrl, meta })
                      })
                      if (!res.ok) { alert('Erreur création lien'); return }
                      const data = await res.json()
                      await navigator.clipboard?.writeText(data.clientUrl).catch(()=>{})
                      alert(`Lien client copié : ${data.clientUrl}`)
                      setToolsOpen(false)
                    }}>
                      Créer le lien client
                    </button>

                    <label className="menu-item">
  Importer PDF
  <input type="file" accept="application/pdf" className="hidden"
    onChange={async (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      // 1) upload
      const fd = new FormData();
      fd.append('file', f);
      const resp = await fetch(`${API}/api/upload`, { method:'POST', body: fd });
      if (!resp.ok) { alert('Upload échoué'); return; }
      const { url, fileName, size } = await resp.json();

      // 2) utiliser l’URL publique renvoyée
      setFile(url);
      setNumPages(null); setFileKey(k => k + 1);
      setMeta(m => ({ ...m, fileName: fileName || f.name, fileSize: size || f.size }));
      setToolsOpen(false);
    }} />
</label>


                    <div className="menu-sep" />

                    <div className="menu-row">
                      <input type="text" placeholder="https://…/monBAT_v1.pdf"
                             value={urlInput} onChange={e=>setUrlInput(e.target.value)} />
                      <button className="btn" onClick={()=> {
                        if (!urlInput) return
                        setFile(urlInput); setNumPages(null); setFileKey(k=>k+1)
                        try {
                          const u = new URL(urlInput)
                          const guess = decodeURIComponent(u.pathname.split('/').pop()||'document.pdf')
                          setMeta(m=>({ ...m, fileName: guess, fileSize: undefined }))
                        } catch {}
                        setToolsOpen(false)
                      }}>Ouvrir</button>
                    </div>

                    <div className="menu-sep" />

                    <button className="menu-item" onClick={()=> {
                      const blob = exportJSON()
                      const a = document.createElement('a')
                      a.href = URL.createObjectURL(blob)
                      a.download = `${fileId.replace(/[^\w.-]/g,'_')}.annotations.json`
                      a.click(); URL.revokeObjectURL(a.href)
                      setToolsOpen(false)
                    }}>Export JSON</button>

                    <label className="menu-item">
                      Import JSON
                      <input type="file" accept="application/json" className="hidden"
                        onChange={async (e)=> {
                          const f = e.target.files?.[0]; if(!f) return
                          try { importJSON(JSON.parse(await f.text())) } catch(err){ alert(err.message) }
                          setToolsOpen(false)
                        }} />
                    </label>

                    <div className="menu-sep" />

                    <button className="menu-item danger" onClick={()=> {
                      if (confirm('Effacer toutes les annotations ?')) clear()
                      setToolsOpen(false)
                    }}>Effacer les annotations</button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </header>

      {/* MAIN */}
      <main className="viewer-wrap">
        <div className="viewer-grid">
          {/* ===== Colonne gauche : Infos ===== */}
          <aside className="info-panel">
            <div className="info-title">Infos du BAT</div>
            <table className="info-table">
              <tbody>
                <tr><th>Version</th><td>V{meta.version ?? versionFromUrl}</td></tr>
                <tr><th>Pages</th><td>{meta.pages ?? (numPages || '—')}</td></tr>
                <tr><th>Trim</th><td>{trimStr}</td></tr>
                <tr><th>Envoyé</th><td>{meta.sentAt ? new Date(meta.sentAt).toLocaleString() : '—'}</td></tr>
                <tr><th>Fichier</th><td>{meta.fileName || '—'}</td></tr>
                {meta.comment ? (<tr><th>Commentaire</th><td>{meta.comment}</td></tr>) : null}
              </tbody>
            </table>
          </aside>

          {/* ===== Colonne droite : Document + actions ===== */}
          <section className="doc-col" ref={cardRef} onWheel={onWheelZoom}>
            {/* Actions (haut) — côté client */}
            {isClient && (
              <div className="actions-bar">
                <button className="btn btn-outline" onClick={handleRequestChanges} disabled={locked}>
                  Demander des modifications
                </button>
                <button className={`btn ${locked ? 'btn-disabled' : 'btn-success'}`}
                        onClick={handleApprove}
                        disabled={locked}>
                  {locked ? 'Approuvé ✓' : 'Approuver'}
                </button>
              </div>
            )}

            {/* Document */}
            <Document
              key={fileKey}
              file={source}
              onLoadSuccess={onDocLoad}
              onLoadError={(err) => console.error('Erreur chargement PDF', err)}
            >
              {Array.from(new Array(numPages || 0), (_, index) => {
                const pn = index + 1
                return (
                  <div key={`p_${pn}`} className="page-wrap" data-pn={pn} ref={(el)=> (pageRefs.current[index]=el)}>
                    <div className="page-box">
                      <Page
                        pageNumber={pn}
                        {...(fit ? { width: Math.floor(containerW) } : { scale })}
                        renderTextLayer={false}
                        renderAnnotationLayer={true}
                        onLoadSuccess={(page) => {
                          const [x0, y0, x1, y1] = page.view
                          const wPt = x1 - x0, hPt = y1 - y0
                          const wMm = +ptToMm(wPt).toFixed(1), hMm = +ptToMm(hPt).toFixed(1)
                          setPageDims(d => ({ ...d, [page.pageNumber]: { wMm, hMm } }))
                        }}
                      />
                      <AnnotationLayer
                        pageNumber={pn}
                        tool={tool}
                        annos={pages[pn] || []}
                        onAdd={(p, a) => { add(p, a); savePageToAPI(p) }}
                        onUpdate={(p, id, patch) => { update(p, id, patch); savePageToAPI(p) }}
                        onRemove={(p, id) => { remove(p, id); savePageToAPI(p) }}
                        readOnly={!canAnnotate}
                      />
                    </div>
                  </div>
                )
              })}
            </Document>

            {/* Actions (bas) — côté client */}
            {isClient && (
              <div className="actions-bar">
                <button className="btn btn-outline" onClick={handleRequestChanges} disabled={locked}>
                  Demander des modifications
                </button>
                <button className={`btn ${locked ? 'btn-disabled' : 'btn-success'}`}
                        onClick={handleApprove}
                        disabled={locked}>
                  {locked ? 'Approuvé ✓' : 'Approuver'}
                </button>
              </div>
            )}
          </section>
        </div>
      </main>

      {/* Overlay “Préparer l’envoi” (ADMIN) */}
      <SendMetaModal
        open={!isClient && sendOpen}
        onClose={() => setSendOpen(false)}
        meta={meta}
        setMeta={setMeta}
        pageDims={pageDims}
        defaultVersion={versionFromUrl}
      />
    </>
  )
}





