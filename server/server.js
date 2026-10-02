const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const COACH_CODE = process.env.COACH_CODE || 'coach123';
if (!process.env.COACH_CODE) {
  console.warn('WARNING: COACH_CODE not set, using default "coach123". Set COACH_CODE env var in production.');
}

app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === '1',
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
  },
}));

// ---------- helpers ----------
const DAY = 86400;
function unlockedDay(user) {
  if (user.role === 'coach') return Number.MAX_SAFE_INTEGER;
  const elapsed = Math.floor(Date.now() / 1000) - user.created_at;
  return Math.max(1, 1 + Math.floor(elapsed / DAY));
}
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not signed in' });
  const user = db.prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  req.user = user;
  next();
}
function requireCoach(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'coach') return res.status(403).json({ error: 'Coach only' });
    next();
  });
}
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ''));

// ---------- auth ----------
app.post('/api/signup', async (req, res) => {
  const { name, email, password, coach_code } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
  if (!isEmail(email)) return res.status(400).json({ error: 'Valid email is required' });
  if (!password || String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(String(email).toLowerCase());
  if (exists) return res.status(400).json({ error: 'That email is already registered. Try signing in.' });
  const role = (coach_code && String(coach_code) === COACH_CODE) ? 'coach' : 'member';
  const hash = await bcrypt.hash(String(password), 10);
  const r = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)')
    .run(String(name).trim(), String(email).toLowerCase(), hash, role);
  req.session.userId = r.lastInsertRowid;
  const user = db.prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?').get(r.lastInsertRowid);
  res.json({ user });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase());
  if (!user || !(await bcrypt.compare(String(password || ''), user.password_hash))) {
    return res.status(401).json({ error: 'Email or password is incorrect' });
  }
  req.session.userId = user.id;
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, created_at: user.created_at } });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.user, unlocked_day: unlockedDay(req.user) });
});

// ---------- lessons (member) ----------
function lessonListFor(user) {
  const maxDay = unlockedDay(user);
  const lessons = db.prepare('SELECT id, day, chapter, lesson_num, code, title FROM lessons ORDER BY day').all();
  const done = new Set(
    db.prepare('SELECT lesson_id FROM progress WHERE user_id = ?').all(user.id).map(r => r.lesson_id)
  );
  return lessons.map(l => ({
    ...l,
    locked: l.day > maxDay,
    completed: done.has(l.id),
  }));
}

app.get('/api/lessons', requireAuth, (req, res) => {
  res.json({ lessons: lessonListFor(req.user), unlocked_day: unlockedDay(req.user) });
});

function lessonDetail(day, user) {
  const lesson = db.prepare('SELECT * FROM lessons WHERE day = ?').get(day);
  if (!lesson) return null;
  const maxDay = unlockedDay(user);
  if (lesson.day > maxDay) return { locked: true, lesson: { day: lesson.day, title: lesson.title } };
  const items = db.prepare('SELECT * FROM ta_items WHERE lesson_id = ? ORDER BY sort_order, id').all(lesson.id);
  const answers = db.prepare(`
    SELECT a.ta_field_id, a.answer_text FROM answers a
    JOIN ta_fields f ON f.id = a.ta_field_id
    JOIN ta_items i ON i.id = f.ta_item_id
    WHERE a.user_id = ? AND i.lesson_id = ?`).all(user.id, lesson.id);
  const ansMap = Object.fromEntries(answers.map(a => [a.ta_field_id, a.answer_text]));
  const ta = items.map(it => ({
    id: it.id,
    instruction: it.instruction,
    fields: db.prepare('SELECT id, label, field_type FROM ta_fields WHERE ta_item_id = ? ORDER BY sort_order, id')
      .all(it.id)
      .map(f => ({ ...f, answer: ansMap[f.id] || '' })),
  }));
  const completed = !!db.prepare('SELECT 1 FROM progress WHERE user_id = ? AND lesson_id = ?').get(user.id, lesson.id);
  return { lesson: { ...lesson, body: JSON.parse(lesson.body || '[]') }, ta, completed, locked: false };
}

