import { LocalNotifications } from '@capacitor/local-notifications';

import { Capacitor, registerPlugin } from '@capacitor/core';

import { loadData, saveData, syncData, supabase, aiFunctionUrl } from './data.js';

import { newId, localDay, parseCsv, duplicateCourse, parseTime, parseWeeks, createTodoRecord, createDraftRecords, todoFromDraft, setTodoStatus, softDelete, duplicateReminder, reminderChannelId, autoReminderId, createAutoReminderRecord, isAutoReminder, courseReminderOccurrences, parsePlatformAssignment } from './core.mjs';

import './style.css';



const app = document.querySelector('#app');
const NotificationCapture = registerPlugin('NotificationCapture');

let authSession = supabase ? (await supabase.auth.getSession()).data.session : null;
let db = await loadData(authSession?.user?.id || null); let page = 'home'; let filter = 'open'; let syncState = authSession ? 'syncing' : 'offline'; let importRows = []; let importFileName = ''; let busy = false; let authMode = 'login';

let syncTimer = null; let syncPromise = null; let syncAgain = false; let localRevision = 0; let realtimeChannel = null; let realtimeUserId = null;

const deviceId = () => { let id=localStorage.getItem('study-planner-device-id'); if(!id){id=newId();localStorage.setItem('study-planner-device-id',id);} return id; };

const reminderTimers = new Map();
const courseReminderTimers = new Map();
let knownTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const notificationChannelsReady = Capacitor.isNativePlatform() ? Promise.all([true,false].flatMap(sound=>[true,false].map(vibration=>LocalNotifications.createChannel({id:reminderChannelId(sound,vibration),name:`学习提醒 · ${sound?'提示音':'静音'} · ${vibration?'震动':'不震动'}`,description:'可在手机的应用通知设置中调整提示方式。',importance:4,...(sound?{sound:'reminder.wav'}:{}),vibration})))) : Promise.resolve();

const labels = { home: '概览', courses: '课程表', todos: '待办事项', messages: '消息识别', review: '待审核', reminders: '提醒', settings: '设置' };

const iso = () => new Date().toISOString();

const live = items => items.filter(x => !x.deleted_at);

const activeTodos = () => live(db.todos);

const soundEnabled = reminder => reminder.sound !== false && db.settings.ringtone !== 'silent';

const todayKey = localDay();

const dayName = n => ['','周一','周二','周三','周四','周五','周六','周日'][n] || '—';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const dateTime = value => value ? new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '未设置';

const dueTone = todo => todo.due_at && new Date(todo.due_at) < new Date() && todo.status !== 'completed' ? 'late' : '';

function queueCloudSync() {

  if (!supabase || !navigator.onLine) return;

  clearTimeout(syncTimer);

  syncTimer = setTimeout(() => { syncTimer = null; void syncCloud(); }, 700);

}

function commit() {

  localRevision++;

  return saveData(db, authSession?.user?.id || null).then(() => { queueCloudSync(); });

}

async function syncCloud({ notify = false, successToast = '' } = {}) {

  if (syncPromise) { syncAgain = true; return syncPromise; }

  if (!supabase) {

    syncState = 'offline'; render();

    if (notify) toast('云端服务尚未配置，数据仍保存在本机。', 'error');

    return false;

  }

  if (!navigator.onLine) {

    syncState = 'offline'; render();

    if (notify) toast('当前离线，数据已保存在本机，联网后可重试。', 'error');

    return false;

  }

  syncState = 'syncing'; render();

  const run = (async () => {

    try {

      const { data: { session }, error } = await supabase.auth.getSession();

      if (error) throw error;

      if (!session) { syncState = 'offline'; if (notify) toast('请先登录，再同步到云端。', 'error'); return false; }
      const syncUserId = session.user.id;

      const revision = localRevision;

      const snapshot = JSON.parse(JSON.stringify(db));

      const synced = await syncData(snapshot);

      if (revision === localRevision && authSession?.user?.id === syncUserId) db = synced;

      else if (authSession?.user?.id === syncUserId) syncAgain = true;

      if (authSession?.user?.id === syncUserId) await saveData(db, syncUserId);

      await syncCourseReminders();

      syncState = 'synced';

      if (successToast) toast(successToast);

      return true;

    } catch (error) {

      syncState = navigator.onLine ? 'failed' : 'offline';

      if (notify) toast(error?.message || '同步失败；本机数据仍已保存。', 'error');

      return false;

    } finally {

      syncPromise = null;

      render();

      if (syncAgain) { syncAgain = false; queueCloudSync(); }

    }

  })();

  syncPromise = run;

  return run;

}

async function connectRealtime(session) {

  if (!supabase) return;

  const userId = session?.user?.id || null;

  if (userId === realtimeUserId && realtimeChannel) return;

  if (realtimeChannel) await supabase.removeChannel(realtimeChannel);

  realtimeChannel = null; realtimeUserId = userId;

  if (!userId) return;

  let channel = supabase.channel(`study-planner-${userId}`);

  for (const table of ['courses', 'todos', 'drafts', 'reminders', 'user_settings']) {

    channel = channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `user_id=eq.${userId}` }, () => queueCloudSync());

  }

  realtimeChannel = channel.subscribe();

}

async function changePage(next) { page = next; render(); }

function courseForDay(day, compact = false) {

  const courses = live(db.courses).filter(c => c.weekday === day).sort((a,b) => a.start_time.localeCompare(b.start_time));

  return courses.length ? courses.map(c => `<article class="course-row"><time>${esc(c.start_time)}</time><span class="course-mark" style="--course:${esc(c.color || '#6675e8')}"></span><div><strong>${esc(c.course_name)}</strong><small>${esc(c.location || '地点待补')}${c.teacher ? ` · ${esc(c.teacher)}` : ''}</small></div>${!compact ? `<button class="icon-button" data-edit-course="${c.id}" title="编辑课程">✎</button><button class="icon-button" data-delete-course="${c.id}" title="删除课程">×</button>` : ''}</article>`).join('') : '<div class="muted small empty-day">暂无课程</div>';

}

function validateImportRows() {

  importRows.forEach((row, i) => {

    const c=row.course; row.errors=[];

    if(!c.course_name.trim())row.errors.push('课程名称为空');

    if(!Number.isInteger(Number(c.weekday))||Number(c.weekday)<1||Number(c.weekday)>7)row.errors.push('“星期”字段无法识别');

    if(!parseTime(c.start_time))row.errors.push('“开始时间”格式无效');

    if(!parseTime(c.end_time))row.errors.push('缺少或无效的“结束时间”');

    if(parseTime(c.start_time)&&parseTime(c.end_time)&&c.end_time<=c.start_time)row.errors.push('结束时间必须晚于开始时间');

    if(!parseWeeks(c.start_week,c.end_week))row.errors.push('周次范围无效');

    if(importRows.slice(0,i).some(prev=>duplicateCourse(prev.course,c))||live(db.courses).some(existing=>duplicateCourse(existing,c)))row.errors.push('与已有或本次导入课程重复');

  });

}

function todoCard(todo) {

  return `<article class="todo-card ${todo.status === 'completed' ? 'is-done' : ''} ${dueTone(todo)}"><button class="check ${todo.status === 'completed' ? 'checked' : ''}" data-complete="${todo.id}" aria-label="切换完成状态">${todo.status === 'completed' ? '✓' : ''}</button><div class="todo-copy"><strong>${esc(todo.title)}</strong>${todo.description ? `<small>${esc(todo.description)}</small>` : ''}<small>${todo.due_at ? `截止 ${dateTime(todo.due_at)}` : '无截止时间'} · ${esc(todo.source || '手动创建')}</small></div><span class="priority p-${todo.priority || 'medium'}">${{high:'高',medium:'中',low:'低'}[todo.priority] || '中'}</span><button class="icon-button" data-edit="${todo.id}" title="编辑">✎</button><button class="icon-button" data-delete-todo="${todo.id}" title="删除">×</button></article>`;

}

