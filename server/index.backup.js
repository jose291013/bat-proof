import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import Database from 'better-sqlite3'
import { nanoid } from 'nanoid'

const app = express()
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://127.0.0.1:5173', credentials: false }))
// Logger minimal (à placer AVANT les routes)
app.use((req, res, next) => {
  console.log(new Date().toISOString(), req.method, req.url);
  next();
});

app.use(express.json({ limit: '10mb' }))

// --- DB ---
const db = new Database('./db.sqlite')
db.exec(`
CREATE TABLE IF NOT EXISTS proofs (
  id TEXT PRIMARY KEY,
  file_url TEXT NOT NULL,
  meta_json TEXT NOT NULL,
  locked INTEGER DEFAULT 0,
  approved_at TEXT
);
CREATE TABLE IF NOT EXISTS annotations (
  proof_id TEXT NOT NULL,
  page INTEGER NOT NULL,
  data_json TEXT NOT NULL,
  PRIMARY KEY (proof_id, page)
);
`)

// --- API ---
app.get('/health', (_req, res) => res.json({ ok: true }))

// Créer un BAT
app.post('/api/proofs', (req, res) => {
  const { fileUrl, meta } = req.body
  if (!fileUrl) return res.status(400).json({ error: 'fileUrl requis' })
  const id = nanoid(10)
  db.prepare(`INSERT INTO proofs(id,file_url,meta_json) VALUES (?,?,?)`)
    .run(id, fileUrl, JSON.stringify(meta || {}))
  res.json({ id, clientUrl: buildClientUrl(id) })
})

// Récupérer état + méta
app.get('/api/proofs/:id', (req, res) => {
  const p = db.prepare(`SELECT * FROM proofs WHERE id=?`).get(req.params.id)
  if (!p) return res.status(404).json({ error: 'not found' })
  const meta = JSON.parse(p.meta_json || '{}')
  res.json({ id: p.id, fileUrl: p.file_url, meta, locked: !!p.locked, approvedAt: p.approved_at })
})

// Mettre à jour méta
app.put('/api/proofs/:id/meta', (req, res) => {
  const p = db.prepare(`SELECT id FROM proofs WHERE id=?`).get(req.params.id)
  if (!p) return res.status(404).json({ error: 'not found' })
  db.prepare(`UPDATE proofs SET meta_json=? WHERE id=?`).run(JSON.stringify(req.body||{}), req.params.id)
  res.json({ ok: true })
})

// Annotations (GET/PUT)
app.get('/api/proofs/:id/annos/:page', (req, res) => {
  const row = db.prepare(`SELECT data_json FROM annotations WHERE proof_id=? AND page=?`)
               .get(req.params.id, Number(req.params.page))
  res.json({ page: Number(req.params.page), annos: row ? JSON.parse(row.data_json) : [] })
})
app.put('/api/proofs/:id/annos/:page', (req, res) => {
  const annos = req.body?.annos || []
  db.prepare(`INSERT INTO annotations(proof_id,page,data_json) VALUES(?,?,?)
              ON CONFLICT(proof_id,page) DO UPDATE SET data_json=excluded.data_json`)
    .run(req.params.id, Number(req.params.page), JSON.stringify(annos))
  res.json({ ok: true })
})

// Approuver / verrouiller
app.post('/api/proofs/:id/approve', (req, res) => {
  const at = new Date().toISOString()
  db.prepare(`UPDATE proofs SET locked=1, approved_at=? WHERE id=?`).run(at, req.params.id)
  // TODO: notifier ClickUp/Albato ici
  res.json({ ok: true, approvedAt: at })
})

function buildClientUrl(id){
  const base = process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:5173'
  return `${base}/?mode=client&id=${id}`
}

const PORT = process.env.PORT || 4000
app.listen(PORT, () => console.log('API ready on http://127.0.0.1:'+PORT))
