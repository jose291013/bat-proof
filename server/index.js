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

// ── BOOT logs pour vérifier le bon fichier/dossier
console.log('BOOT file =', new URL(import.meta.url).pathname)
console.log('BOOT cwd  =', process.cwd())

// ── Paths / constantes
const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)




// ── App & middlewares (⚠️ app doit être créé AVANT app.use/app.post)
const app = express()
// derrière le proxy Render pour avoir le bon protocole (https)
app.set('trust proxy', 1)

// utilitaire: base URL publique
const getBaseUrl = (req) =>
  process.env.SERVER_BASE_URL || `${req.protocol}://${req.get('host')}`


// CORS (dev souple + prod strict)
const PROD_ORIGIN = process.env.PUBLIC_BASE_URL; // ex: https://bat-proof-1.onrender.com

const corsOptions = {
  origin: (origin, cb) => {
    const ok =
      !origin || // curl/health checks
      /^http:\/\/(127\.0\.0\.1|localhost):517\d$/.test(origin) || // Vite dev
      (PROD_ORIGIN && origin === PROD_ORIGIN); // prod exact
    cb(ok ? null : new Error('CORS'), ok ? true : undefined);
  },
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // préflight



// Logger minimal
app.use((req, _res, next) => {
  console.log(new Date().toISOString(), req.method, req.url)
  next()
})

app.use(express.json({ limit: '10mb' }))

// ── Fichiers uploadés (statique)
const UP = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(__dirname, './uploads')
fs.mkdirSync(UP, { recursive: true })
app.use('/uploads', express.static(UP))

// Multer (stockage disque)
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

// ── Helpers
function buildClientUrl(id){
  return `${PUBLIC_BASE_URL}/?mode=client&id=${id}`
}

// ── Routes

// Santé
app.get('/health', (_req, res) => res.json({ ok: true }))

// Upload PDF → URL publique
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier' })
    const base = getBaseUrl(req) 
  const url  = `${base}/uploads/${req.file.filename}`
  console.log('ROUTE: /api/upload HIT ->', url)
  res.json({ url, fileName: req.file.originalname, size: req.file.size })
})
console.log('ROUTE: /api/upload READY')

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

// ── Démarrage
app.listen(PORT, () => {
  console.log(`API ready on ${SERVER_BASE_URL}`)
  console.log(`CORS: accepts http://127.0.0.1:517x and http://localhost:517x`)
})

