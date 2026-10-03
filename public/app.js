/* Reformat Your Brain in 28 Days — SPA */
const view = document.getElementById('view');
const whoEl = document.getElementById('who');
const navBtn = document.getElementById('navBtn');
let state = { user: null, unlockedDay: 1 };

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

async function api(method, path, body) {
  const r = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = {};
  try { data = await r.json(); } catch (e) { /* empty */ }
  if (!r.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}
const GET = (p) => api('GET', p);
const POST = (p, b) => api('POST', p, b);
const PUT = (p, b) => api('PUT', p, b);
const DEL = (p) => api('DELETE', p);

/* ---------- markup <-> blocks ---------- */
function blocksToMarkup(blocks) {
  return (blocks || []).map(b => {
    if (b.type === 'ul') return b.items.map(i => '- ' + i).join('\n');
    if (b.type === 'ol') return b.items.map((i, x) => (x + 1) + '. ' + i).join('\n');
    return b.text || '';
  }).join('\n\n');
}
function markupToBlocks(text) {
  const blocks = [];
  for (const chunk of String(text || '').split(/\n\s*\n/)) {
    const lines = chunk.split('\n').map(s => s.trim()).filter(Boolean);
    if (!lines.length) continue;
    if (lines.every(l => /^-\s+/.test(l)))
      blocks.push({ type: 'ul', items: lines.map(l => l.replace(/^-\s+/, '')) });
    else if (lines.every(l => /^\d+[.)]\s+/.test(l)))
      blocks.push({ type: 'ol', items: lines.map(l => l.replace(/^\d+[.)]\s+/, '')) });
    else
      blocks.push({ type: 'p', text: lines.join(' ') });
  }
  return blocks;
}
function renderBlocks(blocks) {
  return (blocks || []).map(b => {
    if (b.type === 'ul') return '<ul>' + b.items.map(i => '<li>' + esc(i) + '</li>').join('') + '</ul>';
    if (b.type === 'ol') return '<ol>' + b.items.map(i => '<li>' + esc(i) + '</li>').join('') + '</ol>';
    return '<p>' + esc(b.text) + '</p>';
  }).join('');
}

/* ---------- topbar ---------- */
function renderTop() {
  if (state.user) {
    whoEl.textContent = state.user.name + (state.user.role === 'coach' ? ' (Trainer)' : '');
    navBtn.style.display = '';
    navBtn.textContent = state.user.role === 'coach' ? 'Coach home' : 'Sign out';
    navBtn.onclick = () => {
      if (state.user.role === 'coach') location.hash = '#/coach';
      else doLogout();
    };
  } else {
    whoEl.textContent = '';
    navBtn.style.display = 'none';
  }
}
async function doLogout() {
  await POST('/api/logout', {});
  state.user = null;
  location.hash = '#/login';
}
document.getElementById('brand').onclick = () => { location.hash = '#/'; };

async function boot() {
  try {
    const d = await GET('/api/me');
    state.user = d.user;
    state.unlockedDay = d.unlocked_day;
  } catch (e) { state.user = null; }
  renderTop();
  route();
}
window.addEventListener('hashchange', route);

