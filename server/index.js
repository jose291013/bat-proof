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
const CLIENT_BASE = process.env.CLIENT_BASE_URL || ''

// ── BOOT logs
console.log('BOOT file =', new URL(import.meta.url).pathname)
console.log('BOOT cwd  =', process.cwd())

// ── Paths / constantes
const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)

// ── Config
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000
const PROD_ORIGIN = process.env.PUBLIC_BASE_URL // ex: https://bat-proof-1.onrender.com

// ── App & middlewares
const app = express()
app.set('trust proxy', 1)

// CORS (dev souple + prod strict)
const corsOptions = {
  origin: (origin, cb) => {
    const ok =
      !origin || // curl/health checks
      /^http:\/\/(127\.0\.0\.1|localhost):517\d$/.test(origin) || // Vite dev
      (PROD_ORIGIN && origin === PROD_ORIGIN) // prod exact
    cb(ok ? null : new Error('CORS'), ok ? true : undefined)
  },
}
app.use(cors(corsOptions))


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

// ── DB (SQLite) PERSISTANTE + MIGRATIONS AUTO
// Chemin DB: var env DB_PATH > sinon ./db.sqlite (local)
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, './db.sqlite')

// S'assure que le dossier existe (utile si DB_PATH pointe vers un Disk)
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })

// Ouvre la base
const db = new Database(DB_PATH)

// Tables de base
db.exec(`
CREATE TABLE IF NOT EXISTS proofs (
  id TEXT PRIMARY KEY,
  file_url TEXT NOT NULL,
  meta_json TEXT NOT NULL,
  locked INTEGER DEFAULT 0,
  approved_at TEXT,
  client_email TEXT,
  clickup_list_id TEXT,
  clickup_task_id TEXT,
  sent_at TEXT
);
CREATE TABLE IF NOT EXISTS annotations (
  proof_id TEXT NOT NULL,
  page INTEGER NOT NULL,
  data_json TEXT NOT NULL,
  PRIMARY KEY (proof_id, page)
);
`)

// --- Nouvelles tables pour l'historique par version ---
db.exec(`
CREATE TABLE IF NOT EXISTS proof_versions (
  id TEXT PRIMARY KEY,
  proof_id TEXT NOT NULL,
  v INTEGER NOT NULL,
  file_url TEXT NOT NULL,
  meta_json TEXT NOT NULL,
  created_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_versions_proof_v ON proof_versions(proof_id, v);
`)

db.exec(`
CREATE TABLE IF NOT EXISTS version_annotations (
  version_id TEXT NOT NULL,
  page INTEGER NOT NULL,
  data_json TEXT NOT NULL,
  PRIMARY KEY (version_id, page)
);
`)


// --- Migrations "add column" idempotentes ---
function addColumnIfMissing(table, col, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name)
  if (!cols.includes(col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`)
    console.log(`DB: added ${table}.${col} (${type})`)
  }
}


// Colonnes pour ClickUp & envois
addColumnIfMissing('proofs', 'client_email', 'TEXT')
addColumnIfMissing('proofs', 'clickup_list_id', 'TEXT')
addColumnIfMissing('proofs', 'clickup_task_id', 'TEXT')
addColumnIfMissing('proofs', 'sent_at', 'TEXT')


// Crée une V1 si un proof n’a pas encore d’entrée dans proof_versions
function ensureV1ForProof(proof) {
  const v1 = db.prepare(`SELECT id FROM proof_versions WHERE proof_id=? AND v=1`).get(proof.id)
  if (v1) return v1.id
  const verId = nanoid(10)
  const meta = JSON.parse(proof.meta_json || '{}')
  const metaV1 = { ...meta, version: meta.version ?? 1 }
  db.prepare(`
    INSERT INTO proof_versions(id, proof_id, v, file_url, meta_json, created_at)
    VALUES (?,?,?,?,?,?)
  `).run(verId, proof.id, metaV1.version || 1, proof.file_url, JSON.stringify(metaV1), new Date().toISOString())

  // Copier les annotations “globales” (si existantes) vers la V1
  const rows = db.prepare(`SELECT page, data_json FROM annotations WHERE proof_id=?`).all(proof.id)
  const ins = db.prepare(`INSERT INTO version_annotations(version_id,page,data_json) VALUES (?,?,?)`)
  for (const r of rows) ins.run(verId, r.page, r.data_json)
  return verId
}

// Au boot, s’assure que chaque proof a au moins une V1
const allProofs = db.prepare(`SELECT * FROM proofs`).all()
for (const p of allProofs) ensureV1ForProof(p)

console.log('DB ready at', DB_PATH)


// ── Helpers
function buildClientUrl(id, req) {
  // si CLIENT_BASE n'est pas défini en env, on retombe sur l'origine de la requête
  const base = (CLIENT_BASE && CLIENT_BASE.trim())
    ? CLIENT_BASE
    : `${req.protocol}://${req.get('host')}`

  return `${base.replace(/\/+$/, '')}/?mode=client&id=${id}`
}

// ── Routes

// Santé
app.get('/health', (_req, res) => res.json({ ok: true }))

// Upload PDF → chemin relatif public
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier' })
  const url = `/uploads/${req.file.filename}`         // <- RELATIF
  console.log('ROUTE: /api/upload HIT ->', url)
  res.json({ url, fileName: req.file.originalname, size: req.file.size })
})
console.log('ROUTE: /api/upload READY')

