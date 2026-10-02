/** Seed lessons from content/lessons.json into the database.
 *  Safe to re-run: matches on lesson.day and replaces body/TA structure,
 *  preserving user answers by matching fields on (lesson, item order, field order). */
const fs = require('fs');
const path = require('path');
const db = require('./db');

const src = path.join(__dirname, '..', 'content', 'lessons.json');
const data = JSON.parse(fs.readFileSync(src, 'utf8'));

const getLesson = db.prepare('SELECT id FROM lessons WHERE day = ?');
const insertLesson = db.prepare(
  `INSERT INTO lessons (day, chapter, lesson_num, code, title, body, sort_order)
   VALUES (@day, @chapter, @lesson_num, @code, @title, @body, @day)`
);
const updateLesson = db.prepare(
  `UPDATE lessons SET chapter=@chapter, lesson_num=@lesson_num, code=@code,
   title=@title, body=@body WHERE id=@id`
);
const delItems = db.prepare('DELETE FROM ta_items WHERE lesson_id = ?');
const insertItem = db.prepare(
  'INSERT INTO ta_items (lesson_id, sort_order, instruction) VALUES (?,?,?)'
);
const insertField = db.prepare(
  'INSERT INTO ta_fields (ta_item_id, sort_order, label, field_type) VALUES (?,?,?,?)'
);

const seed = db.transaction(() => {
  let lessons = 0, items = 0, fields = 0;
  for (const L of data.lessons) {
    const bodyJson = JSON.stringify(L.body || []);
    const row = getLesson.get(L.day);
    let lessonId;
    if (row) {
      updateLesson.run({
        id: row.id, chapter: L.chapter, lesson_num: L.lesson,
        code: L.code, title: L.title, body: bodyJson,
      });
      lessonId = row.id;
      // NOTE: replacing TA structure deletes old items/fields; answers to
      // deleted fields are removed via ON DELETE CASCADE. Only re-seed on a
      // fresh DB or when content intentionally changed.
      delItems.run(lessonId);
    } else {
      const r = insertLesson.run({
        day: L.day, chapter: L.chapter, lesson_num: L.lesson,
        code: L.code, title: L.title, body: bodyJson,
      });
      lessonId = r.lastInsertRowid;
    }
    (L.ta || []).forEach((it, ii) => {
      const ir = insertItem.run(lessonId, ii, it.instruction || '');
      items++;
      (it.fields || []).forEach((f, fi) => {
        insertField.run(ir.lastInsertRowid, fi, f.label || '', f.type === 'text' ? 'text' : 'textarea');
        fields++;
      });
    });
    lessons++;
  }
  return { lessons, items, fields };
});

const result = seed();
console.log(`Seeded ${result.lessons} lessons, ${result.items} TA items, ${result.fields} fields.`);
