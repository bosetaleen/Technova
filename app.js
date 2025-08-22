const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// ----- DB POOL -----
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  multipleStatements: true
});

// Ensure database exists and use it
async function ensureDatabase() {
  const dbName = process.env.DB_NAME || 'billboard_portal';
  const conn = await pool.getConnection();
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
    await conn.query(`USE \`${dbName}\``);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS reports (
        id INT AUTO_INCREMENT PRIMARY KEY,
        case_id VARCHAR(32) UNIQUE,
        citizen_name VARCHAR(100),
        email VARCHAR(120),
        phone VARCHAR(20),
        image_path VARCHAR(255),
        location VARCHAR(255) NOT NULL,
        description TEXT,
        issue_type VARCHAR(32) NOT NULL,
        status ENUM('NEW','UNDER_REVIEW','VERIFIED','ACTION_TAKEN','CLOSED') DEFAULT 'NEW',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'officer',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } finally {
    conn.release();
  }
}

async function ensureAdminUser() {
  const dbName = process.env.DB_NAME || 'billboard_portal';
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const conn = await pool.getConnection();
  try {
    await conn.query(`USE \`${dbName}\``);
    const [rows] = await conn.query('SELECT id FROM admin_users WHERE username=?', [username]);
    if (rows.length === 0) {
      const hash = await bcrypt.hash(password, 10);
      await conn.query('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)', [username, hash]);
      console.log('✅ Created default admin:', username);
    }
  } finally {
    conn.release();
  }
}

// ----- MIDDLEWARES -----
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'keyboard cat',
  resave: false,
  saveUninitialized: false
}));

// ----- View Engine -----
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
// lightweight layout helper
app.use((req, res, next) => {
  res.locals.layout = function(view){ this._layoutFile = view; };
  res.renderWithLayout = function(view, options){
    options = options || {};
    options.body = fs.readFileSync(path.join(__dirname, 'views', view + '.ejs'), 'utf8');
    res.render('layout', { ...options });
  };
  next();
});