function draftCard(draft) { return `<article class="draft-card"><div class="draft-head"><span class="badge">待审核</span><span class="muted small">${esc(draft.source || '消息导入')} · ${Math.round((draft.confidence || 0) * 100)}% 置信度</span></div><strong>${esc(draft.title)}</strong><p>${esc(draft.description || 'AI 未提取备注')}</p><small>截止：${esc(draft.due_at ? dateTime(draft.due_at) : '未识别')}　·　优先级：${esc(({high:'高',medium:'中',low:'低'})[draft.priority] || '中')}</small><div class="actions"><button class="button primary small-button" data-approve="${draft.id}">确认加入待办</button><button class="button quiet small-button" data-edit-draft="${draft.id}">编辑</button><button class="button quiet small-button" data-reject="${draft.id}">拒绝</button></div></article>`; }

function summaryCard(label, value, hint, icon, destination, destinationFilter = '') { return `<button type="button" class="summary-card" data-summary-nav="${destination}" ${destinationFilter ? `data-summary-filter="${destinationFilter}"` : ''} aria-label="${label}：${value}，打开对应内容"><span class="summary-icon">${icon}</span><span class="summary-copy"><strong>${value}</strong><small>${label}</small><em>${hint}</em></span></button>`; }

function home() {

  const todayCourses = live(db.courses).filter(c => c.weekday === (new Date().getDay() || 7));

  const todayTodos = activeTodos().filter(t => t.status !== 'completed' && t.due_at && localDay(new Date(t.due_at)) === todayKey);

  const upcoming = activeTodos().filter(t => t.status !== 'completed' && t.due_at && new Date(t.due_at) > new Date()).sort((a,b)=>new Date(a.due_at)-new Date(b.due_at)).slice(0,3);

  const pending = live(db.drafts);

  return `<section class="welcome"><div><p class="eyebrow">${new Date().toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'long'})}</p><h1>今天，按自己的节奏来。</h1><p>把课程、任务与提醒放在一个清晰的学习空间里。</p></div><button class="button primary" data-nav="todos">＋ 新建待办</button></section><section class="summary-grid">${summaryCard('今日课程',todayCourses.length,'安排清清楚楚','▦','courses')}${summaryCard('今日待办',todayTodos.length,'专注眼前一步','✓','todos','today')}${summaryCard('待审核消息',pending.length,'由你决定是否加入','✧','review')}${summaryCard('已完成待办',activeTodos().filter(t=>t.status==='completed').length,'积累每一点进度','↗','todos','done')}</section><section class="home-columns"><div class="panel"><div class="section-heading"><div><h2>今日课程</h2><p>按上课时间排序</p></div><button class="text-button" data-nav="courses">查看周课表 →</button></div>${todayCourses.length ? courseForDay(new Date().getDay() || 7, true) : `<div class="empty-state"><span>▦</span><strong>今天还没有课程安排</strong><button class="text-button" data-nav="courses">导入课程表</button></div>`}</div><div class="panel"><div class="section-heading"><div><h2>今日待办</h2><p>截止日期为今天的任务</p></div><button class="text-button" data-nav="todos">全部待办 →</button></div>${todayTodos.length ? todayTodos.map(todoCard).join('') : '<div class="empty-state"><span>✓</span><strong>今天轻装上阵</strong><small>新建任务或好好享受这段空档</small></div>'}</div></section><section class="home-columns"><div class="panel"><div class="section-heading"><div><h2>即将截止</h2><p>接下来值得关注的任务</p></div></div>${upcoming.length ? upcoming.map(t=>`<div class="upcoming-row"><span class="dot ${t.priority}"></span><strong>${esc(t.title)}</strong><small>${dateTime(t.due_at)}</small></div>`).join('') : '<div class="muted small padded">还没有即将截止的任务。</div>'}</div><div class="panel accent-panel"><div class="section-heading"><div><h2>消息待审核</h2><p>确认后才会加入正式待办</p></div><button class="text-button" data-nav="review">打开审核 →</button></div>${pending.length ? pending.slice(0,2).map(d=>`<div class="upcoming-row"><span class="draft-spark">✧</span><strong>${esc(d.title)}</strong><small>等待你的确认</small></div>`).join('') : '<div class="muted small padded">暂无待审核草稿。</div>'}</div></section>`;

}

function courses() {

  const days = [1,2,3,4,5,6,7];

  return `<section class="page-heading"><div><p class="eyebrow">课程安排</p><h1>每周课程</h1><p>导入后可在此查看课程，原始课程数据与待办分开保存。</p></div><label class="button primary file-button">导入 CSV / XLSX<input type="file" id="course-file" accept=".csv,.xlsx,.xls" hidden></label></section><div class="panel semester-bar"><span>本学期</span><strong>${esc(live(db.courses)[0]?.semester || '未命名学期')}</strong><small>${live(db.courses).length} 门课程</small><button class="text-button" data-load-demo>载入演示课程</button></div>${importRows.length ? `<section class="panel import-preview"><div class="section-heading"><div><h2>导入预览</h2><p>${esc(importFileName)} · ${importRows.length} 行。请检查后确认导入。</p></div><button class="icon-button" data-cancel-import>×</button></div>${importRows.map(row=>`<div class="preview-row ${row.errors.length?'invalid':''}"><input aria-label="课程名称" data-import-edit="${importRows.indexOf(row)}" data-field="course_name" value="${esc(row.course.course_name)}"><select aria-label="星期" data-import-edit="${importRows.indexOf(row)}" data-field="weekday">${[1,2,3,4,5,6,7].map(d=>`<option value="${d}" ${row.course.weekday===d?'selected':''}>${dayName(d)}</option>`).join('')}</select><span class="time-edit"><input aria-label="开始时间" type="time" data-import-edit="${importRows.indexOf(row)}" data-field="start_time" value="${esc(row.course.start_time)}"><input aria-label="结束时间" type="time" data-import-edit="${importRows.indexOf(row)}" data-field="end_time" value="${esc(row.course.end_time)}"></span><input aria-label="地点" data-import-edit="${importRows.indexOf(row)}" data-field="location" value="${esc(row.course.location)}"><small>${row.errors.length ? `第 ${row.line} 行：${row.errors.map(esc).join('；')}` : row.course.teacher ? esc(row.course.teacher) : '无错误'}</small></div>`).join('')}<div class="actions"><button class="button primary" data-confirm-import ${importRows.some(r=>r.errors.length)?'disabled':''}>确认导入 ${importRows.filter(r=>!r.errors.length).length} 门课程</button><button class="button quiet" data-cancel-import>取消</button></div></section>`:''}<div class="week-grid">${days.map(d=>`<section class="week-day"><header><strong>${dayName(d)}</strong><small>${live(db.courses).filter(c=>c.weekday===d).length} 节</small></header>${courseForDay(d)}</section>`).join('')}</div>`;

}

function todos() {

  const now=new Date();const weekStart=new Date(now);weekStart.setHours(0,0,0,0);weekStart.setDate(weekStart.getDate()-(weekStart.getDay()+6)%7);const weekEnd=new Date(weekStart);weekEnd.setDate(weekEnd.getDate()+7);

  const rows = activeTodos().filter(t=>{if(filter==='all')return true;if(filter==='done')return t.status==='completed';if(t.status==='completed')return false;if(filter==='today')return t.due_at&&localDay(new Date(t.due_at))===localDay(now);if(filter==='week')return t.due_at&&new Date(t.due_at)>=weekStart&&new Date(t.due_at)<weekEnd;if(filter==='upcoming')return t.due_at&&new Date(t.due_at)>now&&new Date(t.due_at)<=new Date(now.getTime()+7*86400000);return true;}).sort((a,b)=> (a.due_at || '9999').localeCompare(b.due_at || '9999'));

  return `<section class="page-heading"><div><p class="eyebrow">任务管理</p><h1>待办事项</h1><p>从重要的一件事开始。</p></div></section><form class="panel task-form" id="todo-form"><div class="input-row"><input name="title" placeholder="添加一项待办…" maxlength="160" required><button class="button primary">＋ 添加</button></div><div class="input-row secondary-inputs"><input name="due_at" type="datetime-local" aria-label="截止时间"><select name="priority"><option value="medium">中优先级</option><option value="high">高优先级</option><option value="low">低优先级</option></select><input name="description" placeholder="备注（可选）" maxlength="500"></div><label class="check-label auto-reminder-option"><input type="checkbox" name="auto_reminder" ${db.settings.autoReminderEnabled?'checked':''}> 截止前自动提醒 <small>默认提前 ${db.settings.autoReminderMinutes || 60} 分钟；需要填写截止时间</small></label></form><div class="filter-bar">${[['today','今日'],['week','本周'],['open','未完成'],['upcoming','即将截止'],['all','全部'],['done','已完成']].map(([key,label])=>`<button class="filter-pill ${filter===key?'selected':''}" data-filter="${key}">${label}${key==='open'?` <span>${activeTodos().filter(t=>t.status!=='completed').length}</span>`:''}</button>`).join('')}</div><section class="todo-list">${rows.length?rows.map(todoCard).join(''):'<div class="panel empty-state"><span>✓</span><strong>这里暂时空空的</strong><small>可以创建任务，或从消息里识别一项待办。</small></div>'}</section>`;

}