// Créer un BAT (retourne l’URL client relative)
app.post('/api/proofs', (req, res) => {
  const { fileUrl, meta } = req.body || {}
  if (!fileUrl) return res.status(400).json({ error: 'fileUrl requis' })
  const id = nanoid(10)
  db.prepare(`INSERT INTO proofs(id,file_url,meta_json) VALUES (?,?,?)`)
    .run(id, fileUrl, JSON.stringify(meta || {}))     // fileUrl attendu RELATIF
  res.json({ id, clientUrl: buildClientUrl(id, req) }) // ← passe req ici
})

// Récupérer état + métadonnées
app.get('/api/proofs/:id', (req, res) => {
  const p = db.prepare(`SELECT * FROM proofs WHERE id=?`).get(req.params.id)
  if (!p) return res.status(404).json({ error: 'not found' })
  const meta = JSON.parse(p.meta_json || '{}')
  res.json({ id: p.id, fileUrl: p.file_url, meta, locked: !!p.locked, approvedAt: p.approved_at })
})

// GET /api/proofs/:id/versions  -> [{id,v,createdAt,fileUrl,meta}]
app.get('/api/proofs/:id/versions', (req, res) => {
  const rows = db.prepare(`SELECT * FROM proof_versions WHERE proof_id=? ORDER BY v ASC`).all(req.params.id)
  const items = rows.map(r => ({
    id: r.id, v: r.v, createdAt: r.created_at,
    fileUrl: r.file_url, meta: JSON.parse(r.meta_json||'{}')
  }))
  res.json({ versions: items })
})


// Mettre à jour métadonnées
app.put('/api/proofs/:id/meta', (req, res) => {
  const p = db.prepare(`SELECT id FROM proofs WHERE id=?`).get(req.params.id)
  if (!p) return res.status(404).json({ error: 'not found' })
  db.prepare(`UPDATE proofs SET meta_json=? WHERE id=?`)
    .run(JSON.stringify(req.body || {}), req.params.id)
  res.json({ ok: true })
})


// GET /api/versions/:verId/annos/:page
app.get('/api/versions/:verId/annos/:page', (req, res) => {
  const row = db.prepare(`SELECT data_json FROM version_annotations WHERE version_id=? AND page=?`)
                 .get(req.params.verId, Number(req.params.page))
  res.json({ page: Number(req.params.page), annos: row ? JSON.parse(row.data_json) : [] })
})

// PUT /api/versions/:verId/annos/:page  { annos: [...] }
app.put('/api/versions/:verId/annos/:page', (req, res) => {
  const annos = req.body?.annos || []
  db.prepare(`
    INSERT INTO version_annotations(version_id,page,data_json) VALUES(?,?,?)
    ON CONFLICT(version_id,page) DO UPDATE SET data_json=excluded.data_json
  `).run(req.params.verId, Number(req.params.page), JSON.stringify(annos))
  res.json({ ok: true })
})



// Approuver / verrouiller
app.post('/api/proofs/:id/approve', (req, res) => {
  const at = new Date().toISOString()
  db.prepare(`UPDATE proofs SET locked=1, approved_at=? WHERE id=?`).run(at, req.params.id)
  res.json({ ok: true, approvedAt: at })
})


