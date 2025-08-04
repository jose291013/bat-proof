// server/index.js
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import Database from 'better-sqlite3'
import { nanoid } from 'nanoid'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// ── Paths / constantes
const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)

const PORT = process.env.PORT || 4000
const SERVER_BASE_URL = process.env.SERVER_BASE_URL || `http://127.0.0.1:${PORT}`
// Front par défaut sur 5174 en dev
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:5174'

const app = express()

// ── CORS souple (localhost/127.0.0.1 ports 5170–5179)
app.use(cors({
  origin: [/^http:\/\/127\.0\.0\.1:517\d$/, /^http:\/\/localhost:517\d$/],
}))

// Logger minimal
app.use((req, _res, next) => {
  console.log(new Date().toISOString(), req.method, req.url)
  next()
})

app.use(express.json({ limit: '10mb' }))

// ── Fichiers uploadés (statique)
const UP = path.resolve(__dirname, './uploads')
fs.mkdirSync(UP, { recursive: true })
app.use('/uploads', express.static(UP))

// ── Multer (stockage disque)
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UP),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.-]/g, '_')
    cb(null, Date.now() + '_' + safe)
  }
})
const upload = multer({ storage })

// ── DB (SQLite)
const db = new Database(path.resolve(__dirname, './db.sqlite'))
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

// ── Helper
function buildClientUrl(id){
  return `${PUBLIC_BASE_URL}/?mode=client&id=${id}`
}

// ── Routes
app.get('/health', (_req, res) => res.json({ ok: true }))

// Upload PDF → URL publique
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier' })
  const url = `${SERVER_BASE_URL}/uploads/${req.file.filename}`
  console.log('Uploaded:', req.file.originalname, '->', url)
  res.json({ url, fileName: req.file.originalname, size: req.file.size })
})

// Créer un BAT (retourne l’URL client)
app.post('/api/proofs', (req, res) => {
  const { fileUrl, meta } = req.body || {}
  if (!fileUrl) return res.status(400).json({ error: 'fileUrl requis' })
  const id = nanoid(10)
  db.prepare(`INSERT INTO proofs(id,file_url,meta_json) VALUES (?,?,?)`)
    .run(id, fileUrl, JSON.stringify(meta || {}))
  res.json({ id, clientUrl: buildClientUrl(id) })
})

// Récupérer état + métadonnées
app.get('/api/proofs/:id', (req, res) => {
  const p = db.prepare(`SELECT * FROM proofs WHERE id=?`).get(req.params.id)
  if (!p) return res.status(404).json({ error: 'not found' })
  const meta = JSON.parse(p.meta_json || '{}')
  res.json({ id: p.id, fileUrl: p.file_url, meta, locked: !!p.locked, approvedAt: p.approved_at })
})

// Mettre à jour métadonnées
app.put('/api/proofs/:id/meta', (req, res) => {
  const p = db.prepare(`SELECT id FROM proofs WHERE id=?`).get(req.params.id)
  if (!p) return res.status(404).json({ error: 'not found' })
  db.prepare(`UPDATE proofs SET meta_json=? WHERE id=?`)
    .run(JSON.stringify(req.body || {}), req.params.id)
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
  res.json({ ok: true, approvedAt: at })
})

// ── Start
app.listen(PORT, () => {
  console.log(`API ready on ${SERVER_BASE_URL}`)
  console.log(`CORS: accepts http://127.0.0.1:517x and http://localhost:517x`)
})