function messages() { return `<section class="page-heading"><div><p class="eyebrow">手动导入 · 保护隐私</p><h1>把消息变成待办草稿</h1><p>只分析你主动粘贴的文字；不会读取 QQ 或微信。原始消息不会保存在本机或日志中。</p></div></section><section class="panel message-panel"><label for="message-text">粘贴你想分析的消息</label><textarea id="message-text" rows="7" maxlength="6000" placeholder="例如：记得周五之前把高数第三章习题交一下。"></textarea><div class="message-footer"><select id="message-source"><option value="导入消息">导入消息</option><option value="微信">微信</option><option value="QQ">QQ</option><option value="手动粘贴">手动粘贴</option></select><button class="button primary" id="analyze-message" ${busy?'disabled':''}>${busy?'正在分析…':'✧ 分析消息'}</button></div><p class="muted small">分析结果只会进入待审核草稿。确认前不会创建正式待办。需配置 Supabase Edge Function 与 AI 服务密钥；每次只分析你主动提交的文字。可选 Gemini API 免费额度（有速率与地区限制）或 ChatGPT API（单独计费）。</p><div id="ai-error" class="inline-error" hidden></div></section><div class="privacy-note"><span>◎</span><span><strong>由你掌控</strong><small>AI 只接收你提交的文本，错误提示不会回显原文。你可以随时拒绝草稿。</small></span></div>`; }

function review() { const drafts = live(db.drafts); return `<section class="page-heading"><div><p class="eyebrow">由你最终确认</p><h1>待审核</h1><p>AI 识别结果仅作为建议。确认之前不会变成正式任务。</p></div></section><div class="draft-list">${drafts.length?drafts.map(draftCard).join(''):'<div class="panel empty-state"><span>✧</span><strong>暂无待审核草稿</strong><button class="text-button" data-nav="messages">分析一条消息</button></div>'}</div>`; }

function reminders() { const all = live(db.reminders).sort((a,b)=>a.fire_at.localeCompare(b.fire_at)); return `<section class="page-heading"><div><p class="eyebrow">本机通知</p><h1>提醒</h1><p>通知状态由设备系统管理。云端同步保存提醒计划。</p></div><label class="switch"><input type="checkbox" id="reminder-master" ${db.settings.remindersEnabled?'checked':''}><span></span><b>提醒总开关</b></label></section><form class="panel task-form" id="reminder-form"><h2>添加提醒</h2><select name="todo_id" required>${activeTodos().filter(t=>t.status!=='completed').map(t=>`<option value="${t.id}">${esc(t.title)}</option>`).join('')}</select><div class="input-row"><input name="fire_at" type="datetime-local" required><button class="button primary">设置提醒</button></div><div class="input-row"><label class="check-label"><input type="checkbox" name="sound" ${db.settings.sound?'checked':''}> 允许提醒音效</label><button type="button" id="test-reminder" class="button quiet">测试提醒</button></div></form><section class="reminder-list">${all.length?all.map(r=>`<div class="panel reminder-row"><div><strong>${esc(activeTodos().find(t=>t.id===r.todo_id)?.title || r.title || '任务提醒')}</strong><small>${dateTime(r.fire_at)} · ${isAutoReminder(r)?'自动提醒 · ':''}${r.status==='sent'?'已触发':r.status==='cancelled'?'已取消':'已计划'}</small></div><button class="icon-button" data-edit-reminder="${r.id}" title="修改提醒">✎</button><button class="icon-button" data-delete-reminder="${r.id}">×</button></div>`).join(''):'<div class="panel empty-state"><span>◷</span><strong>还没有提醒计划</strong><small>新待办可以自动设置截止前提醒，也可以在这里手动添加。</small></div>'}</section>`; }

function settings() { return `<section class="page-heading"><div><p class="eyebrow">账户与偏好</p><h1>设置</h1><p>配置多端同步、主题和提醒行为。</p></div></section><section class="panel settings-panel"><div class="setting-title"><div><h2>账号与云端同步</h2><p>${supabase?'使用 Supabase 登录并同步课程、待办、草稿及提醒。':'尚未配置云端服务；数据仅保存在本机。'}</p></div><span class="sync-badge ${syncState}">${syncState==='syncing'?'同步中':syncState==='synced'?'已同步':syncState==='failed'?'同步失败':'离线'}</span></div>${supabase?`<form id="auth-form"><div class="input-row"><input name="email" type="email" placeholder="邮箱"><input name="password" type="password" placeholder="密码" minlength="8"></div><div class="actions"><button class="button primary" name="action" value="login">登录</button><button class="button quiet" name="action" value="register">注册</button><button class="button quiet" name="action" value="recover">找回密码</button><button class="button quiet" name="action" value="logout">退出登录</button><button class="button quiet" type="button" id="sync-now">立即同步</button></div><p id="auth-status" class="muted small"></p></form>`:`<div class="setup-note"><strong>还没连云端？</strong><p>创建 Supabase 项目后，把 URL 和 anon key 写入项目根目录的 <code>.env</code>，并执行 <code>npm run dev</code>。数据库 SQL 在 <code>backend/supabase.sql</code>。</p></div>`}</section><section class="panel settings-panel"><div class="setting-title"><div><h2>偏好设置</h2><p>在桌面和手机上使用相同的视觉语言。</p></div></div><div class="setting-row"><span><strong>主题</strong><small>浅色与深色显示</small></span><select id="theme-select"><option value="light" ${db.settings.theme==='light'?'selected':''}>浅色</option><option value="dark" ${db.settings.theme==='dark'?'selected':''}>深色</option></select></div><div class="setting-row"><span><strong>提醒铃声</strong><small>Android 使用轻提示音；Windows 使用系统默认通知声音。</small></span><select id="ringtone-select"><option value="reminder" ${db.settings.ringtone!=='silent'?'selected':''}>默认提示音</option><option value="silent" ${db.settings.ringtone==='silent'?'selected':''}>静音</option></select><button class="button quiet" id="test-reminder">测试铃声</button></div><div class="setting-row"><span><strong>手机震动</strong><small>仅影响 Android 本地提醒；系统通知设置也可能关闭震动。</small></span><label class="check-label"><input type="checkbox" id="vibration-toggle" ${db.settings.vibration!==false?'checked':''}> 震动提醒</label></div><div class="setting-row"><span><strong>新待办自动提醒</strong><small>创建任务时默认启用，可在单条待办上关闭。</small></span><label class="check-label"><input type="checkbox" id="auto-reminder-default" ${db.settings.autoReminderEnabled?'checked':''}> 开启</label><select id="auto-reminder-lead" aria-label="截止前提醒时间"><option value="15" ${Number(db.settings.autoReminderMinutes)===15?'selected':''}>提前 15 分钟</option><option value="30" ${Number(db.settings.autoReminderMinutes)===30?'selected':''}>提前 30 分钟</option><option value="60" ${Number(db.settings.autoReminderMinutes||60)===60?'selected':''}>提前 1 小时</option><option value="120" ${Number(db.settings.autoReminderMinutes)===120?'selected':''}>提前 2 小时</option></select></div><div class="setting-row"><span><strong>删除账号</strong><small>删除登录账号与云端个人数据，此操作不可撤销。</small></span><button class="button quiet" type="button" id="delete-account" ${supabase?'':'disabled'}>删除账号</button></div></section><section class="panel settings-panel"><div class="setting-title"><div><h2>本机数据</h2><p>导出演示、导入或清空当前设备保存的数据。</p></div></div><div class="actions"><button class="button quiet" id="export-data">导出 JSON 备份</button><label class="button quiet file-button">导入备份<input type="file" id="backup-file" accept="application/json" hidden></label></div></section>`; }



