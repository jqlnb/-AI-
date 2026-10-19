const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv, parseWeekday, parseTime, parseWeeks, duplicateCourse, createTodoRecord, createDraftRecords, todoFromDraft, setTodoStatus, softDelete, duplicateReminder, mergeCloudRows, reminderChannelId, createAutoReminderRecord, isAutoReminder, courseReminderOccurrences, parsePlatformAssignment } = require('../web/src/core.mjs');

test('recognizes Chinese, English, and numeric weekdays', () => {
  assert.equal(parseWeekday('星期一'), 1); assert.equal(parseWeekday('Mon'), 1); assert.equal(parseWeekday('7'), 7); assert.equal(parseWeekday('周天'), 7); assert.equal(parseWeekday('周八'), null);
});
test('normalizes and validates course times and week ranges', () => {
  assert.equal(parseTime('8:05'), '08:05'); assert.equal(parseTime('24:00'), null); assert.deepEqual(parseWeeks('1-16周', ''), [1,16]); assert.deepEqual(parseWeeks('1','16'),[1,16]); assert.equal(parseWeeks('19-2', ''), null);
});
test('parses CSV quotes and reports invalid row with source line', () => {
  const rows = parseCsv('course_name,weekday,start_time,end_time,start_week,location\n"高数,上",周一,08:00,09:40,1-16周,A楼 301\n坏课程,周八,25:90,26:00,');
  assert.equal(rows[0].course.course_name, '高数,上'); assert.deepEqual(rows[0].errors, []); assert.equal(rows[1].line, 3); assert.ok(rows[1].errors.length >= 2);
});
test('rejects missing required headers with actionable message', () => { assert.throws(() => parseCsv('课程,星期\n英语,周二'), /缺少必需列/); });
test('detects duplicate course rows by name, weekday, time, and room', () => {
  const a = {course_name:'数学',weekday:1,start_time:'08:00',location:'A 101'}; assert.equal(duplicateCourse(a,{...a}),true); assert.equal(duplicateCourse(a,{...a,weekday:2}),false);
});
test('parses a combined start and end time range', () => {
  const rows = parseCsv('course_name,weekday,start_time\n程序设计,Wed,08:00-09:40');
  assert.equal(rows[0].course.start_time, '08:00'); assert.equal(rows[0].course.end_time, '09:40'); assert.deepEqual(rows[0].errors, []);
});
test('AI extraction results become review drafts, never todos by themselves', () => {
  const drafts=createDraftRecords({tasks:[{title:'交高数作业',due_at:'2026-10-20T15:59:00Z',priority:'high',confidence:.92},{title:'复习英语'}]},'微信','2026-10-16T00:00:00Z');
  assert.equal(drafts.length,2); assert.equal(drafts[0].status,'pending'); assert.equal(drafts[0].due_at,'2026-10-20T15:59:00.000Z'); assert.equal(drafts[1].due_at,null); assert.equal(drafts[1].source_detail,'用户主动提交的消息');
});
test('AI response with no task stays empty and malformed tasks are ignored', () => {
  assert.deepEqual(createDraftRecords({tasks:[]},'QQ'),[]); assert.deepEqual(createDraftRecords({tasks:[{title:''}]},'QQ'),[]);
});
test('a draft becomes a todo only through explicit conversion; task can complete and soft-delete', () => {
  const task=todoFromDraft({title:'交作业',source:'AI',status:'pending'},'2026-10-16T00:00:00Z');
  assert.equal(task.status,'open'); assert.equal(setTodoStatus(task,'completed').status,'completed'); assert.ok(softDelete(task).deleted_at);
});
test('manual todo defaults, due-date absence, and reminder deduplication', () => {
  const task=createTodoRecord({title:'阅读论文'},'2026-10-16T00:00:00Z'); assert.equal(task.priority,'medium'); assert.equal(task.due_at,null);
  const reminder={id:'r1',todo_id:task.id,fire_at:'2026-10-18T10:00:00Z',status:'scheduled'};
  assert.equal(duplicateReminder([reminder],task.id,'2026-10-18T10:00:00Z'),true); assert.equal(duplicateReminder([reminder],task.id,'2026-10-18T11:00:00Z'),false); assert.equal(duplicateReminder([reminder],task.id,'2026-10-18T10:00:00Z','r1'),false);
});
test('tasks with a due date get a stable automatic reminder before the deadline', () => {
  const now = new Date('2026-10-16T00:00:00.000Z');
  const task = createTodoRecord({ id: 'todo-1', title: '交作业', due_at: '2026-10-16T02:00:00.000Z' }, now.toISOString());
  const reminder = createAutoReminderRecord(task, 'device-1', 60, now);
  assert.equal(reminder.id, 'auto-todo-1'); assert.equal(reminder.todo_id, task.id); assert.equal(reminder.device_id, 'device-1');
  assert.equal(reminder.fire_at, '2026-10-16T01:00:00.000Z'); assert.equal(isAutoReminder(reminder), true);
});
test('automatic reminders require a future due date and avoid scheduling in the past', () => {
  const now = new Date('2026-10-16T00:00:00.000Z');
  assert.equal(createAutoReminderRecord({ id: 'no-date', status: 'open' }, 'device-1', 60, now), null);
  assert.equal(createAutoReminderRecord({ id: 'done', status: 'completed', due_at: '2026-10-16T02:00:00Z' }, 'device-1', 60, now), null);
  assert.equal(createAutoReminderRecord({ id: 'too-soon', status: 'open', due_at: '2026-10-16T00:00:30Z' }, 'device-1', 60, now), null);
  const soon = createAutoReminderRecord({ id: 'soon', status: 'open', due_at: '2026-10-16T00:05:00Z' }, 'device-1', 60, now);
  assert.equal(soon.fire_at, '2026-10-16T00:01:00.000Z');
});
test('Android reminders use distinct channels for sound and vibration preferences', () => {
  const ids = [reminderChannelId(true,true),reminderChannelId(true,false),reminderChannelId(false,true),reminderChannelId(false,false)];
  assert.equal(new Set(ids).size, 4); assert.match(ids[0], /sound-vibrate$/); assert.match(ids[3], /silent-no-vibrate$/); assert.ok(ids.every(id => id.includes('v2-')));
});
test('deleting a course keeps a newer cloud tombstone so it stays deleted on other devices', () => {
  const course={id:'course-1',course_name:'高等数学',updated_at:'2026-10-15T00:00:00.000Z',deleted_at:null};
  const deleted=softDelete(course,'2026-10-16T00:00:00.000Z');
  const merged=mergeCloudRows([deleted],[course],'user-a');
  assert.equal(merged.rows[0].deleted_at,'2026-10-16T00:00:00.000Z');
  assert.equal(merged.upserts[0].user_id,'user-a');
});
test('cloud merge uses updated_at, keeps tombstones, and only uploads local winners', () => {
  const local = [
    { id: 'newer-local', title: 'phone edit', updated_at: '2026-10-16T10:00:00Z' },
    { id: 'newer-remote', title: 'stale edit', updated_at: '2026-10-16T08:00:00Z' },
    { id: 'deleted-local', title: 'removed', deleted_at: '2026-10-16T11:00:00Z', updated_at: '2026-10-16T11:00:00Z' },
    { id: 'local-only', title: 'offline addition', updated_at: '2026-10-16T09:00:00Z' }
  ];
  const remote = [
    { id: 'newer-local', title: 'old computer edit', updated_at: '2026-10-16T09:00:00Z' },
    { id: 'newer-remote', title: 'computer edit', updated_at: '2026-10-16T10:00:00Z' }
  ];
  const merged = mergeCloudRows(local, remote, 'user-a');
  assert.equal(merged.rows.find(row => row.id === 'newer-local').title, 'phone edit');
  assert.equal(merged.rows.find(row => row.id === 'newer-remote').title, 'computer edit');
  assert.ok(merged.rows.find(row => row.id === 'deleted-local').deleted_at);
  assert.equal(merged.rows.find(row => row.id === 'local-only').user_id, 'user-a');
  assert.deepEqual(merged.upserts.map(row => row.id), ['newer-local', 'deleted-local', 'local-only']);
});
test('course reminders schedule 15 minutes before class and apply semester week boundaries', () => {
  const now = new Date(2026, 9, 19, 6, 0, 0);
  const course = { id: 'c1', weekday: 1, start_time: '08:00', start_week: 2, end_week: 2 };
  const occurrences = courseReminderOccurrences([course], { now, semesterStartDate: '2026-10-19', daysAhead: 30 });
  assert.equal(occurrences.length, 1);
  assert.equal(occurrences[0].classAt.getDate(), 26);
  assert.equal(occurrences[0].fireAt.getHours(), 7);
  assert.equal(occurrences[0].fireAt.getMinutes(), 45);
});
test('course reminder falls back to weekly schedule when semester start is unknown', () => {
  const now = new Date(2026, 9, 19, 6, 0, 0);
  const [occurrence] = courseReminderOccurrences([{ id: 'c1', weekday: 1, start_time: '08:00', start_week: 8, end_week: 9 }], { now, daysAhead: 30 });
  assert.equal(occurrence.classAt.getDate(), 19);
  assert.equal(occurrence.weekNumber, null);
});
test('course reminder skips an already-passed alert and keeps upcoming classes 15 minutes early', () => {
  const now = new Date(2026, 9, 19, 7, 50, 0);
  const occurrences = courseReminderOccurrences([
    { id: 'passed', weekday: 1, start_time: '08:00' },
    { id: 'next', weekday: 1, start_time: '10:00' }
  ], { now, daysAhead: 7 });
  assert.equal(occurrences.length, 1);
  assert.equal(occurrences[0].courseId, 'next');
  assert.equal(occurrences[0].fireAt.getHours(), 9);
  assert.equal(occurrences[0].fireAt.getMinutes(), 45);
});
test('platform notification parser creates a task only for assignment-like content and leaves unknown dates blank', () => {
  const task = parsePlatformAssignment('学习通作业通知', '请提交高数第三章习题，截止时间：2026年10月23日 18:00', new Date(2026, 9, 19));
  assert.equal(task.title, '学习通作业通知');
  assert.ok(task.due_at);
  const noDate = parsePlatformAssignment('实验报告待提交', '请完成电路实验报告', new Date(2026, 9, 19));
  assert.equal(noDate.due_at, null);
  assert.match(noDate.description, /截止时间待补充/);
  assert.equal(parsePlatformAssignment('课程公告', '本周教学安排已发布'), null);
});