function route() {
  renderTop();
  const h = location.hash || '#/';
  if (!state.user) {
    if (h.startsWith('#/signup')) return vSignup();
    return vLogin();
  }
  const mLesson = h.match(/^#\/lesson\/(\d+)$/);
  const mMember = h.match(/^#\/coach\/member\/(\d+)$/);
  const mEdit = h.match(/^#\/coach\/lessons\/edit\/(\d+)$/);
  const mCohort = h.match(/^#\/coach\/cohorts\/(\d+)$/);
  const mLive = h.match(/^#\/coach\/cohorts\/(\d+)\/live\/(\d+)$/);
  if (mLesson) return vLesson(Number(mLesson[1]));
  if (h === '#/coach' && state.user.role === 'coach') return vCoach();
  if (mMember && state.user.role === 'coach') return vCoachMember(Number(mMember[1]));
  if (h === '#/coach/lessons' && state.user.role === 'coach') return vCoachLessons();
  if (h === '#/coach/lessons/new' && state.user.role === 'coach') return vLessonEdit(null);
  if (mEdit && state.user.role === 'coach') return vLessonEdit(Number(mEdit[1]));
  if (h === '#/coach/cohorts' && state.user.role === 'coach') return vCohorts();
  if (mCohort && state.user.role === 'coach') return vCohortDetail(Number(mCohort[1]));
  if (mLive && state.user.role === 'coach') return vLiveView(Number(mLive[1]), Number(mLive[2]));
  return vDashboard();
}

/* ---------- auth views ---------- */
function vLogin() {
  view.innerHTML = `
    <div class="card auth-card">
      <h1 class="center">Reformat Your Brain<br><span class="muted" style="font-size:18px">in 28 Days</span></h1>
      <p class="muted center">Sign in to continue your program.</p>
      <div class="error" id="err" style="display:none"></div>
      <div class="field"><label>Email</label><input id="email" type="email" autocomplete="email"></div>
      <div class="field"><label>Password</label><input id="pw" type="password" autocomplete="current-password"></div>
      <button class="btn" id="go" style="width:100%">Sign in</button>
      <p class="center mt">New here? <a href="#/signup">Create an account</a></p>
    </div>`;
  const fail = (m) => { const e = document.getElementById('err'); e.style.display = ''; e.textContent = m; };
  document.getElementById('go').onclick = async () => {
    try {
      const d = await POST('/api/login', {
        email: document.getElementById('email').value,
        password: document.getElementById('pw').value,
      });
      state.user = d.user;
      location.hash = '#/';
    } catch (e) { fail(e.message); }
  };
}

function vSignup() {
  view.innerHTML = `
    <div class="card auth-card">
      <h1 class="center">Create your account</h1>
      <p class="muted center">Your 28-day journey starts today.</p>
      <div class="error" id="err" style="display:none"></div>
      <div class="field"><label>Full name</label><input id="name" autocomplete="name"></div>
      <div class="field"><label>Email</label><input id="email" type="email" autocomplete="email"></div>
      <div class="field"><label>Password (min 8 characters)</label><input id="pw" type="password" autocomplete="new-password"></div>
      <div class="field"><label>Trainer code <span class="hint">(only if you're a trainer)</span></label><input id="cc" autocomplete="off" placeholder="Leave blank for members"></div>
      <button class="btn" id="go" style="width:100%">Create account</button>
      <p class="center mt">Already have one? <a href="#/login">Sign in</a></p>
    </div>`;
  const fail = (m) => { const e = document.getElementById('err'); e.style.display = ''; e.textContent = m; };
  document.getElementById('go').onclick = async () => {
    try {
      const d = await POST('/api/signup', {
        name: document.getElementById('name').value,
        email: document.getElementById('email').value,
        password: document.getElementById('pw').value,
        coach_code: document.getElementById('cc').value,
      });
      state.user = d.user;
      location.hash = '#/';
    } catch (e) { fail(e.message); }
  };
}

/* ---------- member dashboard ---------- */
async function vDashboard() {
  view.innerHTML = '<div class="card"><p class="muted">Loading your program…</p></div>';
  const d = await GET('/api/lessons');
  state.unlockedDay = d.unlocked_day;
  const lessons = d.lessons;
  const done = lessons.filter(l => l.completed).length;
  const isCoach = state.user.role === 'coach';
  const nextUp = lessons.find(l => !l.locked && !l.completed);

  view.innerHTML = `
    <div class="card">
      <div class="progress-hero">
        <div class="progress-ring">${done}<span style="font-size:16px;color:var(--muted)">/${lessons.length}</span></div>
        <div>
          <h2 style="margin:0">Welcome back, ${esc(state.user.name.split(' ')[0])}</h2>
          <div class="muted">${isCoach
            ? 'Trainer view — every lesson is open. Click any day to preview it.'
            : (nextUp ? `Today's work: <b>Day ${nextUp.day}</b> — ${esc(nextUp.title)}`
                      : 'You finished all 28 days. Incredible work.')}</div>
        </div>
      </div>
      ${!isCoach && nextUp ? `<div class="mt"><button class="btn" onclick="location.hash='#/lesson/${nextUp.day}'">Continue: Day ${nextUp.day}</button></div>` : ''}
    </div>
    <div class="day-grid">
      ${lessons.map(l => `
        <button class="day-card ${l.locked ? 'locked' : ''} ${l.completed ? 'done' : ''} ${nextUp && l.day === nextUp.day ? 'current' : ''}"
                ${l.locked ? 'disabled' : `onclick="location.hash='#/lesson/${l.day}'"`}>
          <div class="d">Day ${l.day}${l.locked ? ' 🔒' : ''}</div>
          <div class="t">${esc(l.title)}</div>
          <div class="st">${l.completed ? '✓ Completed' : l.locked ? 'Unlocks day ' + l.day : (l.code || '')}</div>
        </button>`).join('')}
    </div>`;
}

/* ---------- lesson view ---------- */
let saveTimer = null;
async function vLesson(day) {
  view.innerHTML = '<div class="card"><p class="muted">Loading lesson…</p></div>';
  let d;
  try { d = await GET('/api/lessons/' + day); }
  catch (e) {
    view.innerHTML = `<div class="card"><div class="error">${esc(e.message)}</div>
      <button class="btn secondary" onclick="location.hash='#/'">Back to dashboard</button></div>`;
    return;
  }
  const L = d.lesson, isCoach = state.user.role === 'coach';
  const prevDay = day - 1, nextDay = day + 1;

  view.innerHTML = `
    <div class="card lesson-head">
      <div class="kicker">Day ${L.day} ${L.code ? '· ' + esc(L.code) : ''} ${L.chapter ? '· Chapter ' + L.chapter : ''}</div>
      <h1>${esc(L.title)}</h1>
      ${isCoach ? '<div class="hint">Trainer preview — members unlock this on day ' + L.day + '.</div>' : ''}
    </div>
    <div class="card"><div class="lesson-body">${renderBlocks(L.body)}</div></div>
    ${d.ta.length ? `
    <div class="card ta">
      <div class="ta-title">Take Action Now</div>
      <div class="hint">Your answers save automatically and ${isCoach ? 'are visible to you as the trainer' : 'only you and your trainer can see them'}.</div>
      ${d.ta.map(it => `
        <div class="ta-item">
          ${it.instruction ? `<div class="instr">${esc(it.instruction)}</div>` : ''}
          ${it.fields.map(f => `
            ${f.label ? `<div class="flabel">${esc(f.label)}</div>` : ''}
            ${f.field_type === 'text'
              ? `<input type="text" data-fid="${f.id}" value="${esc(f.answer)}" placeholder="Type your answer…">`
              : `<textarea data-fid="${f.id}" placeholder="Write your answer…">${esc(f.answer)}</textarea>`}
          `).join('')}
        </div>`).join('')}
      <div class="row mt">
        <button class="btn" id="saveBtn">Save answers</button>
        <span class="save-note" id="saveNote"></span>
      </div>
      <div class="complete-bar ${d.completed ? 'done' : ''} mt">
        <input type="checkbox" id="doneBox" ${d.completed ? 'checked' : ''} style="width:20px;height:20px">
        <label for="doneBox"><b>${d.completed ? 'Day ' + L.day + ' complete — nice work.' : 'Mark Day ' + L.day + ' complete'}</b></label>
      </div>
    </div>` : `
    <div class="card"><p class="muted">No Take Action Now questions on this lesson yet — check back soon.</p>
      <div class="complete-bar ${d.completed ? 'done' : ''}">
        <input type="checkbox" id="doneBox" ${d.completed ? 'checked' : ''} style="width:20px;height:20px">
        <label for="doneBox"><b>${d.completed ? 'Day ' + L.day + ' complete.' : 'Mark Day ' + L.day + ' complete'}</b></label>
      </div>
    </div>`}
    <div class="lesson-nav">
      <button class="btn secondary" id="prevBtn" ${prevDay < 1 ? 'disabled' : ''}>← Day ${prevDay}</button>
      <button class="btn secondary" onclick="location.hash='#/'">All days</button>
      <button class="btn secondary" id="nextBtn">Day ${nextDay} →</button>
    </div>`;

  const collect = () => [...view.querySelectorAll('[data-fid]')].map(el => ({ field_id: Number(el.dataset.fid), text: el.value }));
  const note = (m) => { document.getElementById('saveNote').textContent = m; };
  const saveBtn = document.getElementById('saveBtn');
  if (saveBtn) saveBtn.onclick = async () => {
    note('Saving…');
    try { await POST('/api/answers', { answers: collect() }); note('Saved ✓ ' + new Date().toLocaleTimeString()); }
    catch (e) { note('Save failed: ' + e.message); }
  };
  // autosave on blur
  view.querySelectorAll('[data-fid]').forEach(el => {
    el.addEventListener('change', async () => {
      note('Saving…');
      try { await POST('/api/answers', { answers: collect() }); note('Saved ✓'); }
      catch (e) { note('Save failed'); }
    });
  });
  const doneBox = document.getElementById('doneBox');
  if (doneBox) doneBox.onchange = async () => {
    try {
      if (doneBox.checked) await POST(`/api/lessons/${day}/complete`, {});
      else await DEL(`/api/lessons/${day}/complete`);
      vLesson(day);
    } catch (e) { alert(e.message); doneBox.checked = !doneBox.checked; }
  };
  document.getElementById('prevBtn').onclick = () => { if (prevDay >= 1) location.hash = '#/lesson/' + prevDay; };
  document.getElementById('nextBtn').onclick = async () => {
    try { await GET('/api/lessons/' + nextDay); location.hash = '#/lesson/' + nextDay; }
    catch (e) { alert(e.message); }
  };
}

/* ---------- coach: members ---------- */
async function vCoach() {
  view.innerHTML = '<div class="card"><p class="muted">Loading…</p></div>';
  const d = await GET('/api/coach/users');
  const t = await GET('/api/coach/trainers');
  view.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between">
        <h2 style="margin:0">Trainer dashboard</h2>
        <div class="row">
          <button class="btn secondary small" onclick="location.hash='#/coach/lessons'">Edit lessons</button>
          <button class="btn ghost small" style="color:var(--navy);border-color:var(--line)" id="logoutBtn">Sign out</button>
        </div>
      </div>
      <p class="muted">${d.users.length} member${d.users.length === 1 ? '' : 's'} · ${d.total_lessons} lessons in the program</p>
    </div>
    <div class="card">
      <div class="tabs">
        <button class="active">Members</button>
        <button onclick="location.hash='#/coach/cohorts'">Cohorts</button>
        <button onclick="location.hash='#/coach/lessons'">Lessons</button>
      </div>
      ${d.users.length ? `
      <table class="tbl"><thead><tr>
        <th>Member</th><th>Joined</th><th>Progress</th><th>Answers</th><th></th>
      </tr></thead><tbody>
        ${d.users.map(u => `
          <tr>
            <td><b>${esc(u.name)}</b><br><span class="hint">${esc(u.email)}</span></td>
            <td>${new Date(u.created_at * 1000).toLocaleDateString()}</td>
            <td><span class="pill">${u.completed_count}/${d.total_lessons}</span></td>
            <td>${u.answered_count}</td>
            <td style="white-space:nowrap">
              <button class="btn small secondary" onclick="location.hash='#/coach/member/${u.id}'">View answers</button>
              <button class="btn small danger" data-del-user="${u.id}" data-del-name="${esc(u.name)}">Remove</button>
            </td>
          </tr>`).join('')}
      </tbody></table>` : '<p class="muted">No members yet. Share your link and they will appear here when they sign up.</p>'}
    </div>
    <div class="card">
      <h3 style="margin-top:0">Trainers</h3>
      <table class="tbl"><tbody>
        ${t.trainers.map(x => `
          <tr><td><b>${esc(x.name)}</b><br><span class="hint">${esc(x.email)}</span></td>
          <td style="text-align:right">${x.id === t.self_id
            ? '<span class="hint">you</span>'
            : `<button class="btn small danger" data-del-trainer="${x.id}" data-del-name="${esc(x.name)}">Remove</button>`}</td></tr>`).join('')}
      </tbody></table>
    </div>`;
  document.getElementById('logoutBtn').onclick = doLogout;
  const wireRemove = (sel) => view.querySelectorAll(sel).forEach(b => b.onclick = async () => {
    if (!confirm(`Remove ${b.dataset.delName}? Their account and answers will be permanently deleted.`)) return;
    try {
      const id = b.dataset.delUser || b.dataset.delTrainer;
      await DEL('/api/coach/users/' + id);
      vCoach();
    } catch (e) { alert(e.message); }
  });
  wireRemove('[data-del-user]');
  wireRemove('[data-del-trainer]');
}

async function vCoachMember(id) {
  view.innerHTML = '<div class="card"><p class="muted">Loading…</p></div>';
  const d = await GET('/api/coach/users/' + id);
  const m = d.member;
  view.innerHTML = `
    <div class="card">
      <button class="btn secondary small" onclick="location.hash='#/coach'">← All members</button>
      <h2 class="mt">${esc(m.name)}</h2>
      <dl class="kv">
        <dt>Email</dt><dd>${esc(m.email)}</dd>
        <dt>Started</dt><dd>${new Date(m.created_at * 1000).toLocaleDateString()}</dd>
      </dl>
    </div>
    ${d.lessons.map(l => `
      <div class="card">
        <div class="row" style="justify-content:space-between">
          <b>Day ${l.day} · ${esc(l.title)}</b>
          ${l.completed ? '<span class="pill">Completed</span>' : '<span class="hint">Not completed</span>'}
        </div>
        ${l.items.length ? l.items.map(it => `
          <div class="mt">
            ${it.instruction ? `<div class="hint" style="font-weight:700;color:var(--ink)">${esc(it.instruction)}</div>` : ''}
            ${it.fields.map(f => `
              ${f.label ? `<div class="hint" style="margin-top:8px">${esc(f.label)}</div>` : ''}
              <div class="answer ${f.answer.trim() ? '' : 'empty'}">${f.answer.trim() ? esc(f.answer) : 'No answer yet'}</div>
            `).join('')}
          </div>`).join('') : '<p class="hint">No Take Action Now on this lesson.</p>'}
      </div>`).join('')}`;
}

/* ---------- coach: lesson editor ---------- */
async function vCoachLessons() {
  view.innerHTML = '<div class="card"><p class="muted">Loading…</p></div>';
  const d = await GET('/api/coach/lessons');
  view.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between">
        <h2 style="margin:0">Lessons</h2>
        <div class="row">
          <button class="btn small" onclick="location.hash='#/coach/lessons/new'">+ Add lesson</button>
          <button class="btn secondary small" onclick="location.hash='#/coach'">Members</button>
          <button class="btn secondary small" onclick="location.hash='#/coach/cohorts'">Cohorts</button>
        </div>
      </div>
      <p class="hint">New lessons are added at the end (Day ${d.lessons.length + 1}). Members unlock one day at a time from signup.</p>
    </div>
    <div class="card">
      <table class="tbl"><thead><tr><th>Day</th><th>Lesson</th><th>Take Action items</th><th></th></tr></thead>
      <tbody>${d.lessons.map(l => `
        <tr>
          <td><b>${l.day}</b></td>
          <td>${l.code ? esc(l.code) + ' · ' : ''}${esc(l.title)}</td>
          <td>${l.ta.length}</td>
          <td style="white-space:nowrap">
            <button class="btn small secondary" onclick="location.hash='#/lesson/${l.day}'">Preview</button>
            <button class="btn small" onclick="location.hash='#/coach/lessons/edit/${l.id}'">Edit</button>
          </td>
        </tr>`).join('')}
      </tbody></table>
    </div>`;
}

let editorState = null;
async function vLessonEdit(id) {
  view.innerHTML = '<div class="card"><p class="muted">Loading editor…</p></div>';
  let lesson = null;
  if (id) {
    const d = await GET('/api/coach/lessons');
    lesson = d.lessons.find(l => l.id === id);
    if (!lesson) { view.innerHTML = '<div class="card"><div class="error">Lesson not found</div></div>'; return; }
  }
  editorState = {
    id: id,
    title: lesson ? lesson.title : '',
    chapter: lesson ? lesson.chapter : '',
    lesson_num: lesson ? lesson.lesson_num : '',
    code: lesson ? lesson.code : '',
    bodyMarkup: lesson ? blocksToMarkup(lesson.body) : '',
    items: lesson ? lesson.ta.map(it => ({
      id: it.id, instruction: it.instruction || '',
      fields: it.fields.map(f => ({ id: f.id, label: f.label || '', field_type: f.field_type })),
      deleted: false,
    })) : [],
    deletedItems: [],
    deletedFields: [],
  };
  renderEditor();
}

function renderEditor() {
  const e = editorState;
  view.innerHTML = `
    <div class="card">
      <button class="btn secondary small" onclick="location.hash='#/coach/lessons'">← Lessons</button>
      <h2 class="mt">${e.id ? 'Edit lesson' : 'New lesson'}</h2>
      <div class="error" id="err" style="display:none"></div>
      <div class="field"><label>Lesson title</label><input id="f_title" value="${esc(e.title)}"></div>
      <div class="row">
        <div class="field" style="flex:1"><label>Chapter</label><input id="f_chapter" value="${esc(e.chapter)}"></div>
        <div class="field" style="flex:1"><label>Lesson #</label><input id="f_lessonnum" value="${esc(e.lesson_num)}"></div>
        <div class="field" style="flex:1"><label>Code (e.g. Ch 1-1)</label><input id="f_code" value="${esc(e.code)}"></div>
      </div>
      <div class="field"><label>Lesson text</label>
        <textarea id="f_body" style="min-height:220px">${esc(e.bodyMarkup)}</textarea>
        <div class="markup-help">Blank line = new paragraph &nbsp;·&nbsp; lines starting with <b>- </b> = bullet list &nbsp;·&nbsp; lines starting with <b>1. </b> = numbered list</div>
      </div>
    </div>
    <div class="card">
      <h3 style="margin-top:0">Take Action Now</h3>
      <div id="items"></div>
      <button class="btn secondary small" id="addItem">+ Add question</button>
    </div>
    <div class="row">
      <button class="btn" id="saveLesson">Save lesson</button>
      <span class="save-note" id="saveNote"></span>
      ${e.id ? '<button class="btn danger small" id="delLesson" style="margin-left:auto">Delete lesson</button>' : ''}
    </div>`;
  const itemsEl = document.getElementById('items');
  const drawItems = () => {
    itemsEl.innerHTML = '';
    e.items.forEach((it, ix) => {
      if (it.deleted) return;
      const div = document.createElement('div');
      div.className = 'editor-ta';
      div.innerHTML = `
        <div class="row" style="justify-content:space-between">
          <b>Question ${ix + 1}</b>
          <button class="btn danger small" data-del-item="${ix}">Remove</button>
        </div>
        <div class="field"><label>Instruction / question text</label>
          <textarea data-instr="${ix}" style="min-height:70px">${esc(it.instruction)}</textarea></div>
        <div data-fields="${ix}"></div>
        <button class="btn secondary small" data-add-field="${ix}">+ Add answer field</button>`;
      itemsEl.appendChild(div);
      const fEl = div.querySelector(`[data-fields="${ix}"]`);
      it.fields.forEach((f, fx) => {
        if (f.deleted) return;
        const fr = document.createElement('div');
        fr.className = 'row';
        fr.style.marginTop = '8px';
        fr.innerHTML = `
          <input data-flabel="${ix}.${fx}" value="${esc(f.label)}" placeholder="Field label (optional)" style="flex:2;padding:8px 10px;border:1.5px solid var(--line);border-radius:8px">
          <select data-ftype="${ix}.${fx}" style="padding:8px;border:1.5px solid var(--line);border-radius:8px">
            <option value="textarea" ${f.field_type === 'textarea' ? 'selected' : ''}>Long answer</option>
            <option value="text" ${f.field_type === 'text' ? 'selected' : ''}>Short answer</option>
          </select>
          <button class="btn danger small" data-del-field="${ix}.${fx}">✕</button>`;
        fEl.appendChild(fr);
      });
    });
    // wire events
    itemsEl.querySelectorAll('[data-del-item]').forEach(b => b.onclick = () => {
      const ix = Number(b.dataset.delItem);
      if (e.items[ix].id) e.deletedItems.push(e.items[ix].id);
      e.items[ix].deleted = true; drawItems();
    });
    itemsEl.querySelectorAll('[data-add-field]').forEach(b => b.onclick = () => {
      e.items[Number(b.dataset.addField)].fields.push({ id: null, label: '', field_type: 'textarea' });
      drawItems();
    });
    itemsEl.querySelectorAll('[data-del-field]').forEach(b => b.onclick = () => {
      const [ix, fx] = b.dataset.delField.split('.').map(Number);
      const f = e.items[ix].fields[fx];
      if (f.id) e.deletedFields.push(f.id);
      f.deleted = true; drawItems();
    });
    itemsEl.querySelectorAll('[data-instr]').forEach(t => t.oninput = () => {
      e.items[Number(t.dataset.instr)].instruction = t.value;
    });
    itemsEl.querySelectorAll('[data-flabel]').forEach(t => t.oninput = () => {
      const [ix, fx] = t.dataset.flabel.split('.').map(Number);
      e.items[ix].fields[fx].label = t.value;
    });
    itemsEl.querySelectorAll('[data-ftype]').forEach(s => s.onchange = () => {
      const [ix, fx] = s.dataset.ftype.split('.').map(Number);
      e.items[ix].fields[fx].field_type = s.value;
    });
  };
  drawItems();
  document.getElementById('addItem').onclick = () => {
    e.items.push({ id: null, instruction: '', fields: [], deleted: false });
    drawItems();
  };
  const fail = (m) => { const el = document.getElementById('err'); el.style.display = ''; el.textContent = m; };
  const note = (m) => { document.getElementById('saveNote').textContent = m; };
  document.getElementById('saveLesson').onclick = async () => {
    note('Saving…');
    try {
      const payload = {
        title: document.getElementById('f_title').value,
        chapter: document.getElementById('f_chapter').value,
        lesson_num: document.getElementById('f_lessonnum').value,
        code: document.getElementById('f_code').value,
        body: markupToBlocks(document.getElementById('f_body').value),
      };
      let lessonId = e.id;
      if (!lessonId) {
        const r = await POST('/api/coach/lessons', payload);
        lessonId = r.id; e.id = lessonId;
      } else {
        await PUT('/api/coach/lessons/' + lessonId, payload);
      }
      // delete removed fields/items first
      for (const fid of e.deletedFields) await DEL('/api/coach/fields/' + fid);
      for (const iid of e.deletedItems) await DEL('/api/coach/items/' + iid);
      e.deletedFields = []; e.deletedItems = [];
      // upsert items + fields in order
      let order = 0;
      for (const it of e.items) {
        if (it.deleted) continue;
        let itemId = it.id;
        if (!itemId) {
          const r = await POST(`/api/coach/lessons/${lessonId}/items`, { instruction: it.instruction });
          itemId = r.id; it.id = itemId;
        } else {
          await PUT('/api/coach/items/' + itemId, { instruction: it.instruction, sort_order: order });
        }
        let fOrder = 0;
        for (const f of it.fields) {
          if (f.deleted) continue;
          if (!f.id) {
            const r = await POST(`/api/coach/items/${itemId}/fields`, { label: f.label, field_type: f.field_type });
            f.id = r.id;
          } else {
            await PUT('/api/coach/fields/' + f.id, { label: f.label, field_type: f.field_type, sort_order: fOrder });
          }
          fOrder++;
        }
        order++;
      }
      note('Saved ✓');
    } catch (err) { fail(err.message); note(''); }
  };
  const delBtn = document.getElementById('delLesson');
  if (delBtn) delBtn.onclick = async () => {
    if (!confirm('Delete this lesson and all its questions? Member answers to it will be removed too.')) return;
    await DEL('/api/coach/lessons/' + e.id);
    location.hash = '#/coach/lessons';
  };
}

/* ---------- coach: cohorts + live session view ---------- */
async function vCohorts() {
  view.innerHTML = '<div class="card"><p class="muted">Loading…</p></div>';
  const d = await GET('/api/coach/cohorts');
  view.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between">
        <h2 style="margin:0">Cohorts</h2>
        <button class="btn secondary small" onclick="location.hash='#/coach'">Members</button>
      </div>
      <p class="hint">Group members into cohorts (e.g. "October group"). Open a cohort, pick a lesson, and get the live session view: everyone's answers on one scrolling page.</p>
      <div class="row">
        <input id="newName" placeholder="New cohort name…" style="flex:1;padding:10px 12px;border:1.5px solid var(--line);border-radius:10px;font:inherit">
        <button class="btn" id="createBtn">Create cohort</button>
      </div>
    </div>
    <div class="card">
      ${d.cohorts.length ? `
      <table class="tbl"><thead><tr><th>Cohort</th><th>Members</th><th></th></tr></thead><tbody>
        ${d.cohorts.map(c => `
          <tr>
            <td><b>${esc(c.name)}</b></td>
            <td>${c.member_count}</td>
            <td style="text-align:right;white-space:nowrap">
              <button class="btn small" onclick="location.hash='#/coach/cohorts/${c.id}'">Open</button>
              <button class="btn small danger" data-del-cohort="${c.id}">Delete</button>
            </td>
          </tr>`).join('')}
      </tbody></table>` : '<p class="muted">No cohorts yet — create your first one above.</p>'}
    </div>`;
  document.getElementById('createBtn').onclick = async () => {
    const name = document.getElementById('newName').value;
    if (!name.trim()) return;
    const r = await POST('/api/coach/cohorts', { name });
    location.hash = '#/coach/cohorts/' + r.id;
  };
  view.querySelectorAll('[data-del-cohort]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this cohort? Members keep their accounts.')) return;
    await DEL('/api/coach/cohorts/' + b.dataset.delCohort);
    vCohorts();
  });
}