function render() {

  document.documentElement.dataset.theme = db.settings.theme || 'light';

  const content = {home, courses, todos, messages, review, reminders, settings}[page]();

  const pending = live(db.drafts).length;

  app.innerHTML = `<aside class="sidebar"><div class="brand"><div class="brand-logo">知</div><div><strong>知序</strong><small>学习日程助手</small></div></div><div class="workspace-label">WORKSPACE</div><nav>${Object.entries(labels).map(([key,label])=>`<button class="nav-item ${page===key?'active':''}" data-nav="${key}"><span class="nav-icon">${{home:'⌂',courses:'▦',todos:'✓',messages:'✧',review:'☷',reminders:'◷',settings:'⚙'}[key]}</span><span>${label}</span>${key==='review'&&pending?`<em>${pending}</em>`:''}</button>`).join('')}</nav><div class="sidebar-bottom"><div class="sync-line"><span class="sync-dot ${syncState}"></span><span>${syncState==='syncing'?'正在同步':syncState==='synced'?'已同步':syncState==='failed'?'同步失败':'本机数据'}</span></div><button class="nav-item" data-nav="settings"><span class="nav-icon">◎</span><span>${supabase?'账户设置':'离线使用'}</span></button><small>轻一点，走得更远。</small></div></aside><main class="main-area"><header class="topbar"><div class="mobile-brand"><span class="brand-logo">知</span><strong>知序</strong></div><span class="top-context">${labels[page]}</span><div class="top-actions"><span class="online-chip"><i></i>${syncState==='synced'?'已同步':syncState==='syncing'?'同步中':'本机'}</span><button class="avatar" data-nav="settings">${supabase?'◎':'我'}</button></div></header><div class="content">${content}</div><nav class="mobile-nav">${['home','courses','todos','reminders','messages','settings'].map(key=>`<button class="${page===key?'active':''}" data-nav="${key}"><span>${{home:'⌂',courses:'▦',todos:'✓',reminders:'◷',messages:'✧',settings:'⚙'}[key]}</span><small>${labels[key]}</small></button>`).join('')}</nav></main><div id="toast" class="toast" role="status"></div>`;

  if (page === 'messages') {
    const panel = document.createElement('section'); panel.id = 'platform-capture'; panel.className = 'panel settings-panel';
    panel.innerHTML = `<div class="setting-title"><div><h2>学习平台通知接入</h2><p>需你主动授权 Android 通知读取权限，并手动选择要处理的平台应用。通知内容在本机解析，不会发送给 AI。</p></div></div><p id="platform-capture-status" class="muted small">正在读取接入状态…</p><div id="platform-app-list" class="platform-app-list"></div><div class="actions"><button id="platform-access" class="button quiet">打开 Android 通知授权</button><label class="check-label"><input id="platform-capture-toggle" type="checkbox"> 启用已选择的应用</label><button id="platform-process" class="button primary">处理已收到的通知</button></div><p class="muted small">只处理平台通知中实际显示的内容；无明确截止时间时会标记“截止时间待补充”。Windows 使用下方粘贴文本方式，不读取手机或其他应用通知。</p>`;
    app.querySelector('.page-heading')?.after(panel);
    if (Capacitor.isNativePlatform()) void refreshNotificationCapture(); else panel.querySelector('#platform-capture-status').textContent = '此接入仅在 Android App 可用；桌面端请粘贴或导入消息文本。';
  }
  if (page === 'courses') {
    const panel = document.createElement('section'); panel.className = 'panel course-reminder-settings';
    panel.innerHTML = `<label class="setting-row"><span><strong>课程提醒</strong><small>默认上课前 15 分钟；Android 使用本地通知，Windows 需保持应用运行。</small></span><input id="course-reminder-toggle" type="checkbox" ${db.settings.courseReminderEnabled !== false ? 'checked' : ''}></label><label class="setting-row"><span><strong>提醒提前时间</strong></span><select id="course-reminder-lead"><option value="15" ${Number(db.settings.courseReminderMinutes || 15) === 15 ? 'selected' : ''}>15 分钟</option><option value="30" ${Number(db.settings.courseReminderMinutes) === 30 ? 'selected' : ''}>30 分钟</option><option value="60" ${Number(db.settings.courseReminderMinutes) === 60 ? 'selected' : ''}>1 小时</option></select></label><label class="setting-row"><span><strong>学期第 1 周周一日期</strong><small>${db.settings.semesterStartDate ? '已设置，将按课程起止周安排提醒。' : '未设置时按固定每周课表安排，不按起止周过滤。请按校历填写，不会自动推断。'}</small></span><input id="semester-start-date" type="date" value="${esc(db.settings.semesterStartDate || '')}"></label>`;
    app.querySelector('.semester-bar')?.after(panel);
  }
  if (authSession?.user?.email) { const avatar = app.querySelector('.avatar'); if (avatar) avatar.textContent = authSession.user.email.slice(0, 1).toUpperCase(); }
  if (page === 'settings' && authSession && authMode !== 'switch') {
    const form = app.querySelector('#auth-form');
    if (form) form.outerHTML = `<div class="account-session"><div><strong>已登录</strong><p>${esc(authSession.user.email || '当前账号')}</p></div><div class="actions"><button class="button primary" id="auth-logout">退出登录</button><button class="button quiet" id="auth-switch">切换账号</button><button class="button quiet" type="button" id="sync-now">立即同步</button></div><p id="auth-status" class="muted small">${syncState==='syncing'?'正在连接云端…':syncState==='synced'?'云端同步正常':syncState==='failed'?'云端同步失败':'账号数据保存在本机'}</p></div>`;
  }

  wire();

}

function toast(message, kind='') { const node = document.querySelector('#toast'); if (!node) return; node.textContent = message; node.className = `toast show ${kind}`; clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove('show'), 3000); }

function updateRecord(collection, row) { const now=iso(); row.updated_at=now; const ix=db[collection].findIndex(x=>x.id===row.id); if(ix<0) db[collection].push(row); else db[collection][ix]=row; }

async function sendReminder(reminder, title) {

  if (reminder.status==='sent' || reminder.triggered_at || !db.settings.remindersEnabled) return;

  toast(`提醒：${title}`);

  try {

    if (Capacitor.isNativePlatform()) { await LocalNotifications.schedule({ notifications: [{ id: Math.abs(hash(reminder.id)), title: '学习提醒', body: title, channelId: soundEnabled(reminder) ? 'study-reminder-sound' : 'study-reminder-silent', schedule: { at: new Date(reminder.fire_at) }, extra: { reminderId: reminder.id } }] }); }

    else if (window.desktopBridge) window.desktopBridge.notify({ title: '学习提醒', body: title, silent: !soundEnabled(reminder) });

    else if ('Notification' in window && Notification.permission==='granted') new Notification('学习提醒',{body:title});

  } catch { /* Device notification permission can be declined; app state remains available. */ }

  reminder.status='sent'; reminder.triggered_at=iso(); reminder.notification_id=reminder.id; updateRecord('reminders', reminder); await commit();

}

function hash(text) { let h=0; for (const c of text) h=(h*31+c.charCodeAt(0))|0; return h & 0x7fffffff; }

async function scheduleReminder(reminder) {

  if (!db.settings.remindersEnabled || reminder.device_id !== deviceId() || new Date(reminder.fire_at) <= new Date()) return;

  if (Capacitor.isNativePlatform()) { try { await notificationChannelsReady; const perm=await LocalNotifications.checkPermissions(); if(perm.display!=='granted') await LocalNotifications.requestPermissions(); const notificationId=Math.abs(hash(reminder.id)); await LocalNotifications.cancel({notifications:[{id:notificationId}]}); await LocalNotifications.schedule({notifications:[{id:notificationId,title:'学习提醒',body:activeTodos().find(t=>t.id===reminder.todo_id)?.title || '任务提醒',channelId:reminderChannelId(soundEnabled(reminder),db.settings.vibration!==false),schedule:{at:new Date(reminder.fire_at)},extra:{reminderId:reminder.id}}]}); } catch { toast('系统通知未开启，请在 Android 设置中授予通知权限。','error'); } return; }

  if (window.desktopBridge) { const previous=reminderTimers.get(reminder.id);if(previous)clearTimeout(previous);const delay=new Date(reminder.fire_at).getTime()-Date.now();if(delay<2147480000){const timer=setTimeout(()=>{reminderTimers.delete(reminder.id);sendReminder(reminder,activeTodos().find(t=>t.id===reminder.todo_id)?.title||'任务提醒');},delay);reminderTimers.set(reminder.id,timer);} }

}