app.get('/api/lessons/:day', requireAuth, (req, res) => {
  const d = lessonDetail(Number(req.params.day), req.user);
  if (!d) return res.status(404).json({ error: 'Lesson not found' });
  if (d.locked) return res.status(403).json({ error: 'This lesson unlocks on day ' + d.lesson.day, locked: true });
  res.json(d);
});

app.post('/api/answers', requireAuth, (req, res) => {
  const { answers } = req.body || {};
  if (!Array.isArray(answers)) return res.status(400).json({ error: 'Bad request' });
  const maxDay = unlockedDay(req.user);
  const upsert = db.prepare(`
    INSERT INTO answers (user_id, ta_field_id, answer_text, updated_at)
    VALUES (?,?,?,strftime('%s','now'))
    ON CONFLICT (user_id, ta_field_id) DO UPDATE SET answer_text=excluded.answer_text, updated_at=excluded.updated_at`);
  const fieldLesson = db.prepare(`
    SELECT l.day FROM ta_fields f
    JOIN ta_items i ON i.id = f.ta_item_id
    JOIN lessons l ON l.id = i.lesson_id
    WHERE f.id = ?`);
  const save = db.transaction((list) => {
    let n = 0;
    for (const a of list) {
      const fl = fieldLesson.get(a.field_id);
      if (!fl || fl.day > maxDay) continue; // ignore locked/unknown fields
      upsert.run(req.user.id, a.field_id, String(a.text || ''));
      n++;
    }
    return n;
  });
  res.json({ saved: save(answers) });
});

app.post('/api/lessons/:day/complete', requireAuth, (req, res) => {
  const lesson = db.prepare('SELECT id, day FROM lessons WHERE day = ?').get(Number(req.params.day));
  if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
  if (lesson.day > unlockedDay(req.user)) return res.status(403).json({ error: 'Lesson is locked' });
  db.prepare('INSERT OR IGNORE INTO progress (user_id, lesson_id) VALUES (?,?)').run(req.user.id, lesson.id);
  res.json({ ok: true });
});

app.delete('/api/lessons/:day/complete', requireAuth, (req, res) => {
  const lesson = db.prepare('SELECT id FROM lessons WHERE day = ?').get(Number(req.params.day));
  if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
  db.prepare('DELETE FROM progress WHERE user_id = ? AND lesson_id = ?').run(req.user.id, lesson.id);
  res.json({ ok: true });
});