async function vCohortDetail(id) {
  view.innerHTML = '<div class="card"><p class="muted">Loading…</p></div>';
  const d = await GET('/api/coach/cohorts/' + id);
  const lessons = (await GET('/api/coach/lessons')).lessons;
  view.innerHTML = `
    <div class="card">
      <button class="btn secondary small" onclick="location.hash='#/coach/cohorts'">← Cohorts</button>
      <div class="row mt" style="justify-content:space-between">
        <h2 style="margin:0">${esc(d.cohort.name)}</h2>
        <button class="btn secondary small" id="renameBtn">Rename</button>
      </div>
      <p class="hint">${d.members.length} member${d.members.length === 1 ? '' : 's'}</p>
      <div class="card" style="background:#f8fafc">
        <b>Live session view</b>
        <p class="hint">Pick the lesson you're covering live. You'll get one scrolling page with every member's name and their Take Action Now answers.</p>
        <div class="row">
          <select id="liveDay" style="flex:1;padding:10px;border:1.5px solid var(--line);border-radius:10px;font:inherit">
            ${lessons.map(l => `<option value="${l.day}">Day ${l.day} — ${esc(l.title)}</option>`).join('')}
          </select>
          <button class="btn" id="liveBtn">Open live view</button>
        </div>
      </div>
    </div>
    <div class="card">
      <h3 style="margin-top:0">Members</h3>
      ${d.members.length ? `
      <table class="tbl"><tbody>
        ${d.members.map(m => `
          <tr><td><b>${esc(m.name)}</b><br><span class="hint">${esc(m.email)}</span></td>
          <td style="text-align:right;white-space:nowrap">
            <button class="btn small secondary" onclick="location.hash='#/coach/member/${m.id}'">Answers</button>
            <button class="btn small danger" data-rm="${m.id}">Remove</button>
          </td></tr>`).join('')}
      </tbody></table>` : '<p class="muted">No members in this cohort yet.</p>'}
      <h3>Add member</h3>
      ${d.others.length ? `
      <div class="row">
        <select id="addSel" style="flex:1;padding:10px;border:1.5px solid var(--line);border-radius:10px;font:inherit">
          ${d.others.map(m => `<option value="${m.id}">${esc(m.name)} (${esc(m.email)})</option>`).join('')}
        </select>
        <button class="btn" id="addBtn">Add to cohort</button>
      </div>` : '<p class="hint">Everyone is already in this cohort.</p>'}
    </div>`;
  document.getElementById('renameBtn').onclick = async () => {
    const name = prompt('Cohort name:', d.cohort.name);
    if (name && name.trim()) { await PUT('/api/coach/cohorts/' + id, { name }); vCohortDetail(id); }
  };
  document.getElementById('liveBtn').onclick = () => {
    location.hash = `#/coach/cohorts/${id}/live/` + document.getElementById('liveDay').value;
  };
  const addBtn = document.getElementById('addBtn');
  if (addBtn) addBtn.onclick = async () => {
    await POST(`/api/coach/cohorts/${id}/members`, { user_id: Number(document.getElementById('addSel').value) });
    vCohortDetail(id);
  };
  view.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => {
    await DEL(`/api/coach/cohorts/${id}/members/` + b.dataset.rm);
    vCohortDetail(id);
  });
}

