import { useRef, useState } from 'react'

// tool: 'select' | 'pin' | 'rect'
export default function AnnotationLayer({
  pageNumber, tool, annos = [],
  onAdd, onUpdate, onRemove,
  readOnly = false
}) {
  const ref = useRef(null)

  // états interaction
  const [drawing, setDrawing] = useState(null)        // {x0,y0,x1,y1}
  const [drag, setDrag] = useState(null)              // {id,type,startMouse:{x,y},startAnno:{x,y,w,h}}
  const [downPt, setDownPt] = useState(null)          // clic vs drag
  const [suppressClick, setSuppressClick] = useState(false)

  // auto-scroll pendant drag
  const pointerY = useRef(0)
  const rafId = useRef(null)
  const startAutoScroll = () => {
    if (rafId.current) return
    const step = () => {
      if (!drag && !drawing) { rafId.current = null; return }
      const layer = ref.current
      const scroller = layer?.closest('.viewer-card') // conteneur scrollable
      if (scroller) {
        const r = scroller.getBoundingClientRect()
        const EDGE = 36, SPEED = 18
        let dy = 0
        if (pointerY.current < r.top + EDGE) dy = -SPEED
        else if (pointerY.current > r.bottom - EDGE) dy = SPEED
        if (dy) scroller.scrollTop += dy
      }
      rafId.current = requestAnimationFrame(step)
    }
    rafId.current = requestAnimationFrame(step)
  }
  const stopAutoScroll = () => {
    if (rafId.current) cancelAnimationFrame(rafId.current)
    rafId.current = null
  }

  const clamp = (v, min, max) => Math.min(Math.max(v, min), max)
  const norm = (evt) => {
    const r = ref.current.getBoundingClientRect()
    const x = (evt.clientX - r.left) / r.width
    const y = (evt.clientY - r.top) / r.height
    return { x: clamp(x, 0, 1), y: clamp(y, 0, 1) }
  }

  /* ---------- Création ---------- */
  const handleClick = (e) => {
    if (readOnly || tool !== 'pin') return
    if (suppressClick) { setSuppressClick(false); return }
    if (e.target !== ref.current) return // uniquement fond
    const { x, y } = norm(e)
    const text = window.prompt('Commentaire :') || ''
    onAdd(pageNumber, { id: crypto.randomUUID(), type: 'pin', x, y, text, createdAt: Date.now() })
  }

  /* ---------- Pointer events sur le calque ---------- */
  const onLayerPointerDown = (e) => {
    ref.current.setPointerCapture(e.pointerId)
    const { x, y } = norm(e)
    setDownPt({ x, y })

    if (!readOnly && tool === 'rect') {
      setDrawing({ x0: x, y0: y, x1: x, y1: y })
      startAutoScroll()
    }
  }

  const onLayerPointerMove = (e) => {
    pointerY.current = e.clientY
    if (downPt) {
      const { x, y } = norm(e)
      if (Math.abs(x - downPt.x) > 0.004 || Math.abs(y - downPt.y) > 0.004) setSuppressClick(true)
    }
    if (drawing) {
      const { x, y } = norm(e)
      setDrawing(d => ({ ...d, x1: x, y1: y }))
    } else if (drag && !readOnly) {
      e.preventDefault() // fluidité
      const { x, y } = norm(e)
      const dx = x - drag.startMouse.x
      const dy = y - drag.startMouse.y
      if (drag.type === 'pin') {
        onUpdate(pageNumber, drag.id, {
          x: clamp(drag.startAnno.x + dx, 0, 1),
          y: clamp(drag.startAnno.y + dy, 0, 1)
        })
      } else {
        const w = drag.startAnno.w || 0, h = drag.startAnno.h || 0
        onUpdate(pageNumber, drag.id, {
          x: clamp(drag.startAnno.x + dx, 0, 1 - w),
          y: clamp(drag.startAnno.y + dy, 0, 1 - h)
        })
      }
      startAutoScroll()
    }
  }

  const onLayerPointerUp = (e) => {
    try { ref.current.releasePointerCapture(e.pointerId) } catch {}
    setDownPt(null)
    stopAutoScroll()

    if (drawing) {
      const { x0, y0, x1, y1 } = drawing
      const x = Math.min(x0, x1), y = Math.min(y0, y1)
      const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0)
      const text = window.prompt('Note :') || ''
      onAdd(pageNumber, { id: crypto.randomUUID(), type: 'rect', x, y, w, h, text, createdAt: Date.now() })
      setDrawing(null)
    }
    setDrag(null)
  }

  /* ---------- Drag sur éléments existants (outil quelconque) ---------- */
  const startDragPin  = (e, a) => {
    if (readOnly) return
    e.preventDefault(); e.stopPropagation()
    ref.current.setPointerCapture(e.pointerId)
    const p = norm(e)
    setSuppressClick(true)
    setDrag({ id: a.id, type: 'pin', startMouse: p, startAnno: { x: a.x, y: a.y } })
    startAutoScroll()
  }
  const startDragRect = (e, a) => {
    if (readOnly) return
    e.preventDefault(); e.stopPropagation()
    ref.current.setPointerCapture(e.pointerId)
    const p = norm(e)
    setSuppressClick(true)
    setDrag({ id: a.id, type: 'rect', startMouse: p, startAnno: { x: a.x, y: a.y, w: a.w || 0, h: a.h || 0 } })
    startAutoScroll()
  }

  return (
    <div
      ref={ref}
      className="anno-layer"
      onClick={handleClick}
      onPointerDown={onLayerPointerDown}
      onPointerMove={onLayerPointerMove}
      onPointerUp={onLayerPointerUp}
    >
      {/* Rectangles */}
      {annos.filter(a => a.type === 'rect').map(a => (
        <div
          key={a.id}
          className="anno-rect"
          style={{ left:`${a.x*100}%`, top:`${a.y*100}%`, width:`${(a.w||0)*100}%`, height:`${(a.h||0)*100}%` }}
          title={a.text}
          onPointerDown={(e) => startDragRect(e, a)}
          onDoubleClick={() => { if (readOnly) return; const nv = prompt('Modifier la note :', a.text); if (nv !== null) onUpdate(pageNumber, a.id, { text: nv }) }}
          onContextMenu={(e) => { if (readOnly) return; e.preventDefault(); if (confirm('Supprimer ?')) onRemove(pageNumber, a.id) }}
        >
          <span className="anno-label">Note</span>
        </div>
      ))}

      {/* Épingles */}
      {annos.filter(a => a.type === 'pin').map(a => (
        <div
          key={a.id}
          className="anno-pin"
          style={{ left:`${a.x*100}%`, top:`${a.y*100}%` }}
          title={a.text}
          onPointerDown={(e) => startDragPin(e, a)}
          onDoubleClick={() => { if (readOnly) return; const nv = prompt('Modifier :', a.text); if (nv !== null) onUpdate(pageNumber, a.id, { text: nv }) }}
          onContextMenu={(e) => { if (readOnly) return; e.preventDefault(); if (confirm('Supprimer ?')) onRemove(pageNumber, a.id) }}
        >●</div>
      ))}

      {/* Fantôme rect en cours */}
      {drawing && (
        <div className="anno-rect ghost" style={{
          left:`${Math.min(drawing.x0,drawing.x1)*100}%`,
          top:`${Math.min(drawing.y0,drawing.y1)*100}%`,
          width:`${Math.abs(drawing.x1-drawing.x0)*100}%`,
          height:`${Math.abs(drawing.y1-drawing.y0)*100}%`,
        }}/>
      )}
    </div>
  )
}




