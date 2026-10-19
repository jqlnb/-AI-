import { createClient } from '@supabase/supabase-js';
import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';
import { mergeCloudRows } from './core.mjs';

const KEY = 'study-planner-data-v1';
const scopedKey = userId => userId ? `${KEY}:user:${userId}` : `${KEY}:local`;
const empty = () => ({ courses: [], todos: [], drafts: [], reminders: [], settings: { remindersEnabled: true, sound: true, ringtone: 'reminder', vibration: true, autoReminderEnabled: true, autoReminderMinutes: 60, courseReminderEnabled: true, courseReminderMinutes: 15, semesterStartDate: '', theme: 'light' } });
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = import.meta.env.VITE_SUPABASE_URL && supabaseKey
  ? createClient(import.meta.env.VITE_SUPABASE_URL, supabaseKey) : null;
export const aiFunctionUrl = import.meta.env.VITE_AI_FUNCTION_URL || (import.meta.env.VITE_SUPABASE_URL ? `${import.meta.env.VITE_SUPABASE_URL.replace(/\/$/, '')}/functions/v1/extract-message` : '');
export async function loadData(userId = null) {
  try {
    const key = scopedKey(userId);
    const saved = Capacitor.isNativePlatform() ? await Preferences.get({ key }) : { value: localStorage.getItem(key) };
    // V1's shared cache has no trustworthy owner ID. Only migrate it to the signed-out local profile;
    // never attach unowned rows to whichever account happens to be active.
    const legacy = saved.value || userId ? null : Capacitor.isNativePlatform() ? await Preferences.get({ key: KEY }) : { value: localStorage.getItem(KEY) };
    const raw = saved.value || legacy?.value;
    const defaults = empty(); const savedData = raw ? JSON.parse(raw) : {};
    if (legacy?.value && !saved.value) {
      await saveData({ ...defaults, ...savedData }, userId);
      if (Capacitor.isNativePlatform()) await Preferences.remove({ key: KEY }); else localStorage.removeItem(KEY);
    }
    return { ...defaults, ...savedData, settings: { ...defaults.settings, ...(savedData.settings || {}) } };
  } catch { return empty(); }
}
export async function saveData(data, userId = null) {
  const value = JSON.stringify(data);
  const key = scopedKey(userId);
  if (Capacitor.isNativePlatform()) await Preferences.set({ key, value }); else localStorage.setItem(key, value);
}
export async function syncData(data) {
  if (!supabase) throw new Error('尚未配置 Supabase。数据已保存在本机；请在 .env 中填写服务地址和 anon key。');
  const { data: { session }, error: authError } = await supabase.auth.getSession();
  if (authError) throw authError;
  if (!session) throw new Error('登录后即可同步到云端。');
  const uid = session.user.id; const tables = ['courses', 'todos', 'drafts', 'reminders'];
  for (const table of tables) {
    const { data: remote, error } = await supabase.from(table).select('*').eq('user_id', uid); if (error) throw error;
    const { rows, upserts } = mergeCloudRows(data[table], remote, uid);
    if (upserts.length) { const { error: writeError } = await supabase.from(table).upsert(upserts, { onConflict: 'id' }); if (writeError) throw writeError; }
    data[table] = rows.filter(row => !row.deleted_at);
  }
  const { data: remoteSettings, error: settingsError } = await supabase.from('user_settings').select('settings,updated_at').eq('user_id', uid).maybeSingle();
  if (settingsError) throw settingsError;
  if (!remoteSettings || new Date(data.settings_updated_at || 0) > new Date(remoteSettings.updated_at)) {
    const { error } = await supabase.from('user_settings').upsert({ user_id: uid, settings: data.settings, updated_at: data.settings_updated_at || new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) throw error;
  } else { data.settings = { ...data.settings, ...(remoteSettings.settings || {}) }; data.settings_updated_at = remoteSettings.updated_at; }
  return data;
}