let liveFilter = 'all';
let liveExpanded = null; // "memberId:fieldId" of expanded cell
async function vLiveView(cohortId, day) {
  view.innerHTML = '<div class="card"><p class="muted">Loading live view…</p></div>';
  const d = await GET(`/api/coach/cohorts/${cohortId}/live/${day}`);
  const doneCount = d.members.filter(m => m.completed).length;
  // flatten fields across items for columns
  const cols = [];
  d.items.forEach(it => it.fields.forEach(f => cols.push({
    field_id: f.id,
    header: f.label || it.instruction || 'Answer',
    instruction: it.instruction || '',
  })));
  const ansOf = (m, fid) => {
    const a = m.answers.find(x => x.field_id === fid);
    return (a && a.answer || '').trim();
  };
  const short = (s, n) => s.length > n ? s.slice(0, n) + '…' : s;

  const draw = () => {
    const list = liveFilter === 'incomplete' ? d.members.filter(m => !m.completed) : d.members;
    view.innerHTML = `
      <div class="card" style="position:sticky;top:64px;z-index:5">
        <button class="btn secondary small" onclick="location.hash='#/coach/cohorts/${cohortId}'">← ${esc(d.cohort.name)}</button>
        <h2 class="mt" style="margin-bottom:4px">Day ${d.lesson.day} — ${esc(d.lesson.title)}</h2>
        <div class="row" style="justify-content:space-between">
          <div><span class="pill">${doneCount}/${d.members.length} completed</span>
          <span class="hint" style="margin-left:8px">${d.cohort.name} · click any cell to expand</span></div>
          <div class="row">
            <button class="btn small ${liveFilter === 'all' ? '' : 'secondary'}" id="fAll">Everyone</button>
            <button class="btn small ${liveFilter === 'incomplete' ? '' : 'secondary'}" id="fInc">Not completed</button>
            <button class="btn small secondary" id="refreshBtn">↻ Refresh</button>
          </div>
        </div>
      </div>
      <div class="card" style="overflow-x:auto;padding:8px">
      ${cols.length ? `
        <table class="tbl live-tbl">
          <thead><tr>
            <th style="position:sticky;left:0;background:#fff;min-width:150px">Member</th>
            ${cols.map(c => `<th title="${esc(c.instruction)}${c.instruction && c.header !== c.instruction ? '\n—\n' + esc(c.header) : ''}"
              style="min-width:180px;max-width:260px">${esc(short(c.header, 60))}</th>`).join('')}
          </tr></thead>
          <tbody>
            ${list.map(m => `
              <tr style="${m.completed ? '' : 'background:#fffbeb'}">
                <td style="position:sticky;left:0;background:${m.completed ? '#fff' : '#fffbeb'}">
                  <b>${esc(m.name)}</b><br>
                  ${m.completed ? '<span class="pill">✓</span>'
                    : `<span class="hint">${m.answered_count}/${m.field_count} answered</span>`}
                </td>
                ${cols.map(c => {
                  const t = ansOf(m, c.field_id);
                  const key = m.id + ':' + c.field_id;
                  const isOpen = liveExpanded === key;
                  return `<td data-cell="${key}" style="cursor:pointer;vertical-align:top">
                    ${t ? `<div>${esc(isOpen ? t : short(t, 90))}</div>
                           ${t.length > 90 && !isOpen ? '<div class="hint">click to expand ▸</div>' : ''}
                           ${isOpen ? '<div class="hint">▾ click to collapse</div>' : ''}`
                        : '<span class="hint">—</span>'}
                  </td>`;
                }).join('')}
              </tr>`).join('')}
          </tbody>
        </table>`
      : '<p class="muted">No Take Action Now questions on this lesson.</p>'}
      </div>`;
    document.getElementById('fAll').onclick = () => { liveFilter = 'all'; draw(); };
    document.getElementById('fInc').onclick = () => { liveFilter = 'incomplete'; draw(); };
    document.getElementById('refreshBtn').onclick = () => vLiveView(cohortId, day);
    view.querySelectorAll('[data-cell]').forEach(td => td.onclick = () => {
      const key = td.dataset.cell;
      liveExpanded = (liveExpanded === key) ? null : key;
      draw();
    });
  };
  draw();
}

boot();