// ---------- coach ----------
app.get('/api/coach/users', requireCoach, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.name, u.email, u.created_at,
      (SELECT COUNT(*) FROM progress p WHERE p.user_id = u.id) AS completed_count,
      (SELECT COUNT(*) FROM answers a WHERE a.user_id = u.id AND TRIM(a.answer_text) <> '') AS answered_count
    FROM users u WHERE u.role = 'member' ORDER BY u.created_at DESC`).all();
  const totalLessons = db.prepare('SELECT COUNT(*) AS c FROM lessons').get().c;
  res.json({ users, total_lessons: totalLessons });
});

app.get('/api/coach/users/:id', requireCoach, (req, res) => {
  const member = db.prepare("SELECT id, name, email, created_at FROM users WHERE id = ? AND role = 'member'").get(req.params.id);
  if (!member) return res.status(404).json({ error: 'Member not found' });
  const lessons = db.prepare('SELECT id, day, code, title FROM lessons ORDER BY day').all();
  const answers = db.prepare(`
    SELECT f.id AS field_id, f.label, f.field_type, i.id AS item_id, i.instruction,
           l.day, l.code, l.title, a.answer_text, a.updated_at
    FROM lessons l
    JOIN ta_items i ON i.lesson_id = l.id
    JOIN ta_fields f ON f.ta_item_id = i.id
    LEFT JOIN answers a ON a.ta_field_id = f.id AND a.user_id = ?
    ORDER BY l.day, i.sort_order, i.id, f.sort_order, f.id`).all(member.id);
  const done = new Set(db.prepare('SELECT lesson_id FROM progress WHERE user_id = ?').all(member.id).map(r => r.lesson_id));
  const byLesson = lessons.map(l => ({
    ...l,
    completed: done.has(l.id),
    items: [],
  }));
  const map = Object.fromEntries(byLesson.map(l => [l.id, l]));
  // group answers under lessons->items
  const itemMap = {};
  for (const a of answers) {
    const L = byLesson.find(x => x.day === a.day);
    if (!L) continue;
    if (!itemMap[a.item_id]) {
      const entry = { id: a.item_id, instruction: a.instruction, fields: [] };
      itemMap[a.item_id] = entry;
      L.items.push(entry);
    }
    itemMap[a.item_id].fields.push({
      field_id: a.field_id, label: a.label, field_type: a.field_type,
      answer: a.answer_text || '', updated_at: a.updated_at || null,
    });
  }
  // drop lessons with no TA content at all
  res.json({ member, lessons: byLesson });
});

// ---- coach cohorts + live session view ----
app.get('/api/coach/cohorts', requireCoach, (req, res) => {
  const cohorts = db.prepare(`
    SELECT c.id, c.name, c.created_at,
      (SELECT COUNT(*) FROM cohort_members m WHERE m.cohort_id = c.id) AS member_count
    FROM cohorts c ORDER BY c.created_at DESC`).all();
  res.json({ cohorts });
});

app.post('/api/coach/cohorts', requireCoach, (req, res) => {
  const { name } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Cohort name is required' });
  const r = db.prepare('INSERT INTO cohorts (name) VALUES (?)').run(String(name).trim());
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/coach/cohorts/:id', requireCoach, (req, res) => {
  const { name } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Cohort name is required' });
  db.prepare('UPDATE cohorts SET name = ? WHERE id = ?').run(String(name).trim(), req.params.id);
  res.json({ ok: true });
});

app.delete('/api/coach/cohorts/:id', requireCoach, (req, res) => {
  db.prepare('DELETE FROM cohorts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/coach/cohorts/:id', requireCoach, (req, res) => {
  const cohort = db.prepare('SELECT * FROM cohorts WHERE id = ?').get(req.params.id);
  if (!cohort) return res.status(404).json({ error: 'Cohort not found' });
  const members = db.prepare(`
    SELECT u.id, u.name, u.email, u.created_at FROM cohort_members m
    JOIN users u ON u.id = m.user_id
    WHERE m.cohort_id = ? ORDER BY u.name`).all(req.params.id);
  const others = db.prepare(`
    SELECT u.id, u.name, u.email FROM users u
    WHERE u.role = 'member' AND u.id NOT IN (SELECT user_id FROM cohort_members WHERE cohort_id = ?)
    ORDER BY u.name`).all(req.params.id);
  res.json({ cohort, members, others });
});

app.post('/api/coach/cohorts/:id/members', requireCoach, (req, res) => {
  const { user_id } = req.body || {};
  const member = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'member'").get(user_id);
  if (!member) return res.status(404).json({ error: 'Member not found' });
  db.prepare('INSERT OR IGNORE INTO cohort_members (cohort_id, user_id) VALUES (?,?)').run(req.params.id, user_id);
  res.json({ ok: true });
});

app.delete('/api/coach/cohorts/:id/members/:userId', requireCoach, (req, res) => {
  db.prepare('DELETE FROM cohort_members WHERE cohort_id = ? AND user_id = ?').run(req.params.id, req.params.userId);
  res.json({ ok: true });
});

// Live session view: one cohort + one lesson -> every member's answers on one page
app.get('/api/coach/cohorts/:id/live/:day', requireCoach, (req, res) => {
  const cohort = db.prepare('SELECT * FROM cohorts WHERE id = ?').get(req.params.id);
  if (!cohort) return res.status(404).json({ error: 'Cohort not found' });
  const lesson = db.prepare('SELECT id, day, code, title FROM lessons WHERE day = ?').get(Number(req.params.day));
  if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
  const members = db.prepare(`
    SELECT u.id, u.name FROM cohort_members m
    JOIN users u ON u.id = m.user_id
    WHERE m.cohort_id = ? ORDER BY u.name`).all(req.params.id);
  const items = db.prepare('SELECT id, instruction FROM ta_items WHERE lesson_id = ? ORDER BY sort_order, id').all(lesson.id);
  const itemIds = items.map(i => i.id);
  const fields = itemIds.length
    ? db.prepare(`SELECT id, ta_item_id, label, field_type FROM ta_fields WHERE ta_item_id IN (${itemIds.map(() => '?').join(',')}) ORDER BY sort_order, id`).all(...itemIds)
    : [];
  const memberIds = members.map(m => m.id);
  const answers = (memberIds.length && fields.length)
    ? db.prepare(`SELECT user_id, ta_field_id, answer_text FROM answers
        WHERE user_id IN (${memberIds.map(() => '?').join(',')})
        AND ta_field_id IN (${fields.map(() => '?').join(',')})`).all(...memberIds, ...fields.map(f => f.id))
    : [];
  const ansMap = {};
  for (const a of answers) ansMap[a.user_id + ':' + a.ta_field_id] = a.answer_text;
  const doneSet = new Set(
    (memberIds.length
      ? db.prepare(`SELECT user_id FROM progress WHERE lesson_id = ? AND user_id IN (${memberIds.map(() => '?').join(',')})`).all(lesson.id, ...memberIds)
      : []).map(r => r.user_id)
  );
  const itemsOut = items.map(it => ({
    id: it.id,
    instruction: it.instruction,
    fields: fields.filter(f => f.ta_item_id === it.id),
  }));
  const membersOut = members.map(m => {
    const perField = fields.map(f => ({
      field_id: f.id,
      answer: ansMap[m.id + ':' + f.id] || '',
    }));
    const answered = perField.filter(f => f.answer.trim()).length;
    return {
      id: m.id, name: m.name,
      completed: doneSet.has(m.id),
      answered_count: answered,
      field_count: fields.length,
      answers: perField,
    };
  });
  res.json({ cohort, lesson, items: itemsOut, members: membersOut });
});

// ---- coach lesson editor ----
function fullLessons() {
  const lessons = db.prepare('SELECT * FROM lessons ORDER BY day').all();
  return lessons.map(l => ({
    ...l,
    body: JSON.parse(l.body || '[]'),
    ta: db.prepare('SELECT * FROM ta_items WHERE lesson_id = ? ORDER BY sort_order, id').all(l.id).map(it => ({
      ...it,
      fields: db.prepare('SELECT * FROM ta_fields WHERE ta_item_id = ? ORDER BY sort_order, id').all(it.id),
    })),
  }));
}
app.get('/api/coach/lessons', requireCoach, (req, res) => res.json({ lessons: fullLessons() }));

app.post('/api/coach/lessons', requireCoach, (req, res) => {
  const { title, chapter, lesson_num, code, body } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Title is required' });
  const maxDay = db.prepare('SELECT COALESCE(MAX(day),0) AS m FROM lessons').get().m;
  const r = db.prepare(
    'INSERT INTO lessons (day, chapter, lesson_num, code, title, body, sort_order) VALUES (?,?,?,?,?,?,?)'
  ).run(maxDay + 1, Number(chapter) || 0, Number(lesson_num) || 0,
    String(code || ''), String(title).trim(), JSON.stringify(body || []), maxDay + 1);
  res.json({ id: r.lastInsertRowid, day: maxDay + 1 });
});

app.put('/api/coach/lessons/:id', requireCoach, (req, res) => {
  const { title, chapter, lesson_num, code, body } = req.body || {};
  const lesson = db.prepare('SELECT id FROM lessons WHERE id = ?').get(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
  db.prepare('UPDATE lessons SET title=?, chapter=?, lesson_num=?, code=?, body=? WHERE id=?')
    .run(String(title || '').trim(), Number(chapter) || 0, Number(lesson_num) || 0,
      String(code || ''), JSON.stringify(body || []), req.params.id);
  res.json({ ok: true });
});

app.delete('/api/coach/lessons/:id', requireCoach, (req, res) => {
  const r = db.prepare('DELETE FROM lessons WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Lesson not found' });
  res.json({ ok: true });
});

app.post('/api/coach/lessons/:id/items', requireCoach, (req, res) => {
  const lesson = db.prepare('SELECT id FROM lessons WHERE id = ?').get(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
  const maxO = db.prepare('SELECT COALESCE(MAX(sort_order),-1)+1 AS m FROM ta_items WHERE lesson_id = ?').get(req.params.id).m;
  const r = db.prepare('INSERT INTO ta_items (lesson_id, sort_order, instruction) VALUES (?,?,?)')
    .run(req.params.id, maxO, String((req.body || {}).instruction || ''));
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/coach/items/:itemId', requireCoach, (req, res) => {
  const { instruction, sort_order } = req.body || {};
  if (sort_order === undefined) {
    db.prepare('UPDATE ta_items SET instruction = ? WHERE id = ?').run(String(instruction || ''), req.params.itemId);
  } else {
    db.prepare('UPDATE ta_items SET instruction = ?, sort_order = ? WHERE id = ?')
      .run(String(instruction || ''), Number(sort_order) || 0, req.params.itemId);
  }
  res.json({ ok: true });
});

app.delete('/api/coach/items/:itemId', requireCoach, (req, res) => {
  db.prepare('DELETE FROM ta_items WHERE id = ?').run(req.params.itemId);
  res.json({ ok: true });
});

app.post('/api/coach/items/:itemId/fields', requireCoach, (req, res) => {
  const { label, field_type } = req.body || {};
  const maxO = db.prepare('SELECT COALESCE(MAX(sort_order),-1)+1 AS m FROM ta_fields WHERE ta_item_id = ?').get(req.params.itemId).m;
  const r = db.prepare('INSERT INTO ta_fields (ta_item_id, sort_order, label, field_type) VALUES (?,?,?,?)')
    .run(req.params.itemId, maxO, String(label || ''), field_type === 'text' ? 'text' : 'textarea');
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/coach/fields/:fieldId', requireCoach, (req, res) => {
  const { label, field_type, sort_order } = req.body || {};
  if (sort_order === undefined) {
    db.prepare('UPDATE ta_fields SET label = ?, field_type = ? WHERE id = ?')
      .run(String(label || ''), field_type === 'text' ? 'text' : 'textarea', req.params.fieldId);
  } else {
    db.prepare('UPDATE ta_fields SET label = ?, field_type = ?, sort_order = ? WHERE id = ?')
      .run(String(label || ''), field_type === 'text' ? 'text' : 'textarea', Number(sort_order) || 0, req.params.fieldId);
  }
  res.json({ ok: true });
});

app.delete('/api/coach/fields/:fieldId', requireCoach, (req, res) => {
  db.prepare('DELETE FROM ta_fields WHERE id = ?').run(req.params.fieldId);
  res.json({ ok: true });
});

// ---------- static ----------
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// auto-seed lessons on a fresh database
try {
  const n = db.prepare('SELECT COUNT(*) AS c FROM lessons').get().c;
  if (n === 0) {
    console.log('Empty lessons table — seeding from content/lessons.json…');
    require('./seed');
  }
} catch (e) {
  console.error('Auto-seed failed:', e.message);
}

app.listen(PORT, () => console.log(`Reformat app listening on port ${PORT}`));