// ----- File Upload (Multer) -----
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, path.join(__dirname, 'public', 'uploads'));
  },
  filename: function(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = Date.now() + '-' + Math.round(Math.random()*1e9) + ext;
    cb(null, name);
  }
});
function fileFilter (req, file, cb) {
  const allowed = ['.jpg','.jpeg','.png'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (!allowed.includes(ext)) return cb(new Error('Only JPG/PNG allowed'));
  cb(null, true);
}
const upload = multer({ storage, fileFilter, limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB

// ----- Helpers -----
function genCaseId() {
  const now = new Date();
  const y = now.getFullYear();
  const seq = Math.floor(Math.random()*1e6).toString().padStart(6, '0');
  return `REP${y}${seq}`;
}

function ensureAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect('/admin/login');
}

// ----- ROUTES (Public) -----
app.get('/', async (req, res) => {
  res.render('index', { title: 'Home' });
});

app.get('/report', (req, res) => {
  res.render('report', { title: 'Report' });
});

app.post('/report', upload.single('photo'), async (req, res) => {
  const dbName = process.env.DB_NAME || 'billboard_portal';
  const conn = await pool.getConnection();
  try {
    await conn.query(`USE \`${dbName}\``);
    const { citizen_name, email, phone, location, description, issue_type } = req.body;
    const case_id = genCaseId();
    const image_path = req.file ? `/uploads/${req.file.filename}` : null;
    await conn.query(
      `INSERT INTO reports (case_id, citizen_name, email, phone, image_path, location, description, issue_type)
       VALUES (?,?,?,?,?,?,?,?)`,
      [case_id, citizen_name||null, email||null, phone||null, image_path, location, description||null, issue_type]
    );
    res.render('success', { title: 'Submitted', caseId: case_id });
  } catch (e) {
    console.error(e);
    res.status(500).send('Failed to submit report.');
  } finally {
    conn.release();
  }
});

app.get('/track', async (req, res) => {
  const { caseId } = req.query;
  if (!caseId) return res.render('track', { title: 'Track' });
  res.redirect(`/track/${encodeURIComponent(caseId)}`);
});

app.get('/track/:caseId', async (req, res) => {
  const dbName = process.env.DB_NAME || 'billboard_portal';
  const conn = await pool.getConnection();
  try {
    await conn.query(`USE \`${dbName}\``);
    const { caseId } = req.params;
    const [rows] = await conn.query('SELECT * FROM reports WHERE case_id = ?', [caseId]);
    if (rows.length === 0) return res.render('track_case', { title: 'Track', report: null });
    const report = rows[0];
    res.render('track_case', { title: 'Track', report });
  } catch (e) {
    console.error(e);
    res.status(500).send('Failed to fetch case.');
  } finally {
    conn.release();
  }
});

// ----- REST API (minimal) -----
app.post('/api/reports', upload.single('photo'), async (req, res) => {
  const dbName = process.env.DB_NAME || 'billboard_portal';
  const conn = await pool.getConnection();
  try {
    await conn.query(`USE \`${dbName}\``);
    const { location, description, issue_type, citizen_name, email, phone } = req.body;
    if (!location || !issue_type) return res.status(400).json({ error: 'location and issue_type required' });
    const case_id = genCaseId();
    const image_path = req.file ? `/uploads/${req.file.filename}` : null;
    await conn.query(
      `INSERT INTO reports (case_id, citizen_name, email, phone, image_path, location, description, issue_type)
       VALUES (?,?,?,?,?,?,?,?)`,
      [case_id, citizen_name||null, email||null, phone||null, image_path, location, description||null, issue_type]
    );
    res.json({ ok: true, case_id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'failed' });
  } finally {
    conn.release();
  }
});

app.get('/api/reports/:caseId', async (req, res) => {
  const dbName = process.env.DB_NAME || 'billboard_portal';
  const conn = await pool.getConnection();
  try {
    await conn.query(`USE \`${dbName}\``);
    const { caseId } = req.params;
    const [rows] = await conn.query('SELECT case_id, status, issue_type, location, created_at FROM reports WHERE case_id = ?', [caseId]);
    if (rows.length === 0) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed' });
  } finally {
    conn.release();
  }
});

// ----- ADMIN -----
app.get('/admin/login', (req, res) => {
  res.render('admin_login', { title: 'Login', error: null });
});

app.post('/admin/login', async (req, res) => {
  const dbName = process.env.DB_NAME || 'billboard_portal';
  const { username, password } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.query(`USE \`${dbName}\``);
    const [rows] = await conn.query('SELECT * FROM admin_users WHERE username=?', [username]);
    if (rows.length === 0) return res.render('admin_login', { title: 'Login', error: 'Invalid credentials' });
    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.render('admin_login', { title: 'Login', error: 'Invalid credentials' });
    req.session.user = { id: user.id, username: user.username, role: user.role };
    res.redirect('/admin/dashboard');
  } catch (e) {
    console.error(e);
    res.status(500).send('Login failed');
  } finally {
    conn.release();
  }
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.get('/admin/dashboard', ensureAuth, async (req, res) => {
  const dbName = process.env.DB_NAME || 'billboard_portal';
  const conn = await pool.getConnection();
  try {
    await conn.query(`USE \`${dbName}\``);
    const [rows] = await conn.query('SELECT id, case_id, issue_type, status, created_at FROM reports ORDER BY id DESC LIMIT 100');
    res.render('admin_dashboard', { title: 'Dashboard', reports: rows });
  } catch (e) {
    console.error(e);
    res.status(500).send('Failed to load dashboard');
  } finally {
    conn.release();
  }
});

app.get('/admin/case/:id', ensureAuth, async (req, res) => {
  const dbName = process.env.DB_NAME || 'billboard_portal';
  const conn = await pool.getConnection();
  try {
    await conn.query(`USE \`${dbName}\``);
    const { id } = req.params;
    const [rows] = await conn.query('SELECT * FROM reports WHERE id=?', [id]);
    if (rows.length === 0) return res.status(404).send('Not found');
    res.render('admin_case', { title: 'Case', report: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).send('Failed to load case');
  } finally {
    conn.release();
  }
});

app.post('/admin/case/:id/status', ensureAuth, async (req, res) => {
  const dbName = process.env.DB_NAME || 'billboard_portal';
  const conn = await pool.getConnection();
  try {
    await conn.query(`USE \`${dbName}\``);
    const { id } = req.params;
    const { status } = req.body;
    await conn.query('UPDATE reports SET status=? WHERE id=?', [status, id]);
    res.redirect(`/admin/case/${id}`);
  } catch (e) {
    console.error(e);
    res.status(500).send('Failed to update status');
  } finally {
    conn.release();
  }
});

// ----- STARTUP -----
(async () => {
  try {
    await ensureDatabase();
    await ensureAdminUser();
    app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
  } catch (e) {
    console.error('Startup error', e);
    process.exit(1);
  }
})();