// ===== Helpers ClickUp (si pas déjà ajoutés plus haut)
const CU_BASE = 'https://api.clickup.com/api/v2';
const cuHeaders = {
  Authorization: process.env.CLICKUP_TOKEN,
  'Content-Type': 'application/json',
};
async function cuGET(p){ const r=await fetch(`${CU_BASE}${p}`,{headers:cuHeaders}); return r.json(); }
async function cuPOST(p,b){ const r=await fetch(`${CU_BASE}${p}`,{method:'POST',headers:cuHeaders,body:JSON.stringify(b)}); return r.json(); }
async function cuPUT(p,b){ const r=await fetch(`${CU_BASE}${p}`,{method:'PUT', headers:cuHeaders,body:JSON.stringify(b)}); return r.json(); }

function buildCuDescription({ clientUrl, adminUrl, fileUrl, meta }) {
  return [
    'BAT à valider',
    `- Version : ${meta?.version ?? '-'}`,
    `- Fichier : ${meta?.fileName ?? '-'}${meta?.fileSize ? ` (${meta.fileSize} o)` : ''}`,
    `- Pages   : ${meta?.pages ?? '-'}`,
    `- Lien client : ${clientUrl}`,
    adminUrl ? `- Lien admin : ${adminUrl}` : null,
    `- Lien fichier : ${fileUrl}`,
    meta?.comment ? `- Commentaire : ${meta.comment}` : null,
  ].filter(Boolean).join('\n');
}
async function getOrCreateListByEmail(email) {
  const spaceId = process.env.CLICKUP_SPACE_ID; // ID de l'ESPACE "BAT"
  const lists = await cuGET(`/space/${spaceId}/list?archived=false`);
  const f = lists?.lists?.find(l => (l.name||'').toLowerCase() === email.toLowerCase());
  if (f) return f.id;
  const created = await cuPOST(`/space/${spaceId}/list`, { name: email });
  return created.id;
}

// ===== Route: envoyer le BAT (crée/maj la tâche + ping Albato)
app.post('/api/proofs/:id/send', async (req, res) => {
  try {
    const id = req.params.id;
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'email requis' });

    const row = db.prepare('SELECT * FROM proofs WHERE id=?').get(id);
    if (!row) return res.status(404).json({ error: 'not found' });

    // D’abord on calcule ce qui est nécessaire
    const meta = JSON.parse(row.meta_json || '{}');
    const clientUrl = buildClientUrl(id, req);
    const fileUrl = row.file_url;
    const adminUrl = `${(process.env.CLIENT_BASE_URL || '').replace(/\/+$/, '')}/?mode=admin&id=${id}`;

    const listId = row.clickup_list_id || await getOrCreateListByEmail(email);
    const taskName = `${meta.fileName || 'document'} ${meta.version ? `(V${meta.version})` : ''}`.trim();
    const cuDescription = buildCuDescription({ clientUrl, adminUrl, fileUrl, meta });
    const statusSent = process.env.CLICKUP_STATUS_SENT || 'BAT ENVOYÉ';

    // Un seul payload réutilisé pour create/update
    const payload = { name: taskName, priority: 3, description: cuDescription };
    if (statusSent) payload.status = statusSent;

    let taskId = row.clickup_task_id;
    if (!taskId) {
      const created = await cuPOST(`/list/${listId}/task`, payload);
      if (!created?.id) return res.status(502).json({ error: 'clickup_create_failed', details: created });
      taskId = created.id;
    } else {
      const updated = await cuPUT(`/task/${taskId}`, payload);
      if (updated?.err) return res.status(502).json({ error: 'clickup_update_failed', details: updated });
    }

    // Sauvegarde DB
    db.prepare('UPDATE proofs SET client_email=?, clickup_list_id=?, clickup_task_id=?, meta_json=?, sent_at=? WHERE id=?')
      .run(
        email,
        listId,
        taskId,
        JSON.stringify({ ...meta, sentAt: meta.sentAt || new Date().toISOString() }),
        new Date().toISOString(),
        id
      );

    // Commentaire + ping Albato (best-effort)
    try {
      await fetch(`${CU_BASE}/task/${taskId}/comment`, {
        method: 'POST',
        headers: cuHeaders,
        body: JSON.stringify({ comment_text: `📎 Lien client\n${clientUrl}\n\n📎 Admin\n${adminUrl}\n\n📎 Fichier\n${fileUrl}` }),
      });
      if (process.env.ALBATO_WEBHOOK_URL) {
        await fetch(process.env.ALBATO_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'BAT_SENT',
            to: email, taskId, listId, proofId: id,
            clientUrl, fileUrl, meta, adminUrl,
          }),
        });
      }
    } catch {}

    res.json({ ok: true, taskId, listId, clientUrl });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server', details: e.message });
  }
});

