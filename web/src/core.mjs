export const newId = () => globalThis.crypto?.randomUUID?.() || [...globalThis.crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2, '0')).join('');
export const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const parseWeekday = value => {
  const s = String(value ?? '').trim().toLowerCase().replaceAll('星期', '周');
  const map = { '周一': 1, 'mon': 1, 'monday': 1, '周二': 2, 'tue': 2, 'tuesday': 2, '周三': 3, 'wed': 3, 'wednesday': 3, '周四': 4, 'thu': 4, 'thursday': 4, '周五': 5, 'fri': 5, 'friday': 5, '周六': 6, 'sat': 6, 'saturday': 6, '周日': 7, '周天': 7, 'sun': 7, 'sunday': 7 };
  if (/^[1-7]$/.test(s)) return Number(s);
  return map[s] || null;
};
export const parseTime = value => {
  const m = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return `${String(+m[1]).padStart(2, '0')}:${m[2]}`;
};
export const parseTimeRange = (startValue, endValue) => {
  const range = String(startValue ?? '').match(/^\s*(\d{1,2}:\d{2})\s*[-–~至]\s*(\d{1,2}:\d{2})\s*$/);
  if (range && !String(endValue ?? '').trim()) return [parseTime(range[1]), parseTime(range[2])];
  return [parseTime(startValue), parseTime(endValue)];
};
export const parseWeeks = (start, end) => {
  const startText = String(start ?? '').trim(); const endText = String(end ?? '').trim();
  if (/^\d{1,2}$/.test(startText) && /^\d{1,2}$/.test(endText)) {
    const a = Number(startText); const b = Number(endText);
    return a >= 1 && b <= 30 && a <= b ? [a, b] : null;
  }
  const text = startText || endText;
  const match = text.match(/(\d{1,2})\s*(?:[-–~至]\s*(\d{1,2}))?/);
  if (!match) return null;
  const a = Number(match[1]); const b = Number(match[2] || match[1]);
  return a >= 1 && b <= 30 && a <= b ? [a, b] : null;
};
export function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let quoted = false;
  const input = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"' && quoted && input[i + 1] === '"') { cell += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) { row.push(cell.trim()); cell = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && input[i + 1] === '\n') i++; row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) throw new Error('文件里没有可导入的课程行。');
  const headers = rows[0].map(v => v.toLowerCase().replace(/[\s-]+/g, '_'));
  const aliases = { course_name: ['course_name', '课程名称', '课程名', '课程'], teacher: ['teacher', '教师', '老师'], weekday: ['weekday', '星期', '周几', '上课日'], start_time: ['start_time', '开始时间', '上课时间'], end_time: ['end_time', '结束时间', '下课时间'], start_week: ['start_week', '起始周', '开始周', '周次'], end_week: ['end_week', '结束周', '截止周'], location: ['location', '地点', '教室'], class_name: ['class_name', '班级'], note: ['note', '备注'], semester: ['semester', '学期'] };
  const find = key => headers.findIndex(h => aliases[key].includes(h));
  const idx = Object.fromEntries(Object.keys(aliases).map(key => [key, find(key)]));
  if (idx.course_name < 0 || idx.weekday < 0 || idx.start_time < 0) throw new Error('缺少必需列：course_name（课程名称）、weekday（星期）、start_time（开始时间）。');
  return rows.slice(1).map((cells, i) => {
    const get = key => idx[key] >= 0 ? (cells[idx[key]] || '') : '';
    const line = i + 2; const weekday = parseWeekday(get('weekday')); const [start, end] = parseTimeRange(get('start_time'), get('end_time'));
    const weekRange = parseWeeks(get('start_week'), get('end_week'));
    const weeksCell = idx.start_week >= 0 ? get('start_week') : '';
    const errors = [];
    if (!get('course_name')) errors.push('课程名称为空');
    if (!weekday) errors.push('“星期”字段无法识别');
    if (!start) errors.push('“开始时间”格式无效，应为 HH:MM');
    if (!end) errors.push('缺少或无效的“结束时间”，可填写 HH:MM 或在开始时间中填写时间段');
    if (start && end && end <= start) errors.push('结束时间必须晚于开始时间');
    if (weeksCell && !weekRange) errors.push('“周次”范围无效');
    const weeks = weekRange || [1, 16];
    return { line, errors, course: { id: newId(), course_name: get('course_name'), teacher: get('teacher'), weekday, start_time: start, end_time: end || '', start_week: weeks[0], end_week: weeks[1], location: get('location'), class_name: get('class_name'), note: get('note'), semester: get('semester'), color: '#6675e8', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), deleted_at: null } };
  });
}
export function duplicateCourse(a, b) { return a.course_name.trim().toLowerCase() === b.course_name.trim().toLowerCase() && a.weekday === b.weekday && a.start_time === b.start_time && a.location.trim() === b.location.trim(); }
export function courseReminderOccurrences(courses, { now = new Date(), semesterStartDate = '', weeksWithoutStartDate = 8, leadMinutes = 15, daysAhead = 30 } = {}) {
  const current = new Date(now); const start = semesterStartDate ? new Date(`${semesterStartDate}T00:00:00`) : null;
  const result = [];
  for (const course of courses || []) {
    if (!course || !Number.isInteger(Number(course.weekday)) || !/^\d{2}:\d{2}$/.test(course.start_time || '')) continue;
    const endWeek = start ? Math.max(1, Number(course.end_week) || 30) : weeksWithoutStartDate;
    const limit = Math.min(31 * 7, start ? endWeek * 7 + 7 : weeksWithoutStartDate * 7 + 7, daysAhead);
    for (let offset = 0; offset < limit; offset++) {
      const day = new Date(current); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() + offset);
      const weekday = day.getDay() || 7; if (weekday !== Number(course.weekday)) continue;
      let weekNumber = null;
      if (start) {
        const monday = new Date(start); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
        const courseMonday = new Date(day); courseMonday.setDate(courseMonday.getDate() - ((courseMonday.getDay() + 6) % 7));
        weekNumber = Math.floor((courseMonday - monday) / 604800000) + 1;
        if (weekNumber < Number(course.start_week || 1) || weekNumber > Number(course.end_week || 30)) continue;
      }
      const [hour, minute] = course.start_time.split(':').map(Number); day.setHours(hour, minute, 0, 0);
      const fireAt = new Date(day.getTime() - Math.max(0, Number(leadMinutes) || 15) * 60000);
      if (fireAt <= current) continue;
      result.push({ courseId: course.id, fireAt, classAt: day, weekNumber });
    }
  }
  return result.sort((a, b) => a.fireAt - b.fireAt);
}
export function parsePlatformAssignment(title, body, now = new Date()) {
  const cleanTitle = String(title || '').trim().slice(0, 160);
  const cleanBody = String(body || '').trim().slice(0, 2000);
  const text = `${cleanTitle}\n${cleanBody}`.trim();
  if (!text || !/(作业|任务|测验|考试|提交|截止|课程设计|实验报告)/.test(text)) return null;
  const genericTitle = /^(通知|消息|新消息|作业通知|学习通通知|超星通知|智慧树通知)$/i.test(cleanTitle);
  const assignment = cleanBody.match(/(?:作业|任务|测验|考试)\s*[:：]\s*([^\n]+)/);
  let taskTitle = cleanTitle;
  if (genericTitle && assignment) {
    taskTitle = assignment[1].trim().replace(/[。；;]+$/, '').replace(/^《([^》]+)》\s*(.*)$/, (_, course, detail) => `${course}${detail ? ` ${detail}` : ''}`);
  } else if (genericTitle && cleanBody) {
    taskTitle = cleanBody.split(/[\n。；;]/, 1)[0].trim().slice(0, 160) || cleanTitle;
  }
  const dueMatch = text.match(/(?:(\d{4})[年/-])?(\d{1,2})[月/-](\d{1,2})[日号]?(?:\s*(\d{1,2}):(\d{2}))?/)
    || text.match(/(今天|明天|后天)(?:\s*(\d{1,2}):(\d{2}))?/);
  let dueAt = null;
  if (dueMatch) {
    let date;
    const relative = /^(今天|明天|后天)$/.test(dueMatch[1] || '');
    if (relative) { date = new Date(now); date.setDate(date.getDate() + ({ 今天: 0, 明天: 1, 后天: 2 }[dueMatch[1]])); }
    else { const year = Number(dueMatch[1]) || new Date(now).getFullYear(); date = new Date(year, Number(dueMatch[2]) - 1, Number(dueMatch[3])); }
    const hour = relative ? dueMatch[2] : dueMatch[4]; const minute = relative ? dueMatch[3] : dueMatch[5];
    date.setHours(hour == null ? 23 : Number(hour), minute == null ? 59 : Number(minute), 0, 0);
    if (!Number.isNaN(date.getTime())) dueAt = date.toISOString();
  } else {
    const dayName = text.match(/(?:本周|这周|周|星期)([一二三四五六日天])/);
    if (dayName) {
      const weekday = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 }[dayName[1]];
      const date = new Date(now); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() + ((weekday - (date.getDay() || 7) + 7) % 7));
      const time = text.match(/(?:截止|之前|前|到)\s*(\d{1,2}):(\d{2})/) || text.match(/(\d{1,2}):(\d{2})/);
      date.setHours(time ? Number(time[1]) : 23, time ? Number(time[2]) : 59, 0, 0); dueAt = date.toISOString();
    }
  }
  return { title: taskTitle || text.slice(0, 160), description: `${cleanBody}${dueAt ? '' : `${cleanBody ? '\n' : ''}截止时间待补充`}`, due_at: dueAt };
}
export function createTodoRecord(input, now = new Date().toISOString()) {
  return { id: input.id || newId(), title: String(input.title || '').trim(), description: String(input.description || ''), due_at: input.due_at || null, priority: ['low','medium','high'].includes(input.priority) ? input.priority : 'medium', source: input.source || '手动创建', source_detail: input.source_detail || '', status: 'open', created_at: now, updated_at: now, deleted_at: null };
}
export function createDraftRecords(response, source, now = new Date().toISOString()) {
  const items = Array.isArray(response?.tasks) ? response.tasks : response?.task ? [response.task] : [];
  return items.filter(item => String(item.title || '').trim()).slice(0,10).map(item => ({ id: newId(), title: String(item.title).trim().slice(0,160), description: String(item.description || '').slice(0,500), due_at: typeof item.due_at === 'string' && !Number.isNaN(Date.parse(item.due_at)) ? new Date(item.due_at).toISOString() : null, priority: ['low','medium','high'].includes(item.priority) ? item.priority : 'medium', source, source_detail: '用户主动提交的消息', confidence: Math.max(0,Math.min(1,Number(item.confidence)||0)), status: 'pending', created_at: now, updated_at: now, deleted_at: null }));
}
export function todoFromDraft(draft, now = new Date().toISOString()) { return createTodoRecord({ ...draft, source: draft.source || 'AI', source_detail: draft.source_detail }, now); }
export function setTodoStatus(todo, status, now = new Date().toISOString()) { return { ...todo, status: status === 'completed' ? 'completed' : 'open', updated_at: now }; }
export function softDelete(record, now = new Date().toISOString()) { return { ...record, deleted_at: now, updated_at: now }; }
export function autoReminderId(todoId) { return `auto-${todoId}`; }
export function createAutoReminderRecord(todo, deviceId, leadMinutes = 60, now = new Date()) {
  const due = Date.parse(todo?.due_at || ''); const current = new Date(now).getTime();
  if (!todo?.id || !Number.isFinite(due) || due <= current + 60_000 || todo.status === 'completed') return null;
  const lead = Math.max(1, Number(leadMinutes) || 60) * 60_000;
  const fireAt = Math.max(due - lead, current + 60_000);
  if (fireAt >= due) return null;
  return { id: autoReminderId(todo.id), todo_id: todo.id, fire_at: new Date(fireAt).toISOString(), device_id: deviceId, sound: true, notification_id: null, triggered_at: null, status: 'scheduled', created_at: new Date(current).toISOString(), updated_at: new Date(current).toISOString(), deleted_at: null };
}
export function isAutoReminder(reminder) { return String(reminder?.id || '').startsWith('auto-'); }
export function mergeCloudRows(localRows, remoteRows, userId) {
  const timestamp = value => { const parsed = Date.parse(value || ''); return Number.isFinite(parsed) ? parsed : 0; };
  const local = new Map((Array.isArray(localRows) ? localRows : []).filter(row => row?.id).map(row => [row.id, { ...row, user_id: userId }]));
  const remote = new Map((Array.isArray(remoteRows) ? remoteRows : []).filter(row => row?.id).map(row => [row.id, row]));
  const rows = []; const upserts = [];
  for (const id of new Set([...local.keys(), ...remote.keys()])) {
    const localRow = local.get(id); const remoteRow = remote.get(id);
    if (!remoteRow || (localRow && timestamp(localRow.updated_at) > timestamp(remoteRow.updated_at))) {
      rows.push(localRow); upserts.push(localRow);
    } else rows.push(remoteRow);
  }
  return { rows, upserts };
}
export function duplicateReminder(reminders, todoId, fireAt, excludingId = null) { const stamp = new Date(fireAt).getTime(); return reminders.some(item => !item.deleted_at && item.id !== excludingId && item.todo_id === todoId && item.status !== 'sent' && new Date(item.fire_at).getTime() === stamp); }
export function reminderChannelId(sound, vibration) { return `study-reminder-v2-${sound ? 'sound' : 'silent'}-${vibration ? 'vibrate' : 'no-vibrate'}`; }