async function syncCourseReminders({ notifyOnPermission = false } = {}) {
  if (!db.settings.remindersEnabled || db.settings.courseReminderEnabled === false) {
    for (const timer of courseReminderTimers.values()) clearTimeout(timer);
    courseReminderTimers.clear();
    if (Capacitor.isNativePlatform()) { try { const { notifications = [] } = await LocalNotifications.getPending(); const owned = notifications.filter(n => n.extra?.courseReminder).map(n => ({ id: n.id })); if (owned.length) await LocalNotifications.cancel({ notifications: owned }); } catch {} }
    return;
  }
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const now = new Date();
  const leadMinutes = Number(db.settings.courseReminderMinutes) || 15;
  const daysAhead = db.settings.semesterStartDate ? 210 : 56;
  const occurrences = courseReminderOccurrences(live(db.courses), { now, semesterStartDate: db.settings.semesterStartDate || '', leadMinutes, daysAhead });
  if (Capacitor.isNativePlatform()) {
    try {
      await notificationChannelsReady;
      const { notifications = [] } = await LocalNotifications.getPending();
      const previous = notifications.filter(n => n.extra?.courseReminder).map(n => ({ id: n.id }));
      if (previous.length) await LocalNotifications.cancel({ notifications: previous });
      if (!occurrences.length) { knownTimezone = timezone; return; }
      const permission = await LocalNotifications.checkPermissions();
      if (permission.display !== 'granted') {
        const requested = notifyOnPermission ? await LocalNotifications.requestPermissions() : permission;
        if (requested.display !== 'granted') { if (notifyOnPermission) toast('课程已保存，但系统通知权限未开启；请在 Android 设置中允许通知。', 'error'); return; }
      }
      const scheduled = occurrences.slice(0, 300).map(item => {
        const course = live(db.courses).find(c => c.id === item.courseId); if (!course) return null;
        const id = Math.max(1, hash(`course:${course.id}:${item.classAt.toISOString().slice(0, 10)}`));
        const place = course.location ? ` · ${course.location}` : '';
        return { id, title: course.course_name, body: `${item.classAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}${place} · ${leadMinutes} 分钟后上课`, channelId: reminderChannelId(db.settings.ringtone !== 'silent', db.settings.vibration !== false), schedule: { at: item.fireAt }, extra: { courseReminder: true, courseId: course.id } };
      }).filter(Boolean);
      if (scheduled.length) await LocalNotifications.schedule({ notifications: scheduled });
      if (notifyOnPermission && scheduled.length) toast(`已安排 ${scheduled.length} 条课程提醒`);
    } catch (error) { if (notifyOnPermission) toast('课程已保存，但系统通知安排失败，请检查通知与精确闹钟权限。', 'error'); }
    knownTimezone = timezone;
    return;
  }
  if (window.desktopBridge) {
    for (const timer of courseReminderTimers.values()) clearTimeout(timer);
    courseReminderTimers.clear();
    for (const item of occurrences.filter(x => x.fireAt.getTime() - now.getTime() < 14 * 86400000)) {
      const course = live(db.courses).find(c => c.id === item.courseId); if (!course) continue;
      const key = `${course.id}:${item.classAt.toISOString().slice(0, 10)}`;
      const timer = setTimeout(() => { courseReminderTimers.delete(key); window.desktopBridge.notify({ title: `课程即将开始：${course.course_name}`, body: `${item.classAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}${course.location ? ` · ${course.location}` : ''}` }); void syncCourseReminders(); }, item.fireAt.getTime() - now.getTime());
      courseReminderTimers.set(key, timer);
    }
  }
  knownTimezone = timezone;
}

async function processCapturedNotifications() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const state = await NotificationCapture.getState(); if (!state.enabled || !state.authorized) return;
    const { notifications = [] } = await NotificationCapture.takeQueue(); let added = 0;
    if (notifications.length) await NotificationCapture.markProcessed({ at: Date.now() });
    for (const item of notifications) {
      const sourceDetail = `platform-notification:${item.packageName}:${item.id}`;
      if (db.todos.some(todo => todo.source_detail === sourceDetail)) continue;
      const extracted = parsePlatformAssignment(item.title, item.body, new Date(Number(item.postedAt) || Date.now()));
      if (!extracted) continue;
      db.todos.push(createTodoRecord({ ...extracted, source: item.packageName, source_detail: sourceDetail }, iso())); added++;
    }
    if (added) { await commit(); render(); toast(`已从学习平台通知添加 ${added} 项待办`); }
    await NotificationCapture.clearQueue();
  } catch { toast('读取通知队列失败；可改用下方文本粘贴导入。', 'error'); }
}

async function refreshNotificationCapture() {
  const panel = app.querySelector('#platform-capture'); if (!panel || !Capacitor.isNativePlatform()) return;
  try {
    const state = await NotificationCapture.getState();
    if (!state.authorized && state.enabled) { await NotificationCapture.setConfiguration({ enabled: false, allowedPackages: state.allowedPackages || [] }); state.enabled = false; }
    const status = panel.querySelector('#platform-capture-status');
    const processedText = state.lastProcessedAt ? `最近处理：${new Date(state.lastProcessedAt).toLocaleString('zh-CN')}` : state.lastCapturedAt ? `最近收到通知：${new Date(state.lastCapturedAt).toLocaleString('zh-CN')}` : '尚未收到通知';
    if (status) status.textContent = !state.authorized ? `尚未授权。点击下方按钮，在 Android 系统设置中主动允许通知读取。${state.lastProcessedAt ? ` ${processedText}` : ''}` : `${state.enabled ? '通知读取已启用；仅处理你勾选的应用，正文只在本机解析。' : '系统授权有效，接入已关闭。'} ${processedText}`;
    const apps = panel.querySelector('#platform-app-list');
    if (apps) apps.innerHTML = state.detectedApps?.length ? state.detectedApps.map(appInfo => `<label class="check-label"><input type="checkbox" data-platform-package="${esc(appInfo.packageName)}" ${state.allowedPackages?.includes(appInfo.packageName) ? 'checked' : ''}> ${esc(appInfo.label)} <small>${esc(appInfo.packageName)}</small></label>`).join('') : '<small class="muted">暂未发现应用。授权后，先让学习通/智慧树产生一条通知，再返回此处选择该应用。</small>';
    panel.querySelector('#platform-capture-toggle').checked = Boolean(state.enabled);
  } catch { const status = panel.querySelector('#platform-capture-status'); if (status) status.textContent = '当前 Android 构建未包含通知读取组件，请使用粘贴文本方式。'; }
}

async function reconcileAutoReminder(todo, enabled) {

  const id = autoReminderId(todo.id); let reminder = db.reminders.find(item => item.id === id);

  if (reminder) {

    const timer = reminderTimers.get(id); if (timer) clearTimeout(timer); reminderTimers.delete(id);

    if (Capacitor.isNativePlatform()) try { await LocalNotifications.cancel({ notifications: [{ id: Math.abs(hash(id)) }] }); } catch {}

  }

  const next = enabled ? createAutoReminderRecord(todo, deviceId(), db.settings.autoReminderMinutes, new Date()) : null;

  if (!next) {

    if (reminder && !reminder.deleted_at) { reminder.status = 'cancelled'; Object.assign(reminder, softDelete(reminder, iso())); updateRecord('reminders', reminder); }

    return null;

  }

  if (reminder) { Object.assign(reminder, next, { created_at: reminder.created_at || next.created_at }); reminder.deleted_at = null; updateRecord('reminders', reminder); return reminder; }

  db.reminders.push(next); return next;

}