// POST /api/proofs/:id/new-version { fileUrl, metaPatch? }
app.post('/api/proofs/:id/new-version', async (req, res) => {
  const { fileUrl, metaPatch } = req.body || {}
  if (!fileUrl) return res.status(400).json({ error: 'fileUrl requis' })

  const proof = db.prepare(`SELECT * FROM proofs WHERE id=?`).get(req.params.id)
  if (!proof) return res.status(404).json({ error: 'not found' })

  const latest = db.prepare(`SELECT * FROM proof_versions WHERE proof_id=? ORDER BY v DESC LIMIT 1`).get(proof.id)
  const curMeta = latest ? JSON.parse(latest.meta_json||'{}') : JSON.parse(proof.meta_json||'{}')
  const vNext = (curMeta.version || 1) + 1

  const verId = nanoid(10)
  const metaNext = { ...curMeta, ...(metaPatch||{}), version: vNext }

  db.prepare(`INSERT INTO proof_versions(id,proof_id,v,file_url,meta_json,created_at)
              VALUES (?,?,?,?,?,?)`)
    .run(verId, proof.id, vNext, fileUrl, JSON.stringify(metaNext), new Date().toISOString())

  db.prepare(`UPDATE proofs SET file_url=?, meta_json=?, locked=0, approved_at=NULL WHERE id=?`)
    .run(fileUrl, JSON.stringify(metaNext), proof.id)

  // (Option) notifier ClickUp : statut ENVOYÉ + commentaire avec les liens
  const clientUrl = buildClientUrl(proof.id, req)
  const adminUrl  = `${(process.env.CLIENT_BASE_URL||'').replace(/\/+$/,'')}/?mode=admin&id=${proof.id}`
  const row = db.prepare(`SELECT clickup_task_id FROM proofs WHERE id=?`).get(proof.id)
  if (row?.clickup_task_id) {
    const desc = buildCuDescription({ clientUrl, adminUrl, fileUrl, meta: metaNext })
    fetch(`${CU_BASE}/task/${row.clickup_task_id}`, {
      method:'PUT', headers: cuHeaders, body: JSON.stringify({ status: process.env.CLICKUP_STATUS_SENT || 'BAT ENVOYÉ', description: desc })
    }).catch(()=>{})
    fetch(`${CU_BASE}/task/${row.clickup_task_id}/comment`, {
      method:'POST', headers: cuHeaders, body: JSON.stringify({ comment_text: `📦 Nouvelle version V${vNext}\n${clientUrl}\n${adminUrl}\n${fileUrl}` })
    }).catch(()=>{})
  }

  res.json({ ok:true, version:vNext, versionId: verId, clientUrl })
})

function getLatestVersionId(proofId) {
  const r = db.prepare(`SELECT id FROM proof_versions WHERE proof_id=? ORDER BY v DESC LIMIT 1`).get(proofId)
  return r?.id || null
}

app.get('/api/proofs/:id/annos/:page', (req, res) => {
  const verId = getLatestVersionId(req.params.id)
  if (!verId) return res.json({ page:Number(req.params.page), annos:[] })
  const row = db.prepare(`SELECT data_json FROM version_annotations WHERE version_id=? AND page=?`)
                 .get(verId, Number(req.params.page))
  res.json({ page:Number(req.params.page), annos: row ? JSON.parse(row.data_json) : [] })
})

app.put('/api/proofs/:id/annos/:page', (req, res) => {
  const verId = getLatestVersionId(req.params.id)
  if (!verId) return res.status(400).json({ error:'no version' })
  const annos = req.body?.annos || []
  db.prepare(`
    INSERT INTO version_annotations(version_id,page,data_json) VALUES(?,?,?)
    ON CONFLICT(version_id,page) DO UPDATE SET data_json=excluded.data_json
  `).run(verId, Number(req.params.page), JSON.stringify(annos))
  res.json({ ok: true })
})
// ── Démarrage
app.listen(PORT, () => {
  console.log(`API ready on port ${PORT}`)
  console.log(`CORS: accepts http://127.0.0.1:517x and http://localhost:517x`)
})