function wire() {

  app.querySelector('#platform-access')?.addEventListener('click',async()=>{try{await NotificationCapture.openAccessSettings();toast('请在 Android 系统页面中打开“允许通知读取”，然后返回应用。');setTimeout(refreshNotificationCapture,1200);}catch{toast('无法打开系统通知读取设置。','error');}});
  app.querySelector('#platform-capture-toggle')?.addEventListener('change',async e=>{const state=await NotificationCapture.getState();const allowed=[...app.querySelectorAll('[data-platform-package]:checked')].map(input=>input.dataset.platformPackage);await NotificationCapture.setConfiguration({enabled:e.target.checked&&state.authorized&&allowed.length>0,allowedPackages:allowed});await refreshNotificationCapture();if(e.target.checked&&!allowed.length)toast('请先选择要读取的平台应用。','error');});
  app.querySelector('#platform-app-list')?.addEventListener('change',async()=>{const state=await NotificationCapture.getState();const allowed=[...app.querySelectorAll('[data-platform-package]:checked')].map(input=>input.dataset.platformPackage);await NotificationCapture.setConfiguration({enabled:state.enabled,allowedPackages:allowed});await refreshNotificationCapture();});
  app.querySelector('#platform-process')?.addEventListener('click',processCapturedNotifications);
  if (Capacitor.isNativePlatform()) void processCapturedNotifications();

  app.querySelectorAll('[data-nav]').forEach(b=>b.addEventListener('click',()=>changePage(b.dataset.nav)));
  app.querySelectorAll('[data-summary-nav]').forEach(card=>card.addEventListener('click',()=>{if(card.dataset.summaryFilter)filter=card.dataset.summaryFilter;changePage(card.dataset.summaryNav);}));

  app.querySelectorAll('[data-delete-course]').forEach(b=>b.addEventListener('click',async()=>{const course=db.courses.find(x=>x.id===b.dataset.deleteCourse);if(!course)return;Object.assign(course,softDelete(course,iso()));await commit();await syncCourseReminders();render();toast('课程已删除');}));

  app.querySelectorAll('[data-edit-course]').forEach(button=>button.addEventListener('click',async()=>{const course=db.courses.find(item=>item.id===button.dataset.editCourse);if(!course)return;const name=prompt('课程名称',course.course_name);if(name===null)return;const weekdayText=prompt('星期（1-7，周一为 1）',String(course.weekday));if(weekdayText===null)return;const start=prompt('开始时间（HH:MM）',course.start_time);if(start===null)return;const end=prompt('结束时间（HH:MM）',course.end_time);if(end===null)return;const weeks=prompt('起止周（例如 1-16）',`${course.start_week}-${course.end_week}`);if(weeks===null)return;const location=prompt('上课地点',course.location||'');if(location===null)return;const weekday=Number(weekdayText.trim());const range=parseWeeks(weeks,'');if(!name.trim()||!Number.isInteger(weekday)||weekday<1||weekday>7||!parseTime(start)||!parseTime(end)||end<=start||!range){toast('课程信息无效，请检查名称、星期、时间和周次范围。','error');return;}const updated={...course,course_name:name.trim(),weekday,start_time:parseTime(start),end_time:parseTime(end),start_week:range[0],end_week:range[1],location:location.trim(),updated_at:iso()};if(live(db.courses).some(item=>item.id!==course.id&&duplicateCourse(item,updated))){toast('修改后与另一门课程重复。','error');return;}Object.assign(course,updated);await commit();await syncCourseReminders({notifyOnPermission:true});render();toast('课程已更新，提醒已重新安排');}));

  app.querySelector('#todo-form')?.addEventListener('submit', async e=>{ e.preventDefault(); const f=new FormData(e.currentTarget); const title=String(f.get('title')).trim(); if(!title)return; const todo=createTodoRecord({title,description:String(f.get('description')||''),due_at:f.get('due_at')?new Date(f.get('due_at')).toISOString():null,priority:f.get('priority'),source:'手动创建'},iso()); db.todos.push(todo); const wantsReminder=f.get('auto_reminder')==='on'; const automatic=await reconcileAutoReminder(todo,wantsReminder); await commit(); if(automatic)await scheduleReminder(automatic); toast(automatic?'待办已添加，截止前提醒已自动设置':!todo.due_at&&wantsReminder?'待办已添加；填写截止时间即可自动提醒':todo.due_at&&wantsReminder?'待办已添加；截止时间太近，无法提前设置提醒':'待办已添加'); render(); });

  app.querySelectorAll('[data-complete]').forEach(b=>b.addEventListener('click',async()=>{const t=db.todos.find(x=>x.id===b.dataset.complete);if(!t)return;const completed=t.status!=='completed';Object.assign(t,setTodoStatus(t,completed?'completed':'open',iso()));if(completed)for(const r of live(db.reminders).filter(x=>x.todo_id===t.id&&x.status==='scheduled')){r.status='cancelled';Object.assign(r,softDelete(r,iso()));const timer=reminderTimers.get(r.id);if(timer)clearTimeout(timer);reminderTimers.delete(r.id);if(Capacitor.isNativePlatform())try{await LocalNotifications.cancel({notifications:[{id:Math.abs(hash(r.id))}]});}catch{}}await commit();render();}));

  app.querySelectorAll('[data-delete-todo]').forEach(b=>b.addEventListener('click',async()=>{const t=db.todos.find(x=>x.id===b.dataset.deleteTodo);if(t){Object.assign(t,softDelete(t,iso()));for(const r of live(db.reminders).filter(x=>x.todo_id===t.id)){r.status='cancelled';Object.assign(r,softDelete(r,iso()));const timer=reminderTimers.get(r.id);if(timer)clearTimeout(timer);reminderTimers.delete(r.id);if(Capacitor.isNativePlatform())try{await LocalNotifications.cancel({notifications:[{id:Math.abs(hash(r.id))}]});}catch{}}await commit();render();toast('待办已删除');}}));

  app.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click',async()=>{const t=db.todos.find(x=>x.id===b.dataset.edit);if(!t)return;const title=prompt('修改待办标题',t.title);if(title===null)return;if(!title.trim())return toast('标题不能为空','error');const dueDefault=t.due_at?new Date(new Date(t.due_at).getTime()-new Date(t.due_at).getTimezoneOffset()*60000).toISOString().slice(0,16):'';const due=prompt('截止时间（YYYY-MM-DDTHH:mm），留空表示无截止时间',dueDefault);if(due===null)return;const priority=prompt('优先级填写 high / medium / low',t.priority||'medium');if(priority===null)return;if(!['high','medium','low'].includes(priority))return toast('优先级需填写 high、medium 或 low。','error');t.title=title.trim();t.due_at=due?new Date(due).toISOString():null;t.priority=priority;t.updated_at=iso();const hasAutoReminder=db.reminders.some(r=>r.id===autoReminderId(t.id)&&!r.deleted_at);const autoReminder=await reconcileAutoReminder(t,db.settings.autoReminderEnabled||hasAutoReminder);await commit();if(autoReminder)await scheduleReminder(autoReminder);render();}));

  app.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{filter=b.dataset.filter;render();}));

  app.querySelector('#course-file')?.addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;importFileName=file.name;try{let rows;if(/\.csv$/i.test(file.name))rows=parseCsv(await file.text());else{const XLSX=await import('xlsx');const book=XLSX.read(await file.arrayBuffer(),{type:'array'});const sheet=book.Sheets[book.SheetNames[0]];rows=parseCsv(XLSX.utils.sheet_to_csv(sheet));}const seen=[];for(const item of rows){if(!item.errors.length){if(seen.some(c=>duplicateCourse(c,item.course))||live(db.courses).some(c=>duplicateCourse(c,item.course)))item.errors.push('与已有课程重复');else seen.push(item.course);}}importRows=rows;render();}catch(err){toast(err.message||'文件无法解析，请检查格式。','error');}});

  app.querySelectorAll('[data-cancel-import]').forEach(b=>b.addEventListener('click',()=>{importRows=[];render();}));

  app.querySelectorAll('[data-import-edit]').forEach(input=>input.addEventListener('change',()=>{const row=importRows[Number(input.dataset.importEdit)];if(!row)return;const field=input.dataset.field;row.course[field]=field==='weekday'||field==='start_week'||field==='end_week'?Number(input.value):input.value;validateImportRows();render();}));

  app.querySelector('[data-confirm-import]')?.addEventListener('click',async()=>{const courses=importRows.filter(x=>!x.errors.length).map(x=>x.course);db.courses.push(...courses);await commit();await syncCourseReminders({notifyOnPermission:true});importRows=[];render();toast(`已导入 ${courses.length} 门课程`);});

  app.querySelector('[data-load-demo]')?.addEventListener('click',async()=>{try{const r=await fetch('./examples/example_courses.csv');const rows=parseCsv(await r.text());const fresh=rows.filter(x=>!x.errors.length&&!live(db.courses).some(c=>duplicateCourse(c,x.course))).map(x=>x.course);db.courses.push(...fresh);await commit();await syncCourseReminders({notifyOnPermission:true});render();toast(`已载入 ${fresh.length} 门演示课程`);}catch{toast('演示文件读取失败。','error');}});

  app.querySelector('#analyze-message')?.addEventListener('click',async()=>{const text=app.querySelector('#message-text').value.trim();const err=app.querySelector('#ai-error');err.hidden=true;if(!text)return toast('请先粘贴一段消息。','error');if(!aiFunctionUrl){err.textContent='尚未配置云端 AI 服务地址；请先填写 Supabase URL。不会用本地伪结果代替 AI。';err.hidden=false;return;}busy=true;app.querySelector('#analyze-message').disabled=true;app.querySelector('#analyze-message').textContent='正在分析…';try{if(!supabase)throw new Error('云端服务未配置。');const token=(await supabase.auth.getSession()).data.session?.access_token;if(!token)throw new Error('请先登录账号，再分析消息。');const res=await fetch(aiFunctionUrl,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({text,source:app.querySelector('#message-source').value,now:new Date().toISOString(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'})});if(!res.ok)throw new Error(res.status===401?'AI 服务需要有效登录。':res.status===429?'AI 服务暂时繁忙，请稍后再试。':'AI 服务请求失败，请检查服务配置。');const result=await res.json();const items=Array.isArray(result.tasks)?result.tasks:result.task?[result.task]:[];if(!items.length){err.textContent='没有识别到明确的待办事项。原消息未保存。';err.hidden=false;return;}db.drafts.push(...createDraftRecords({tasks:items},app.querySelector('#message-source').value,iso()));await commit();app.querySelector('#message-text').value='';toast(`识别出 ${items.length} 条审核草稿`);page='review';render();}catch(e){err.textContent=e.message||'AI 服务不可用，原始消息未保存。';err.hidden=false;}finally{busy=false;}});

  app.querySelectorAll('[data-approve]').forEach(b=>b.addEventListener('click',async()=>{const d=db.drafts.find(x=>x.id===b.dataset.approve);if(!d)return;const todo=todoFromDraft(d,iso());db.todos.push(todo);const automatic=await reconcileAutoReminder(todo,db.settings.autoReminderEnabled);d.deleted_at=iso();updateRecord('drafts',d);await commit();if(automatic)await scheduleReminder(automatic);render();toast(automatic?'已确认并加入待办，提醒已自动设置':'已由你确认并加入待办');}));

  app.querySelectorAll('[data-reject]').forEach(b=>b.addEventListener('click',async()=>{const d=db.drafts.find(x=>x.id===b.dataset.reject);if(d){d.deleted_at=iso();updateRecord('drafts',d);await commit();render();toast('草稿已拒绝');}}));

  app.querySelectorAll('[data-edit-draft]').forEach(b=>b.addEventListener('click',async()=>{const d=db.drafts.find(x=>x.id===b.dataset.editDraft);if(!d)return;const title=prompt('编辑待审核任务标题',d.title);if(title===null)return;if(!title.trim())return toast('标题不能为空','error');d.title=title.trim();d.updated_at=iso();await commit();render();}));

  app.querySelector('#reminder-form')?.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const fireAt=new Date(f.get('fire_at'));if(fireAt<=new Date())return toast('提醒时间需要晚于现在。','error');const todo=activeTodos().find(t=>t.id===f.get('todo_id'));if(!todo)return toast('请先创建一条未完成待办。','error');const duplicate=duplicateReminder(live(db.reminders),todo.id,fireAt);if(duplicate)return toast('这条提醒已经存在。','error');const reminder={id:newId(),todo_id:todo.id,fire_at:fireAt.toISOString(),device_id:deviceId(),sound:Boolean(f.get('sound')),notification_id:null,triggered_at:null,status:'scheduled',created_at:iso(),updated_at:iso(),deleted_at:null};db.reminders.push(reminder);db.settings_updated_at=iso();await commit();await scheduleReminder(reminder);render();toast('提醒已设置');});

  app.querySelectorAll('[data-delete-reminder]').forEach(b=>b.addEventListener('click',async()=>{const r=db.reminders.find(x=>x.id===b.dataset.deleteReminder);if(r){const timer=reminderTimers.get(r.id);if(timer)clearTimeout(timer);reminderTimers.delete(r.id);r.deleted_at=iso();updateRecord('reminders',r);await commit();if(Capacitor.isNativePlatform())try{await LocalNotifications.cancel({notifications:[{id:Math.abs(hash(r.id))}]});}catch{}render();toast('提醒已删除');}}));

  app.querySelectorAll('[data-edit-reminder]').forEach(b=>b.addEventListener('click',async()=>{const r=db.reminders.find(x=>x.id===b.dataset.editReminder);if(!r)return;const initial=new Date(new Date(r.fire_at).getTime()-new Date(r.fire_at).getTimezoneOffset()*60000).toISOString().slice(0,16);const value=prompt('修改提醒时间（YYYY-MM-DDTHH:mm）',initial);if(value===null)return;const next=new Date(value);if(Number.isNaN(next.getTime())||next<=new Date())return toast('提醒时间格式无效或已过期。','error');if(live(db.reminders).some(x=>x.id!==r.id&&x.todo_id===r.todo_id&&new Date(x.fire_at).getTime()===next.getTime()))return toast('这条提醒已经存在。','error');if(Capacitor.isNativePlatform())try{await LocalNotifications.cancel({notifications:[{id:Math.abs(hash(r.id))}]});}catch{}r.fire_at=next.toISOString();r.status='scheduled';r.triggered_at=null;updateRecord('reminders',r);await commit();await scheduleReminder(r);render();toast('提醒时间已更新');}));

  app.querySelector('#reminder-master')?.addEventListener('change',async e=>{db.settings.remindersEnabled=e.target.checked;db.settings_updated_at=iso();await commit();if(!e.target.checked){for(const timer of reminderTimers.values())clearTimeout(timer);reminderTimers.clear();if(Capacitor.isNativePlatform())try{await LocalNotifications.cancel({notifications:live(db.reminders).filter(r=>r.device_id===deviceId()).map(r=>({id:Math.abs(hash(r.id))}))});}catch{}}else live(db.reminders).forEach(scheduleReminder);await syncCourseReminders();toast(e.target.checked?'提醒已开启':'提醒已关闭');});

  app.querySelectorAll('#test-reminder').forEach(b=>b.addEventListener('click',async()=>{try{if(Capacitor.isNativePlatform()){await notificationChannelsReady;await LocalNotifications.requestPermissions();await LocalNotifications.schedule({notifications:[{id:Math.floor(Math.random()*1000000),title:'测试提醒',body:'提醒通知已正常工作。',channelId:reminderChannelId(db.settings.ringtone!=='silent',db.settings.vibration!==false),schedule:{at:new Date(Date.now()+1000)}}]});}else if(window.desktopBridge)window.desktopBridge.notify({title:'测试提醒',body:'桌面通知已正常工作。',silent:db.settings.ringtone==='silent'});else if('Notification'in window){if(Notification.permission!=='granted')await Notification.requestPermission();if(Notification.permission==='granted')new Notification('测试提醒',{body:'通知权限已开启。'});}toast('已发送测试提醒');}catch{toast('无法发送通知，请检查系统通知权限。','error');}}));

  app.querySelector('#theme-select')?.addEventListener('change',async e=>{db.settings.theme=e.target.value;db.settings_updated_at=iso();await commit();render();});

  app.querySelector('#ringtone-select')?.addEventListener('change',async e=>{db.settings.ringtone=e.target.value;db.settings_updated_at=iso();await commit();if(Capacitor.isNativePlatform()){const pending=live(db.reminders).filter(r=>r.device_id===deviceId()&&r.status==='scheduled');try{await LocalNotifications.cancel({notifications:pending.map(r=>({id:Math.abs(hash(r.id))}))});}catch{}for(const r of pending)await scheduleReminder(r);}await syncCourseReminders();render();});

  app.querySelector('#vibration-toggle')?.addEventListener('change',async e=>{db.settings.vibration=e.target.checked;db.settings_updated_at=iso();await commit();if(Capacitor.isNativePlatform()){const pending=live(db.reminders).filter(r=>r.device_id===deviceId()&&r.status==='scheduled');try{await LocalNotifications.cancel({notifications:pending.map(r=>({id:Math.abs(hash(r.id))}))});}catch{}for(const r of pending)await scheduleReminder(r);}await syncCourseReminders();render();toast(e.target.checked?'手机震动提醒已开启':'手机震动提醒已关闭');});
  app.querySelector('#auto-reminder-default')?.addEventListener('change',async e=>{db.settings.autoReminderEnabled=e.target.checked;db.settings_updated_at=iso();await commit();toast(e.target.checked?'新待办将默认设置自动提醒':'已关闭新待办默认自动提醒');});
  app.querySelector('#auto-reminder-lead')?.addEventListener('change',async e=>{db.settings.autoReminderMinutes=Number(e.target.value)||60;db.settings_updated_at=iso();await commit();toast('默认自动提醒时间已更新');});

  app.querySelector('#semester-start-date')?.addEventListener('change',async e=>{db.settings.semesterStartDate=e.target.value||'';db.settings_updated_at=iso();await commit();await syncCourseReminders({notifyOnPermission:true});render();});
  app.querySelector('#course-reminder-toggle')?.addEventListener('change',async e=>{db.settings.courseReminderEnabled=e.target.checked;db.settings_updated_at=iso();await commit();await syncCourseReminders({notifyOnPermission:true});toast(e.target.checked?'课程提醒已开启':'课程提醒已关闭');});
  app.querySelector('#course-reminder-lead')?.addEventListener('change',async e=>{db.settings.courseReminderMinutes=Number(e.target.value)||15;db.settings_updated_at=iso();await commit();await syncCourseReminders();toast('课程提醒提前时间已更新');});

  app.querySelector('#auth-switch')?.addEventListener('click',()=>{authMode='switch';render();});
  app.querySelector('#auth-logout')?.addEventListener('click',async()=>{const {error}=await supabase.auth.signOut();if(error){toast('退出失败，请检查网络后重试。','error');return;}authMode='login';toast('已退出登录');});
   app.querySelector('#auth-form')?.addEventListener('submit',async e=>{

     e.preventDefault();

     const form=e.currentTarget;const action=e.submitter?.value||'login';const f=new FormData(form);

     const email=String(f.get('email')||'').trim();const password=String(f.get('password')||'');

     const report=message=>{const target=app.querySelector('#auth-status');if(target)target.textContent=message;};

     const setBusy=value=>{app.querySelectorAll('#auth-form button:not([type="button"])').forEach(button=>{button.disabled=value;});};

     if(action!=='logout'&&!email)return report('请先填写邮箱地址。');

     if(['login','register'].includes(action)&&password.length<8)return report('密码至少需要 8 位。');

     setBusy(true);report(action==='register'?'正在提交注册…':action==='login'?'正在登录…':action==='recover'?'正在请求密码恢复…':'正在退出登录…');

     try{

       let result;

       if(action==='register')result=await supabase.auth.signUp({email,password});

       else if(action==='recover')result=await supabase.auth.resetPasswordForEmail(email);

       else if(action==='logout')result=await supabase.auth.signOut();

       else result=await supabase.auth.signInWithPassword({email,password});

       if(result.error){

         const detail=result.error.message||'未知错误';

         report(detail.toLowerCase().includes('email address not authorized')?'Supabase 默认邮件服务未授权向此邮箱发送邮件；请配置 SMTP，或测试时关闭 Email Confirmation。':`操作失败：${detail}`);

         return;

       }

       if(action==='register'){

         if(result.data?.session){report('注册成功，正在连接云端…');await syncCloud({notify:true});report('注册成功。请查看页面上的同步状态。');}

         else report('注册申请已提交，请查收邮箱并完成验证；也请检查垃圾邮件。');

       }else if(action==='login'){await syncCloud({notify:true,successToast:'登录并同步成功'});report('登录完成。请查看页面上的同步状态。');}

       else if(action==='recover')report('如果该邮箱已注册，密码恢复邮件会发送到该邮箱。');

       else report('已退出登录。');

     }catch(error){

       const detail=String(error?.message||'网络请求失败');

       report(`请求未完成：${detail}。请检查网络连接后重试。`);

     }finally{app.querySelectorAll('#auth-form button:not([type="button"])').forEach(button=>{button.disabled=false;});}

   });

  app.querySelector('#sync-now')?.addEventListener('click',async()=>{await syncCloud({notify:true,successToast:'已完成云端同步'});});

   app.querySelector('#delete-account')?.addEventListener('click',async()=>{if(!confirm('确定永久删除账号和云端个人数据？此操作不可撤销。'))return;const {error}=await supabase.functions.invoke('delete-account',{body:{}});if(error)return toast('删除失败。请检查已部署 delete-account 函数及其 secrets。','error');await supabase.auth.signOut();db={courses:[],todos:[],drafts:[],reminders:[],settings:{remindersEnabled:true,sound:false,ringtone:'reminder',vibration:true,theme:'light'}};await commit();syncState='offline';render();toast('账号及云端个人数据已删除');});

  app.querySelector('#export-data')?.addEventListener('click',()=>{const blob=new Blob([JSON.stringify(db,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='知序数据备份.json';a.click();URL.revokeObjectURL(a.href);});

  app.querySelector('#backup-file')?.addEventListener('change',async e=>{try{const value=JSON.parse(await e.target.files[0].text());if(!Array.isArray(value.courses)||!Array.isArray(value.todos))throw new Error();db={...db,...value};await commit();render();toast('数据备份已导入');}catch{toast('备份文件格式不正确。','error');}});

}

render();

window.addEventListener('offline',()=>{syncState='offline';render();});

window.addEventListener('online',()=>{if(supabase)void syncCloud();});

if(supabase){supabase.auth.onAuthStateChange(async(_event,session)=>{const previousId=authSession?.user?.id||null;const nextId=session?.user?.id||null;authSession=session;if(previousId!==nextId){db=await loadData(nextId);authMode=session?'account':'login';syncState=session?'syncing':'offline';render();await syncCourseReminders();}await connectRealtime(session);if(session)void syncCloud();else{syncState='offline';render();}});if(authSession)void syncCloud();}

live(db.reminders).filter(r=>r.status==='scheduled'&&!r.triggered_at&&r.device_id===deviceId()).forEach(scheduleReminder);

void syncCourseReminders();

window.addEventListener('focus',()=>{const timezone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';if(timezone!==knownTimezone||Capacitor.isNativePlatform()||window.desktopBridge)void syncCourseReminders();});

if(Capacitor.isNativePlatform()) { void NotificationCapture.addListener('notificationCaptured',processCapturedNotifications); LocalNotifications.addListener('localNotificationReceived',async({notification})=>{toast(`提醒：${notification.body||'有一项任务需要关注'}`);const reminder=db.reminders.find(r=>r.id===notification.extra?.reminderId);if(reminder&&!reminder.triggered_at){reminder.status='sent';reminder.triggered_at=iso();updateRecord('reminders',reminder);await commit();}}); }

if(Capacitor.isNativePlatform()) LocalNotifications.addListener('localNotificationActionPerformed',async({notification})=>{const id=notification.extra?.reminderId;const reminder=db.reminders.find(r=>r.id===id);if(reminder&&!reminder.triggered_at){reminder.status='sent';reminder.triggered_at=iso();updateRecord('reminders',reminder);await commit();}});
