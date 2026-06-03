import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  BarChart3,
  CalendarDays,
  Check,
  Dumbbell,
  GripVertical,
  Home,
  Library,
  Lock,
  LogOut,
  Pencil,
  Share2,
  Trophy,
  WifiOff,
  X,
  Pause,
  Play,
  Plus,
  Settings,
  Trash2,
  TrendingUp,
  UserRound
} from 'lucide-react';
import { WheelPicker as ReactWheelPicker, WheelPickerWrapper } from '@ncdai/react-wheel-picker';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import '@ncdai/react-wheel-picker/style.css';
import './styles.css';
import { createT } from './i18n.js';

// ═══════════════════════════════════════════════════════════════════════════════
// gymStore — Single source of truth cho mọi data của user
// ═══════════════════════════════════════════════════════════════════════════════
// Mọi UI đọc qua gymStore.read(userId). Mọi mutation đi qua gymStore.upsert/delete.
// Mỗi entity có field syncStatus: 'synced' | 'pending' | 'failed'.
// pendingMutations chứa các thao tác chờ sync lên server.
// ═══════════════════════════════════════════════════════════════════════════════

const STORE_KEY = (userId) => `gymStore:${userId}`;
const STORE_VERSION = 1;

function createEmptyStore() {
  return {
    version: STORE_VERSION,
    groups: [],                 // { id, name, icon, color_hex, exercises: [], syncStatus, tempId? }
    routines: [],               // { id, name, groups: [], exercises: [], syncStatus }
    scheduleRules: [],          // { id, mode, day_of_week, order_index, routine_id, syncStatus }
    customExercises: [],        // { id, ...fields, syncStatus }
    sessions: [],               // { id, ...fields, syncStatus }
    workoutLogs: [],            // { id, sessionId, exerciseId, ..., syncStatus }
    bodyWeights: [],
    settings: null,
    bootstrap: null,            // cache bootstrap response
    dashboard: null,            // cache dashboard
    pendingMutations: [],       // [{ id, type, payload, createdAt, attempts }]
    lastFullSync: 0
  };
}

const storeListeners = new Map(); // userId → Set<callback>

function notifyStoreListeners(userId) {
  const uid = Number(userId);
  const listeners = storeListeners.get(uid);
  if (!listeners) return;
  for (const cb of listeners) { try { cb(); } catch {} }
}

function subscribeStore(userId, callback) {
  const uid = Number(userId);
  if (!storeListeners.has(uid)) storeListeners.set(uid, new Set());
  storeListeners.get(uid).add(callback);
  return () => storeListeners.get(uid)?.delete(callback);
}

function readStore(userId) {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY(Number(userId))) || 'null');
    if (!raw || raw.version !== STORE_VERSION) return createEmptyStore();
    return { ...createEmptyStore(), ...raw };
  } catch {
    return createEmptyStore();
  }
}

function writeStore(userId, store) {
  try {
    localStorage.setItem(STORE_KEY(Number(userId)), JSON.stringify(store));
    notifyStoreListeners(Number(userId));
  } catch {}
}

function updateStore(userId, updater) {
  const current = readStore(userId);
  const next = updater(current) || current;
  writeStore(userId, next);
  return next;
}

// Replace toàn bộ collection sau khi fetch server (server là nguồn chuẩn).
// Giữ lại pending entities (chưa sync lên server) ở cuối.
// Chỉ giữ pending entities còn trong offline queue — tránh ghost pending sau khi sync.
function pendingQueueIds(userId) {
  const queue = getOfflineQueue(Number(userId));
  return {
    groupIds: new Set(queue.filter((e) => e.type === 'createGroup').map((e) => String(e.groupId))),
    ruleIds: new Set(queue.filter((e) => e.type === 'assignScheduleRule').map((e) => String(e.ruleId)))
  };
}

function replaceCollection(userId, key, items) {
  updateStore(userId, (store) => {
    const synced = (items || []).map((it) => ({ ...it, syncStatus: 'synced' }));
    const serverIds = new Set((items || []).map((it) => String(it.id)));
    const { groupIds, ruleIds } = pendingQueueIds(userId);
    const pending = (store[key] || []).filter((it) => {
      if (it.syncStatus !== 'pending') return false;
      if (serverIds.has(String(it.id))) return false; // đã có trên server → bỏ
      if (key === 'groups') return groupIds.has(String(it.id));
      if (key === 'scheduleRules') return ruleIds.has(String(it.id));
      return false;
    });
    return { ...store, [key]: [...synced, ...pending] };
  });
}

function upsertEntity(userId, key, entity) {
  updateStore(userId, (store) => {
    const items = store[key] || [];
    const idx = items.findIndex((it) => String(it.id) === String(entity.id));
    const next = idx >= 0
      ? items.map((it, i) => i === idx ? { ...it, ...entity } : it)
      : [...items, entity];
    return { ...store, [key]: next };
  });
}

function deleteEntity(userId, key, id) {
  updateStore(userId, (store) => ({
    ...store,
    [key]: (store[key] || []).filter((it) => String(it.id) !== String(id))
  }));
}

function replacePendingId(userId, key, tempId, realEntity) {
  updateStore(userId, (store) => ({
    ...store,
    [key]: (store[key] || []).map((it) => String(it.id) === String(tempId) ? { ...realEntity, syncStatus: 'synced' } : it)
  }));
}

function setScalarField(userId, key, value) {
  updateStore(userId, (store) => ({ ...store, [key]: value }));
}

// Pending mutations queue
function enqueueMutation(userId, mutation) {
  const id = `mut_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  updateStore(userId, (store) => ({
    ...store,
    pendingMutations: [...(store.pendingMutations || []), { id, attempts: 0, createdAt: Date.now(), ...mutation }]
  }));
  return id;
}

function removeMutation(userId, mutationId) {
  updateStore(userId, (store) => ({
    ...store,
    pendingMutations: (store.pendingMutations || []).filter((m) => m.id !== mutationId)
  }));
}

function getMutations(userId) {
  return readStore(userId).pendingMutations || [];
}

function bumpMutationAttempt(userId, mutationId) {
  updateStore(userId, (store) => ({
    ...store,
    pendingMutations: (store.pendingMutations || []).map((m) => m.id === mutationId ? { ...m, attempts: (m.attempts || 0) + 1, lastError: undefined } : m)
  }));
}

const gymStore = {
  read: readStore,
  write: writeStore,
  update: updateStore,
  replaceCollection,
  upsert: upsertEntity,
  delete: deleteEntity,
  replacePendingId,
  setScalar: setScalarField,
  enqueue: enqueueMutation,
  removeMutation,
  getMutations,
  bumpAttempt: bumpMutationAttempt,
  subscribe: subscribeStore,
  notify: notifyStoreListeners
};

// React hook: đọc store + auto-rerender khi store thay đổi
function useGymStore(userId, selector) {
  const select = selector || ((s) => s);
  const [snapshot, setSnapshot] = useState(() => select(readStore(userId)));
  useEffect(() => {
    if (!userId) return;
    setSnapshot(select(readStore(userId)));
    return subscribeStore(userId, () => setSnapshot(select(readStore(userId))));
  }, [userId]);
  return snapshot;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── Live sync via SSE ─────────────────────────────────────────────────────────
function useLiveSync(userId, onRefresh) {
  useEffect(() => {
    if (!userId) return;
    let es;
    let retryTimeout;
    const connect = () => {
      es = new EventSource(`/api/events?userId=${userId}`);
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === 'refresh') onRefresh(data);
        } catch {}
      };
      es.onerror = () => {
        es.close();
        retryTimeout = setTimeout(connect, 5000);
      };
    };
    connect();
    return () => { es?.close(); clearTimeout(retryTimeout); };
  }, [userId]);
}
// ─────────────────────────────────────────────────────────────────────────────

// ── Offline media cache ───────────────────────────────────────────────────────
const MEDIA_CACHE = 'exercise-media';

async function cacheMediaUrls(urls, onProgress) {
  const cache = await caches.open(MEDIA_CACHE);
  let done = 0;
  const total = urls.length;
  for (const url of urls) {
    try {
      const cached = await cache.match(url);
      if (!cached) await cache.add(url);
    } catch {}
    done++;
    onProgress?.(done, total);
  }
  return done;
}

async function downloadGroupsForOffline(userId, onProgress) {
  const groups = await api(`/api/groups?userId=${userId}`);
  const routinesPayload = await api(`/api/routines?userId=${userId}`).catch(() => ({ routines: [] }));
  const activePayload = await api(`/api/sessions/active?userId=${userId}`).catch(() => ({ sessions: [] }));
  const urls = [];
  const collect = (exercises = []) => {
    for (const exercise of exercises) {
      if (exercise.imageUrl) urls.push(exercise.imageUrl);
      if (exercise.gifUrl) urls.push(exercise.gifUrl);
    }
  };
  for (const group of groups) collect(group.exercises || []);
  for (const routine of routinesPayload.routines || []) collect(routine.exercises || []);
  for (const session of activePayload.sessions || []) collect(session.exercises || []);
  const unique = [...new Set(urls)];
  return cacheMediaUrls(unique, onProgress);
}
// ──────────────────────────────────────────────────────────────────────────────

// ── Server status (centralized) ──────────────────────────────────────────────
async function checkServerAvailable(timeoutMs = 2500) {
  const ping = `${Date.now()}-${Math.random()}`;
  const attempts = [
    { method: 'HEAD', url: `/api/health?ping=${ping}` },
    { method: 'GET', url: `/api/health?ping=${ping}&fallback=1` }
  ];
  for (const attempt of attempts) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(attempt.url, {
        method: attempt.method,
        cache: 'no-store',
        signal: controller.signal,
        headers: { 'Cache-Control': 'no-store, no-cache, max-age=0' }
      });
      if (response.ok || response.status === 204) return true;
    } catch {
      // Try the next method. Some reverse proxies do not forward HEAD reliably.
    } finally {
      clearTimeout(timeout);
    }
  }
  return false;
}

const ServerStatusContext = React.createContext({ online: false, forceCheck: () => {} });
function useServerStatus() { return React.useContext(ServerStatusContext); }

function ServerStatusProvider({ children }) {
  const [online, setOnline] = useState(false);
  const onlineRef = React.useRef(false);
  const timerRef = React.useRef(null);

  const check = React.useCallback(async () => {
    const ok = await checkServerAvailable();
    onlineRef.current = ok;
    setOnline(ok);
    return ok;
  }, []);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      await check();
      schedule();
    };

    const schedule = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      // Adaptive: online → 30s tiết kiệm pin, offline → 5s để biết có mạng lại
      const delay = onlineRef.current ? 30000 : 5000;
      timerRef.current = setTimeout(tick, delay);
    };

    // Initial check
    check();
    schedule();

    const onWindowOnline = () => check();
    const onWindowOffline = () => { onlineRef.current = false; setOnline(false); };
    const onVisible = () => { if (!document.hidden) check(); };

    window.addEventListener('online', onWindowOnline);
    window.addEventListener('offline', onWindowOffline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      window.removeEventListener('online', onWindowOnline);
      window.removeEventListener('offline', onWindowOffline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [check]);

  const value = useMemo(() => ({ online, forceCheck: check }), [online, check]);
  return <ServerStatusContext.Provider value={value}>{children}</ServerStatusContext.Provider>;
}

const OFFLINE_QUEUE_KEY = (userId) => `gymOfflineQueue:${userId}`;

function getOfflineQueue(userId) {
  try { return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY(userId)) || '[]'); } catch { return []; }
}
function saveOfflineQueue(userId, queue) {
  localStorage.setItem(OFFLINE_QUEUE_KEY(userId), JSON.stringify(queue));
}
function addToOfflineQueue(userId, entry) {
  let q = getOfflineQueue(userId);
  if (entry.type === 'settingsUpdate') {
    const previousSettings = q.filter((item) => item.type === 'settingsUpdate');
    q = q.filter((item) => item.type !== 'settingsUpdate');
    entry = {
      ...entry,
      body: Object.assign({}, ...previousSettings.map((item) => item.body || {}), entry.body || {})
    };
  }
  if (entry.type === 'createSession') {
    const existing = q.find((item) => item.type === 'createSession'
      && item.routineId === entry.routineId
      && item.groupId === entry.groupId
      && !q.some((other) => other.type === 'deleteSession' && Number(other.sessionId) === Number(item.sessionId)));
    if (existing) return existing.sessionId;
  }
  if (entry.type === 'deleteSession') {
    const localOnly = q.some((item) => item.type === 'createSession' && Number(item.sessionId) === Number(entry.sessionId));
    q = q.filter((item) => Number(item.sessionId) !== Number(entry.sessionId));
    if (localOnly) {
      saveOfflineQueue(userId, q);
      clearWorkoutApiCaches(userId);
      return null;
    }
  }
  if (entry.type === 'complete') {
    q = q.filter((item) => !(item.type === 'complete' && Number(item.sessionId) === Number(entry.sessionId)));
  }
  q.push({ ...entry, tempId: Date.now() + Math.random(), queuedAt: new Date().toISOString(), syncStatus: 'pending' });
  saveOfflineQueue(userId, q);
  if (entry.type === 'complete' || entry.type === 'deleteSession') clearWorkoutApiCaches(userId);
  return entry.sessionId || entry.tempId;
}
async function flushOfflineQueue(userId) {
  const queue = getOfflineQueue(userId);
  if (!queue.length) return 0;
  const failed = [];
  const localSessionIds = new Set(queue.filter((entry) => entry.type === 'createSession').map((entry) => Number(entry.sessionId)));
  const sessionIdMap = new Map();
  const groupIdMap = new Map();
  for (const entry of queue) {
    try {
      if (entry.type === 'deleteGroup') {
        const realGroupId = groupIdMap.get(String(entry.groupId)) || entry.groupId;
        if (!String(realGroupId).startsWith('offline_')) {
          await api(`/api/groups/${realGroupId}`, { method: 'DELETE', offlineQueue: false, body: JSON.stringify({ userId }) });
        }
      } else if (entry.type === 'createGroup') {
        const created = await api('/api/groups', { method: 'POST', offlineQueue: false, body: JSON.stringify({ userId, name: entry.name, icon: entry.icon, colorHex: entry.colorHex }) });
        groupIdMap.set(String(entry.groupId), created.id);
      } else if (entry.type === 'addGroupExercise') {
        const groupId = groupIdMap.get(String(entry.groupId)) || entry.groupId;
        if (String(entry.groupId).startsWith('offline_') && !groupIdMap.has(String(entry.groupId))) throw new Error('Offline group has not synced yet');
        await api(`/api/groups/${groupId}/exercises`, { method: 'POST', offlineQueue: false, body: JSON.stringify({ userId, exerciseId: entry.exerciseId }) });
      } else if (entry.type === 'removeGroupExercise') {
        const groupId = groupIdMap.get(String(entry.groupId)) || entry.groupId;
        if (String(entry.groupId).startsWith('offline_') && !groupIdMap.has(String(entry.groupId))) continue;
        await api(`/api/groups/${groupId}/exercises/${entry.exerciseId}?userId=${userId}`, { method: 'DELETE', offlineQueue: false });
      } else if (entry.type === 'reorderGroupExercises') {
        const groupId = groupIdMap.get(String(entry.groupId)) || entry.groupId;
        if (String(entry.groupId).startsWith('offline_') && !groupIdMap.has(String(entry.groupId))) throw new Error('Offline group has not synced yet');
        await api(`/api/groups/${groupId}/exercises-order`, { method: 'PATCH', offlineQueue: false, body: JSON.stringify({ userId, exerciseIds: entry.exerciseIds }) });
      } else if (entry.type === 'assignScheduleRule') {
        await api('/api/schedule-rules', { method: 'POST', offlineQueue: false, body: JSON.stringify({ userId, routineId: entry.routineId, mode: entry.mode, dayOfWeek: entry.dayOfWeek, orderIndex: entry.orderIndex }) });
      } else if (entry.type === 'deleteScheduleRule') {
        if (!String(entry.ruleId).startsWith('offline_')) {
          await api(`/api/schedule-rules/${entry.ruleId}?userId=${userId}`, { method: 'DELETE', offlineQueue: false });
        }
      } else if (entry.type === 'settingsUpdate') {
        await api('/api/settings', { method: 'PATCH', offlineQueue: false, body: JSON.stringify({ userId, ...(entry.body || {}) }) });
      } else if (entry.type === 'createSession') {
        const created = await api('/api/sessions', {
          method: 'POST',
          offlineQueue: false,
          body: JSON.stringify({ userId, routineId: entry.routineId, groupId: entry.groupId, scheduleMode: entry.scheduleMode || 'FREE' })
        });
        sessionIdMap.set(Number(entry.sessionId), created.id);
      } else if (entry.type === 'log') {
        const sessionId = sessionIdMap.get(Number(entry.sessionId)) || entry.sessionId;
        if (localSessionIds.has(Number(entry.sessionId)) && !sessionIdMap.has(Number(entry.sessionId))) throw new Error('Offline session has not synced yet');
        await api(`/api/sessions/${sessionId}/logs`, { method: 'POST', offlineQueue: false, body: JSON.stringify({ userId, exerciseId: entry.exerciseId, weightKg: entry.weightKg, weightUnit: entry.weightUnit, reps: entry.reps }) });
      } else if (entry.type === 'complete') {
        const sessionId = sessionIdMap.get(Number(entry.sessionId)) || entry.sessionId;
        if (localSessionIds.has(Number(entry.sessionId)) && !sessionIdMap.has(Number(entry.sessionId))) throw new Error('Offline session has not synced yet');
        await api(`/api/sessions/${sessionId}/complete`, { method: 'POST', offlineQueue: false, body: JSON.stringify({ userId }) });
      } else if (entry.type === 'deleteSession') {
        const sessionId = sessionIdMap.get(Number(entry.sessionId)) || entry.sessionId;
        if (localSessionIds.has(Number(entry.sessionId)) && !sessionIdMap.has(Number(entry.sessionId))) continue;
        await api(`/api/sessions/${sessionId}`, { method: 'DELETE', offlineQueue: false, body: JSON.stringify({ userId }) });
      }
    } catch {
      const mappedSessionId = sessionIdMap.get(Number(entry.sessionId));
      const mappedGroupId = groupIdMap.get(String(entry.groupId));
      failed.push({
        ...entry,
        ...(mappedSessionId ? { sessionId: mappedSessionId } : {}),
        ...(mappedGroupId ? { groupId: mappedGroupId } : {})
      });
    }
  }
  saveOfflineQueue(userId, failed);
  if (failed.length !== queue.length) {
    clearWorkoutApiCaches(userId);
    // Sync xong → fetch lại để gymStore replace tempId bằng realId + clear pending markers
    await Promise.all([
      api(`/api/groups?userId=${userId}`).catch(() => {}),
      api(`/api/routines?userId=${userId}`).catch(() => {})
    ]);
  }
  return queue.length - failed.length;
}

async function syncPendingBeforeCatalogLoad(userId) {
  const queue = getOfflineQueue(userId);
  if (!queue.length) return;
  const hasCatalogChanges = queue.some((entry) => [
    'createGroup',
    'addGroupExercise',
    'removeGroupExercise',
    'reorderGroupExercises',
    'assignScheduleRule',
    'deleteScheduleRule'
  ].includes(entry.type));
  if (!hasCatalogChanges) return;
  if (!(await checkServerAvailable(700))) return;
  await flushOfflineQueue(userId).catch(() => {});
}

function userIdFromApiPath(path) {
  try {
    const url = new URL(path, window.location.origin);
    return Number(url.searchParams.get('userId') || 1);
  } catch {
    return 1;
  }
}

function pendingOfflineState(userId) {
  const queue = getOfflineQueue(userId);
  const createdGroups = queue.filter((entry) => entry.type === 'createGroup');
  const addGroupExercises = queue.filter((entry) => entry.type === 'addGroupExercise');
  const removeGroupExercises = queue.filter((entry) => entry.type === 'removeGroupExercise');
  const reorderedGroupExercises = queue.filter((entry) => entry.type === 'reorderGroupExercises');
  const assignedScheduleRules = queue.filter((entry) => entry.type === 'assignScheduleRule');
  const deletedScheduleRuleIds = new Set(queue.filter((entry) => entry.type === 'deleteScheduleRule').map((entry) => String(entry.ruleId)));
  const deletedSessionIds = new Set(queue.filter((entry) => entry.type === 'deleteSession').map((entry) => Number(entry.sessionId)));
  const completedSessionIds = new Set(queue.filter((entry) => entry.type === 'complete').map((entry) => Number(entry.sessionId)));
  const createdSessions = queue.filter((entry) => entry.type === 'createSession' && !deletedSessionIds.has(Number(entry.sessionId)));
  const logs = queue.filter((entry) => entry.type === 'log' && !deletedSessionIds.has(Number(entry.sessionId)));
  return { queue, logs, createdSessions, deletedSessionIds, completedSessionIds, createdGroups, addGroupExercises, removeGroupExercises, reorderedGroupExercises, assignedScheduleRules, deletedScheduleRuleIds };
}

function readApiCache(path) {
  try { return JSON.parse(localStorage.getItem(API_CACHE_PREFIX + path) || 'null'); } catch { return null; }
}

function settingsPatchToCacheFields(body = {}) {
  const fields = {};
  const map = {
    scheduleMode: 'schedule_mode',
    timezone: 'timezone',
    locale: 'locale',
    heightCm: 'height_cm',
    defaultWeightUnit: 'default_weight_unit',
    gender: 'gender',
    birthDate: 'birth_date',
    heightUnit: 'height_unit',
    clockFormat: 'clock_format',
    restSeconds: 'rest_seconds',
    defaultSets: 'default_sets',
    defaultReps: 'default_reps',
    progressiveOverload: 'progressive_overload',
    soundRestDone: 'sound_rest_done',
    vibrateRestDone: 'vibrate_rest_done',
    countdown3s: 'countdown_3s',
    autoNextSet: 'auto_next_set',
    keepScreenAwake: 'keep_screen_awake',
    notifyWorkout: 'notify_workout',
    notifyWorkoutTime: 'notify_workout_time',
    notifyMissedWorkout: 'notify_missed_workout',
    notifyMissedWorkoutTime: 'notify_missed_workout_time',
    notifyRecovery: 'notify_recovery',
    notifyUnfinishedAfterMinutes: 'notify_unfinished_after_minutes',
    notifyWeigh: 'notify_weigh',
    notifyWeighFrequency: 'notify_weigh_frequency',
    notifyWeighTime: 'notify_weigh_time',
    notifyProgressPhoto: 'notify_progress_photo',
    notifyProgressPhotoFrequency: 'notify_progress_photo_frequency'
  };
  for (const [source, target] of Object.entries(map)) {
    if (body[source] !== undefined) fields[target] = body[source];
  }
  if (body.weightStepsKg !== undefined) fields.weight_steps_kg = JSON.stringify(normalizeWeightSteps(body.weightStepsKg, defaultKgOptions, 'kg'));
  if (body.weightStepsLb !== undefined) fields.weight_steps_lb = JSON.stringify(normalizeWeightSteps(body.weightStepsLb, defaultLbOptions, 'lb'));
  return fields;
}

function cacheSettingsMutation(userId, body = {}) {
  const fields = settingsPatchToCacheFields(body);
  if (!Object.keys(fields).length) return;
  const bootKey = BOOT_CACHE_KEY(userId);
  const boot = readBootCache(userId);
  if (boot) {
    const nextBoot = { ...boot, settings: { ...(boot.settings || {}), ...fields } };
    try { localStorage.setItem(bootKey, JSON.stringify(nextBoot)); } catch {}
  }
  const apiKey = API_CACHE_PREFIX + `/api/bootstrap?userId=${userId}`;
  try {
    const cached = JSON.parse(localStorage.getItem(apiKey) || 'null');
    if (cached) localStorage.setItem(apiKey, JSON.stringify({ ...cached, settings: { ...(cached.settings || {}), ...fields } }));
  } catch {}
}

function cachedGroups(userId) {
  return readApiCache(`/api/groups?userId=${userId}`) || [];
}

function cachedRoutines(userId) {
  return readApiCache(`/api/routines?userId=${userId}`)?.routines || [];
}

function writeGroupsCache(userId, groups) {
  try { localStorage.setItem(API_CACHE_PREFIX + `/api/groups?userId=${userId}`, JSON.stringify(groups)); } catch {}
}

function writeRoutinesCache(userId, payload) {
  try { localStorage.setItem(API_CACHE_PREFIX + `/api/routines?userId=${userId}`, JSON.stringify(payload)); } catch {}
}

function offlineSessionPayload(userId, createEntry, pendingLogs = []) {
  const sessionId = Number(createEntry.sessionId);
  const routines = cachedRoutines(userId);
  const groups = cachedGroups(userId);
  const routine = createEntry.routineId ? routines.find((item) => Number(item.id) === Number(createEntry.routineId)) : null;
  const group = createEntry.groupId ? groups.find((item) => Number(item.id) === Number(createEntry.groupId)) : null;
  const baseExercises = routine?.exercises || group?.exercises || [];
  const exercises = addPendingCountsToExercises(baseExercises, pendingLogs, sessionId);
  return {
    session: {
      id: sessionId,
      user_id: userId,
      routine_id: createEntry.routineId || null,
      group_id: createEntry.groupId || null,
      schedule_mode: createEntry.scheduleMode || 'FREE',
      status: 'ACTIVE',
      started_at: createEntry.queuedAt || new Date().toISOString(),
      syncStatus: 'pending'
    },
    routine,
    group,
    exercises
  };
}

function findOfflineSessionPayload(userId, sessionId) {
  const { logs, createdSessions, deletedSessionIds, completedSessionIds } = pendingOfflineState(userId);
  const created = createdSessions.find((entry) => Number(entry.sessionId) === Number(sessionId));
  if (created && !deletedSessionIds.has(Number(sessionId))) {
    const payload = offlineSessionPayload(userId, created, logs);
    if (completedSessionIds.has(Number(sessionId))) {
      return { ...payload, session: { ...payload.session, status: 'COMPLETED', syncStatus: 'pending' } };
    }
  return payload;
}

function applyOfflineGroupMutations(userId, groups) {
  const { createdGroups, addGroupExercises, removeGroupExercises, reorderedGroupExercises } = pendingOfflineState(userId);
  if (!createdGroups.length && !addGroupExercises.length && !removeGroupExercises.length && !reorderedGroupExercises.length) return groups;
  const exercises = collectCachedExercises(userId);
  const byId = new Map(exercises.map((exercise) => [String(exercise.id), exercise]));
  const removeKeys = new Set(removeGroupExercises.map((entry) => `${entry.groupId}:${entry.exerciseId}`));
  const byGroupId = new Map((groups || []).map((group) => [String(group.id), { ...group, exercises: [...(group.exercises || [])] }]));
  for (const entry of createdGroups) {
    if (!byGroupId.has(String(entry.groupId))) {
      byGroupId.set(String(entry.groupId), {
        id: entry.groupId,
        name: entry.name,
        icon: entry.icon || '💪',
        color_hex: entry.colorHex || '#78e0a6',
        exercises: [],
        syncStatus: 'pending'
      });
    }
  }
  return [...byGroupId.values()].map((group) => {
    let nextExercises = (group.exercises || []).filter((exercise) => !removeKeys.has(`${group.id}:${exercise.id}`));
    const existingIds = new Set(nextExercises.map((exercise) => String(exercise.id)));
    for (const entry of addGroupExercises) {
      if (String(entry.groupId) !== String(group.id) || removeKeys.has(`${entry.groupId}:${entry.exerciseId}`) || existingIds.has(String(entry.exerciseId))) continue;
      const exercise = byId.get(String(entry.exerciseId));
      if (exercise) {
        nextExercises = [...nextExercises, { ...exercise, syncStatus: 'pending' }];
        existingIds.add(String(entry.exerciseId));
      }
    }
    const reorder = [...reorderedGroupExercises].reverse().find((entry) => String(entry.groupId) === String(group.id));
    if (reorder?.exerciseIds?.length) {
      const order = new Map(reorder.exerciseIds.map((id, index) => [String(id), index]));
      nextExercises = [...nextExercises].sort((a, b) => (order.get(String(a.id)) ?? 9999) - (order.get(String(b.id)) ?? 9999));
    }
    return { ...group, exercises: nextExercises };
  });
}

function applyOfflineScheduleMutations(userId, payload = {}) {
  const { assignedScheduleRules, deletedScheduleRuleIds } = pendingOfflineState(userId);
  if (!assignedScheduleRules.length && !deletedScheduleRuleIds.size) return payload;
  const routines = payload.routines || [];
  let rules = (payload.rules || []).filter((rule) => !deletedScheduleRuleIds.has(String(rule.id)));
  for (const entry of assignedScheduleRules) {
    const keyMatch = (rule) => rule.mode === entry.mode
      && (entry.mode === 'FIXED'
        ? Number(rule.day_of_week) === Number(entry.dayOfWeek)
        : Number(rule.order_index) === Number(entry.orderIndex));
    rules = rules.filter((rule) => !keyMatch(rule));
    const routine = routines.find((item) => Number(item.id) === Number(entry.routineId));
    rules.push({
      id: entry.ruleId || `offline_${entry.tempId || `${entry.mode}_${entry.dayOfWeek ?? entry.orderIndex}`}`,
      user_id: userId,
      routine_id: Number(entry.routineId),
      routine_name: routine?.name || '',
      mode: entry.mode,
      day_of_week: entry.mode === 'FIXED' ? Number(entry.dayOfWeek) : null,
      order_index: entry.mode === 'ROLLING' ? Number(entry.orderIndex) : null,
      syncStatus: 'pending'
    });
  }
  rules.sort((a, b) => String(a.mode).localeCompare(String(b.mode)) || Number(a.day_of_week ?? a.order_index ?? 0) - Number(b.day_of_week ?? b.order_index ?? 0));
  return { ...payload, routines, rules };
}

  // Fallback 1: cached /api/sessions/:id từ lần online trước
  const cachedSession = readApiCache(`/api/sessions/${sessionId}?userId=${userId}`);
  if (cachedSession?.exercises?.length) {
    return {
      ...cachedSession,
      exercises: addPendingCountsToExercises(cachedSession.exercises, logs, sessionId)
    };
  }

  // Fallback 2: tìm trong /api/sessions/active
  const activeCache = readApiCache(`/api/sessions/active?userId=${userId}`);
  const activeSessions = activeCache?.sessions || (activeCache?.session ? [activeCache] : []);
  const match = activeSessions.find((entry) => Number(entry.session?.id) === Number(sessionId));
  if (match?.exercises?.length) {
    return {
      session: match.session,
      routine: match.routine,
      group: match.group,
      exercises: addPendingCountsToExercises(match.exercises, logs, sessionId)
    };
  }
  return null;
}

function addPendingCountsToExercises(exercises = [], pendingLogs = [], sessionId = null) {
  const counts = new Map();
  for (const entry of pendingLogs) {
    if (sessionId !== null && Number(entry.sessionId) !== Number(sessionId)) continue;
    const key = String(entry.exerciseId);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (!counts.size) return exercises;
  return exercises.map((exercise) => ({
    ...exercise,
    completedSets: Number(exercise.completedSets || 0) + Number(counts.get(String(exercise.id)) || 0),
    syncStatus: Number(counts.get(String(exercise.id)) || 0) > 0 ? 'pending' : exercise.syncStatus
  }));
}

function applyOfflineQueueToCachedApi(path, data) {
  const baseData = data || {};
  const userId = userIdFromApiPath(path);
  const { logs: pendingLogs, createdSessions, deletedSessionIds, completedSessionIds } = pendingOfflineState(userId);
  if (!pendingLogs.length && !createdSessions.length && !deletedSessionIds.size && !completedSessionIds.size) return data;

  const sessionExerciseSetsMatch = path.match(/\/api\/sessions\/(\d+)\/exercises\/([^/?]+)\/sets/);
  if (sessionExerciseSetsMatch) {
    const sessionId = Number(sessionExerciseSetsMatch[1]);
    if (deletedSessionIds.has(sessionId)) return { ...baseData, current: [] };
    const exerciseId = decodeURIComponent(sessionExerciseSetsMatch[2]);
    const current = Array.isArray(baseData.current) ? baseData.current : [];
    const existingOfflineKeys = new Set(current.map((row) => `${row.session_id || sessionId}:${row.exercise_id || exerciseId}:${row.set_index || ''}:${row.completed_at || ''}`));
    const queued = pendingLogs
      .filter((entry) => Number(entry.sessionId) === sessionId && String(entry.exerciseId) === String(exerciseId))
      .filter((entry, index) => !existingOfflineKeys.has(`${sessionId}:${exerciseId}:${entry.setIndex || current.length + index + 1}:${entry.queuedAt || ''}`))
      .map((entry, index) => ({
        id: entry.id || entry.tempId || `offline_${sessionId}_${exerciseId}_${index}`,
        session_id: sessionId,
        exercise_id: exerciseId,
        set_index: Number(entry.setIndex || 0) || current.length + index + 1,
        weight_kg: entry.weightKg,
        weight_unit: entry.weightUnit || 'kg',
        reps: entry.reps,
        completed_at: entry.queuedAt || new Date().toISOString(),
        offline: true
      }));
    if (!queued.length) return baseData;
    return { ...baseData, current: [...current, ...queued] };
  }

  const sessionMatch = path.match(/\/api\/sessions\/(\d+)(?:\?|$)/);
  if (sessionMatch && !path.includes('/detail')) {
    const sessionId = Number(sessionMatch[1]);
    if (deletedSessionIds.has(sessionId)) return { ...baseData, session: { ...(baseData.session || {}), id: sessionId, status: 'DELETED' }, exercises: [] };
    const created = createdSessions.find((entry) => Number(entry.sessionId) === sessionId);
    if (created) return offlineSessionPayload(userId, created, pendingLogs);
    if (completedSessionIds.has(sessionId)) return { ...baseData, session: { ...(baseData.session || {}), id: sessionId, status: 'COMPLETED', syncStatus: 'pending' }, exercises: addPendingCountsToExercises(baseData.exercises || [], pendingLogs, sessionId) };
    return { ...baseData, exercises: addPendingCountsToExercises(baseData.exercises || [], pendingLogs, sessionId) };
  }

  if (path.includes('/api/sessions/active')) {
    const sessions = baseData.sessions || (baseData.session ? [baseData] : []);
    const onlineSessions = sessions
      .filter((item) => !deletedSessionIds.has(Number(item.session?.id)) && !completedSessionIds.has(Number(item.session?.id)))
      .map((item) => ({
        ...item,
        exercises: addPendingCountsToExercises(item.exercises || [], pendingLogs, item.session?.id)
      }));
    const offlineSessions = createdSessions
      .filter((entry) => !completedSessionIds.has(Number(entry.sessionId)))
      .map((entry) => offlineSessionPayload(userId, entry, pendingLogs));
    const seen = new Set();
    const nextSessions = [...onlineSessions, ...offlineSessions].filter((item) => {
      const id = Number(item.session?.id);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    return {
      ...baseData,
      ...(baseData.session ? { exercises: nextSessions[0]?.exercises || baseData.exercises } : {}),
      session: nextSessions[0]?.session || baseData.session,
      routine: nextSessions[0]?.routine || baseData.routine,
      group: nextSessions[0]?.group || baseData.group,
      sessions: nextSessions
    };
  }

  if (path.includes('/api/dashboard')) {
    const byExercise = new Map((baseData.todaySummary || []).map((row) => [row.exercise_id, { ...row }]));
    for (const entry of pendingLogs) {
      if (deletedSessionIds.has(Number(entry.sessionId))) continue;
      const row = byExercise.get(entry.exerciseId) || { exercise_id: entry.exerciseId, name: '', sets: 0, max_weight: 0, total_reps: 0, previous_best: null };
      row.sets = Number(row.sets || 0) + 1;
      row.max_weight = Math.max(Number(row.max_weight || 0), Number(entry.weightKg || 0));
      row.total_reps = Number(row.total_reps || 0) + Number(entry.reps || 0);
      row.syncStatus = 'pending';
      byExercise.set(entry.exerciseId, row);
    }
    const recentHistory = (baseData.recentHistory || []).filter((row) => !deletedSessionIds.has(Number(row.id)));
    return { ...baseData, recentHistory, todaySummary: [...byExercise.values()] };
  }

  return baseData;
}
// ──────────────────────────────────────────────────────────────────────────────

const getModeLabels = (t) => ({ FREE: t('mode_free'), FIXED: t('schedule_fixed_panel_title'), ROLLING: t('schedule_rolling_panel_title') });
const defaultKgOptions = Array.from({ length: 121 }, (_, index) => index * 2.5);
const defaultLbOptions = [0, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 140, 160, 180, 200, 220];
const kgOptions = defaultKgOptions;
const lbOptions = defaultLbOptions;
const repOptions = Array.from({ length: 100 }, (_, index) => index + 1);
const customExerciseIcons = ['🏋️', '💪', '🔥', '⚡', '🦵', '❤️', '🎯', '⭐'];
const getCustomTargetOptions = (t) => t('custom_targets');
const customEquipmentOptions = ['body weight', 'dumbbell', 'barbell', 'machine', 'cable', 'band', 'kettlebell', 'other'];
const kgToLb = (kg) => Number(kg || 0) * 2.2046226218;
const lbToKg = (lb) => Number((Number(lb || 0) / 2.2046226218).toFixed(2));
const nearestOption = (value, options) => options.reduce((best, option) => Math.abs(option - value) < Math.abs(best - value) ? option : best, options[0]);
const displayWeight = (kg, unit) => unit === 'lb' ? Number(kgToLb(kg).toFixed(1)) : Number(kg || 0);
function normalizeWeightSteps(values, fallback, unit = 'kg') {
  const max = unit === 'lb' ? 1000 : 500;
  const step = unit === 'lb' ? 0.5 : 0.25;
  const list = [...new Set((Array.isArray(values) ? values : [])
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item >= 0 && item <= max)
    .map((item) => Number((Math.round(item / step) * step).toFixed(2))))].sort((a, b) => a - b);
  return list.length ? list : fallback;
}
function parseWeightSteps(value, fallback, unit = 'kg') {
  try {
    const parsed = typeof value === 'string' && value.trim() ? JSON.parse(value) : value;
    return normalizeWeightSteps(parsed, fallback, unit);
  } catch {
    return fallback;
  }
}
function languageKey(settings = {}) {
  const locale = settings?.locale || fallbackDisplay.locale;
  const map = { en: 'en-US', vi: 'vi-VN', zh: 'zh-CN', es: 'es-ES', pt: 'pt-BR', ja: 'ja-JP', ko: 'ko-KR', de: 'de-DE', fr: 'fr-FR', ru: 'ru-RU' };
  const prefix = locale.split('-')[0];
  return map[prefix] || 'en-US';
}

function exerciseDisplayName(exercise, settings = {}) {
  if (!exercise) return '';
  return exercise.name;
}

function stableColorForName(name) {
  const colors = [
    { dot: '#f05a28', fill: '#ffe3d3', ring: '#ffbd9a' },
    { dot: '#166534', fill: '#dcfce7', ring: '#86efac' },
    { dot: '#2563eb', fill: '#dbeafe', ring: '#93c5fd' },
    { dot: '#7c3aed', fill: '#ede9fe', ring: '#c4b5fd' },
    { dot: '#0f766e', fill: '#ccfbf1', ring: '#5eead4' },
    { dot: '#be123c', fill: '#ffe4e6', ring: '#fda4af' },
    { dot: '#ca8a04', fill: '#fef3c7', ring: '#fde68a' },
    { dot: '#334155', fill: '#e2e8f0', ring: '#cbd5e1' }
  ];
  const text = String(name || 'Free workout');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return colors[hash % colors.length];
}
const cmToFeetInches = (cm) => {
  const totalInches = Math.round(Number(cm || 0) / 2.54);
  return { feet: Math.floor(totalInches / 12) || '', inches: totalInches % 12 || '' };
};
const feetInchesToCm = (feet, inches) => {
  const totalInches = Number(feet || 0) * 12 + Number(inches || 0);
  return totalInches ? Number((totalInches * 2.54).toFixed(1)) : '';
};

const fallbackDisplay = { locale: 'en-US', timezone: 'America/New_York' };
const timezoneOptions = [
  ['Asia/Ho_Chi_Minh', 'Viet Nam'],
  ['Asia/Bangkok', 'Thailand'],
  ['Asia/Tokyo', 'Japan'],
  ['Asia/Singapore', 'Singapore'],
  ['UTC', 'UTC']
];
const localeOptions = [
  ['en-US', 'English'],
  ['vi-VN', 'Tiếng Việt'],
  ['zh-CN', '简体中文'],
  ['es-ES', 'Español'],
  ['pt-BR', 'Português (Brasil)'],
  ['ja-JP', '日本語'],
  ['ko-KR', '한국어'],
  ['de-DE', 'Deutsch'],
  ['fr-FR', 'Français'],
  ['ru-RU', 'Русский'],
];
const rangeOptionsDays = { '3d': 3, '7d': 7, '14d': 14, '1m': 30, '3m': 90, '6m': 183, '1y': 365, '2y': 730, '5y': 1825, 'all': null };
const getRangeOptions = (t) => [
  ['3d', t('range_3d'), 3],
  ['7d', t('range_7d'), 7],
  ['14d', t('range_14d'), 14],
  ['1m', t('range_1m'), 30],
  ['3m', t('range_3m'), 90],
  ['6m', t('range_6m'), 183],
  ['1y', t('range_1y'), 365],
  ['2y', t('range_2y'), 730],
  ['5y', t('range_5y'), 1825],
  ['all', t('range_all'), null]
];

function supportedTimezones() {
  if (Intl.supportedValuesOf) return Intl.supportedValuesOf('timeZone');
  return timezoneOptions.map(([value]) => value);
}

function timezoneOffsetMinutes(timezone, at = new Date()) {
  try {
    const base = new Date(at);
    base.setUTCSeconds(0, 0);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).formatToParts(base).reduce((memo, part) => ({ ...memo, [part.type]: part.value }), {});
    const utc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute));
    return Math.round((utc - base.getTime()) / 60000);
  } catch {
    return 0;
  }
}

function formatOffset(minutes) {
  const sign = minutes >= 0 ? '+' : '-';
  const absolute = Math.abs(minutes);
  return `GMT${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}

function avatarContent(avatar, className = '') {
  if (!avatar) return <UserRound size={22} />;
  if (avatar.startsWith('data:') || avatar.startsWith('/')) {
    return <img src={avatar} alt="" className={`h-full w-full rounded-full object-cover ${className}`} />;
  }
  return avatar;
}

function timezoneSelectOptions() {
  const now = new Date();
  return supportedTimezones()
    .map((name) => ({
      name,
      offset: timezoneOffsetMinutes(name, now),
      label: `${formatOffset(timezoneOffsetMinutes(name, now))} · ${name.replace(/_/g, ' ')}`
    }))
    .sort((a, b) => a.offset - b.offset || a.name.localeCompare(b.name));
}

function bmiFeedback(bmi, t) {
  if (!bmi) return { label: t('bmi_no_data_label'), tone: 'neutral', text: t('bmi_no_data_text') };
  if (bmi < 16) return { label: t('bmi_very_low_label'), tone: 'danger', text: t('bmi_very_low_text') };
  if (bmi < 18.5) return { label: t('bmi_low_label'), tone: 'warning', text: t('bmi_low_text') };
  if (bmi < 23) return { label: t('bmi_great_label'), tone: 'good', text: t('bmi_great_text') };
  if (bmi < 25) return { label: t('bmi_ok_label'), tone: 'ok', text: t('bmi_ok_text') };
  if (bmi < 30) return { label: t('bmi_warning_label'), tone: 'warning', text: t('bmi_warning_text') };
  return { label: t('bmi_danger_label'), tone: 'danger', text: t('bmi_danger_text') };
}

function filterByRange(rows, field, rangeKey) {
  const days = rangeOptionsDays[rangeKey];
  if (days === null || days === undefined) return rows; // 'all' = no filter
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return rows.filter((row) => {
    const date = parseServerDate(row[field]);
    return date && date >= cutoff;
  });
}

function chartRangeDomain(rangeKey) {
  const days = rangeOptionsDays[rangeKey];
  if (days === null || days === undefined) return ['auto', 'auto'];
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  return [start.getTime(), end.getTime()];
}

function displayPrefs(settings = {}) {
  return {
    locale: settings.locale || fallbackDisplay.locale,
    timeZone: settings.timezone || fallbackDisplay.timezone,
    hour12: settings.clock_format === '12h'
  };
}

function parseServerDate(value) {
  if (!value) return null;
  if (typeof value === 'number') return new Date(value);
  if (value instanceof Date) return value;
  const text = String(value);
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(text)) return new Date(text);
  const normalized = text.replace(' ', 'T');
  // date-only '2025-05-15' → '2025-05-15T00:00:00Z' (valid ISO on all browsers)
  return new Date(normalized.includes('T') ? `${normalized}Z` : `${normalized}T00:00:00Z`);
}

function formatDate(value, settings, options = {}) {
  const date = parseServerDate(value);
  if (!date || Number.isNaN(date.getTime())) return '';
  const prefs = displayPrefs(settings);
  return date.toLocaleDateString(prefs.locale, { timeZone: prefs.timeZone, ...options });
}

function formatTime(value, settings, options = {}) {
  const date = parseServerDate(value);
  if (!date || Number.isNaN(date.getTime())) return '';
  const prefs = displayPrefs(settings);
  return date.toLocaleTimeString(prefs.locale, { timeZone: prefs.timeZone, hour12: prefs.hour12, hour: '2-digit', minute: '2-digit', ...options });
}

function formatDateTime(value, settings, options = {}) {
  const date = parseServerDate(value);
  if (!date || Number.isNaN(date.getTime())) return '';
  const prefs = displayPrefs(settings);
  return date.toLocaleString(prefs.locale, { timeZone: prefs.timeZone, hour12: prefs.hour12, ...options });
}

function localIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// GET-only API calls được cache vào localStorage để dùng offline
const API_CACHE_PREFIX = 'gymApiCache:';
const API_CACHE_GET_PATTERNS = ['/api/bootstrap', '/api/groups', '/api/routines', '/api/dashboard', '/api/history', '/api/sessions/active', '/api/sessions/', '/api/exercises', '/api/body-weight', '/api/analytics'];
const WORKOUT_CACHE_PATTERNS = ['/api/dashboard', '/api/history', '/api/sessions/active', '/api/sessions/', '/api/analytics'];

function shouldCacheApi(path) {
  return API_CACHE_GET_PATTERNS.some((p) => path.includes(p));
}

function clearWorkoutApiCaches(userId) {
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith(API_CACHE_PREFIX)) continue;
    const path = key.slice(API_CACHE_PREFIX.length);
    if (!WORKOUT_CACHE_PATTERNS.some((pattern) => path.includes(pattern))) continue;
    if (path.includes('userId=') && !path.includes(`userId=${userId}`)) continue;
    localStorage.removeItem(key);
  }
  if ('caches' in window) {
    caches.open('api-cache').then((cache) => {
      cache.keys().then((requests) => {
        requests.forEach((request) => {
          const url = new URL(request.url);
          if (!WORKOUT_CACHE_PATTERNS.some((pattern) => url.pathname.includes(pattern.replace('/api', '')) || url.pathname.includes(pattern))) return;
          if (url.searchParams.has('userId') && Number(url.searchParams.get('userId')) !== Number(userId)) return;
          cache.delete(request).catch(() => {});
        });
      }).catch(() => {});
    }).catch(() => {});
  }
}

function readBootCache(userId) {
  try { return JSON.parse(localStorage.getItem(BOOT_CACHE_KEY(userId)) || 'null'); } catch { return null; }
}

function todayDowIndex() {
  const jsDay = new Date().getDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

function offlineSuggestion(userId) {
  const boot = readBootCache(userId);
  const settings = boot?.settings || {};
  const routineData = readApiCache(`/api/routines?userId=${userId}`) || {};
  const routines = routineData.routines || [];
  const rules = routineData.rules || [];
  const mode = settings.schedule_mode || 'FREE';
  if (mode === 'FREE') return { mode: 'FREE', title: 'Tập tự do', routine: null };
  if (mode === 'FIXED') {
    const dow = todayDowIndex();
    const rule = rules.find((item) => item.mode === 'FIXED' && Number(item.day_of_week) === dow);
    const routine = rule ? routines.find((item) => Number(item.id) === Number(rule.routine_id)) : null;
    return { mode: 'FIXED', dayOfWeek: dow, title: rule ? `Lịch cố định hôm nay` : 'Hôm nay chưa gán lịch', routine: routine || null };
  }
  const index = Number(settings.current_rolling_index || 1);
  const rule = rules.find((item) => item.mode === 'ROLLING' && Number(item.order_index) === index);
  const routine = rule ? routines.find((item) => Number(item.id) === Number(rule.routine_id)) : null;
  return { mode: 'ROLLING', rollingIndex: index, title: rule ? `Buổi ${index} trong chu kỳ` : 'Chu kỳ chưa hoàn tất', routine: routine || null };
}

function offlineDashboardData(userId) {
  const cached = readApiCache(`/api/dashboard?userId=${userId}`) || {};
  return {
    suggestion: cached.suggestion || readBootCache(userId)?.suggestion || offlineSuggestion(userId),
    activityCalendar: cached.activityCalendar || [],
    recentHistory: cached.recentHistory || [],
    todaySummary: cached.todaySummary || []
  };
}

function cacheAddGroupExercise(userId, groupId, exerciseId) {
  const groups = applyOfflineGroupMutations(userId, cachedGroups(userId));
  writeGroupsCache(userId, groups);
}

function cacheGroupMutations(userId) {
  const groups = applyOfflineGroupMutations(userId, cachedGroups(userId));
  writeGroupsCache(userId, groups);
}

function cacheRemoveGroupExercise(userId, groupId, exerciseId) {
  const groups = applyOfflineGroupMutations(userId, cachedGroups(userId));
  writeGroupsCache(userId, groups);
}

function cacheAssignScheduleRule(userId) {
  const payload = applyOfflineScheduleMutations(userId, readApiCache(`/api/routines?userId=${userId}`) || { routines: [], rules: [] });
  writeRoutinesCache(userId, payload);
}

async function warmOfflineData(userId) {
  const endpoints = [
    `/api/bootstrap?userId=${userId}`,
    `/api/dashboard?userId=${userId}`,
    `/api/groups?userId=${userId}`,
    `/api/routines?userId=${userId}`,
    `/api/sessions/active?userId=${userId}`,
    `/api/exercises/meta?userId=${userId}`,
    `/api/exercises?userId=${userId}&q=&target=`,
    `/api/history?userId=${userId}&limit=20&offset=0`,
    `/api/analytics?userId=${userId}`,
    `/api/body-weight?userId=${userId}`,
    `/api/body-weight/recent?userId=${userId}`
  ];
  await Promise.allSettled(endpoints.map((endpoint) => api(endpoint)));
  // Tự động cache media cho mọi bài đã có trong groups/routines/active sessions
  try { await downloadGroupsForOffline(userId).catch(() => {}); } catch {}
}

function userIdFromRequestOptions(options = {}) {
  try {
    if (!options.body) return null;
    return Number(JSON.parse(options.body)?.userId || 0) || null;
  } catch {
    return null;
  }
}

function collectCachedExercises(userId) {
  const byId = new Map();
  const addExercise = (exercise) => {
    if (!exercise?.id) return;
    byId.set(String(exercise.id), { ...byId.get(String(exercise.id)), ...exercise });
  };
  const addExercises = (items = []) => items.forEach(addExercise);
  const visit = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== 'object') return;
    if (Array.isArray(value.exercises)) addExercises(value.exercises);
    if (Array.isArray(value.groups)) value.groups.forEach(visit);
    if (Array.isArray(value.routines)) value.routines.forEach(visit);
    if (Array.isArray(value.sessions)) value.sessions.forEach(visit);
    if (value.routine) visit(value.routine);
    if (value.group) visit(value.group);
  };

  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith(API_CACHE_PREFIX)) continue;
    const path = key.slice(API_CACHE_PREFIX.length);
    if (path.includes('userId=') && !path.includes(`userId=${userId}`)) continue;
    if (!['/api/exercises', '/api/groups', '/api/routines', '/api/sessions/active', '/api/sessions/'].some((pattern) => path.includes(pattern))) continue;
    try { visit(JSON.parse(localStorage.getItem(key) || 'null')); } catch {}
  }
  return [...byId.values()].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

function offlineExercisesForPath(path) {
  const userId = userIdFromApiPath(path);
  const url = new URL(path, window.location.origin);
  const q = String(url.searchParams.get('q') || '').trim().toLocaleLowerCase('vi-VN');
  const target = String(url.searchParams.get('target') || '').trim();
  let exercises = collectCachedExercises(userId);
  if (target) exercises = exercises.filter((exercise) => String(exercise.target || '') === target);
  if (q) {
    exercises = exercises.filter((exercise) => [
      exercise.name,
      exercise.target,
      exercise.equipment,
      exercise.bodyPart,
      exercise.body_part,
      exercise.nameVi,
      exercise.targetVi,
      exercise.equipmentVi,
      exercise.bodyPartVi,
      exercise.searchVi
    ].filter(Boolean).join(' ').toLocaleLowerCase('vi-VN').includes(q));
  }
  return exercises;
}

function offlineExerciseMeta(userId) {
  const exercises = collectCachedExercises(userId);
  return {
    targets: [...new Set(exercises.map((exercise) => exercise.target).filter(Boolean))].sort(),
    equipment: [...new Set(exercises.map((exercise) => exercise.equipment).filter(Boolean))].sort(),
    bodyParts: [...new Set(exercises.map((exercise) => exercise.bodyPart || exercise.body_part).filter(Boolean))].sort(),
    targetsVi: [...new Set(exercises.map((exercise) => exercise.targetVi).filter(Boolean))].sort(),
    equipmentVi: [...new Set(exercises.map((exercise) => exercise.equipmentVi).filter(Boolean))].sort(),
    bodyPartsVi: [...new Set(exercises.map((exercise) => exercise.bodyPartVi).filter(Boolean))].sort(),
    quickSearchVi: []
  };
}

// Route GET responses vào gymStore — đảm bảo store luôn fresh sau mỗi API call success
function routeGetResponseToStore(path, data) {
  try {
    const userId = userIdFromApiPath(path);
    if (path.startsWith('/api/groups?') || path === '/api/groups') {
      if (Array.isArray(data)) replaceCollection(userId, 'groups', data);
    } else if (path.startsWith('/api/routines?') || path === '/api/routines') {
      if (data && Array.isArray(data.routines)) replaceCollection(userId, 'routines', data.routines);
      if (data && Array.isArray(data.rules)) replaceCollection(userId, 'scheduleRules', data.rules);
    } else if (path.startsWith('/api/bootstrap')) {
      if (data) {
        setScalarField(userId, 'bootstrap', data);
        if (data.settings) setScalarField(userId, 'settings', data.settings);
      }
    } else if (path.startsWith('/api/dashboard')) {
      if (data) setScalarField(userId, 'dashboard', data);
    } else if (path.startsWith('/api/sessions/active')) {
      if (data) setScalarField(userId, 'activeSessions', data);
    } else if (path.startsWith('/api/body-weight/recent')) {
      if (Array.isArray(data)) replaceCollection(userId, 'bodyWeights', data);
    }
  } catch {}
}

async function api(path, options = {}) {
  const isGet = !options.method || options.method === 'GET';
  const method = (options.method || 'GET').toUpperCase();
  const { offlineQueue = true, timeoutMs = 8000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      headers: { 'Content-Type': 'application/json', ...(fetchOptions.headers || {}) },
      signal: controller.signal,
      ...fetchOptions
    });
    clearTimeout(timeoutId);
    if (!response.ok) throw new Error((await response.json()).error || 'Lỗi API');
    const data = await response.json();
    // Cache GET responses vào localStorage (legacy) + gymStore (new)
    if (isGet && shouldCacheApi(path)) {
      try { localStorage.setItem(API_CACHE_PREFIX + path, JSON.stringify(data)); } catch {}
      routeGetResponseToStore(path, data);
    }
    if (!isGet) {
      const userId = userIdFromRequestOptions(options) || userIdFromApiPath(path);
      clearWorkoutApiCaches(userId);
    }
    if (isGet && path.includes('/api/groups')) return applyOfflineGroupMutations(userIdFromApiPath(path), data);
    if (isGet && path.includes('/api/routines')) return applyOfflineScheduleMutations(userIdFromApiPath(path), data);
    return isGet ? applyOfflineQueueToCachedApi(path, data) : data;
  } catch (err) {
    clearTimeout(timeoutId);
    if (offlineQueue && method === 'POST' && path === '/api/sessions') {
      if (await checkServerAvailable(1000)) throw err;
      const bodyUserId = userIdFromRequestOptions(options) || 1;
      let body = {};
      try { body = JSON.parse(options.body || '{}'); } catch {}
      const offlineSessionId = (Date.now() * 1000) + Math.floor(Math.random() * 1000);
      const storedSessionId = addToOfflineQueue(bodyUserId, {
        type: 'createSession',
        sessionId: offlineSessionId,
        routineId: body.routineId || null,
        groupId: body.groupId || null,
        scheduleMode: body.scheduleMode || 'FREE'
      });
      clearWorkoutApiCaches(bodyUserId);
      return { id: storedSessionId || offlineSessionId, offline: true };
    }
    if (offlineQueue && method === 'POST' && path === '/api/groups') {
      if (await checkServerAvailable(1000)) throw err;
      let body = {};
      try { body = JSON.parse(options.body || '{}'); } catch {}
      const userId = userIdFromRequestOptions(options) || userIdFromApiPath(path);
      const groupId = `offline_group_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      addToOfflineQueue(userId, { type: 'createGroup', groupId, name: body.name, icon: body.icon || '💪', colorHex: body.colorHex || '#78e0a6' });
      cacheGroupMutations(userId);
      // Optimistic update gymStore: thêm group pending ngay vào store
      upsertEntity(userId, 'groups', {
        id: groupId,
        name: body.name,
        icon: body.icon || '💪',
        color_hex: body.colorHex || '#78e0a6',
        exercises: [],
        syncStatus: 'pending'
      });
      return { id: groupId, offline: true };
    }
    if (offlineQueue && method === 'PATCH' && path === '/api/settings') {
      if (await checkServerAvailable(1000)) throw err;
      let body = {};
      try { body = JSON.parse(options.body || '{}'); } catch {}
      const userId = Number(body.userId || userIdFromRequestOptions(options) || userIdFromApiPath(path));
      const { userId: _ignoredUserId, ...settingsBody } = body;
      addToOfflineQueue(userId, { type: 'settingsUpdate', body: settingsBody });
      cacheSettingsMutation(userId, settingsBody);
      return { ok: true, offline: true };
    }
    const sessionDeleteMatch = path.match(/\/api\/sessions\/(\d+)(?:\?|$)/);
    if (offlineQueue && method === 'DELETE' && sessionDeleteMatch) {
      if (await checkServerAvailable(1000)) throw err;
      const userId = userIdFromRequestOptions(options) || userIdFromApiPath(path);
      addToOfflineQueue(userId, { type: 'deleteSession', sessionId: Number(sessionDeleteMatch[1]) });
      clearWorkoutApiCaches(userId);
      return { ok: true, offline: true };
    }
    const addGroupExerciseMatch = path.match(/\/api\/groups\/(\d+)\/exercises$/);
    if (offlineQueue && method === 'POST' && addGroupExerciseMatch) {
      if (await checkServerAvailable(1000)) throw err;
      let body = {};
      try { body = JSON.parse(options.body || '{}'); } catch {}
      const userId = userIdFromRequestOptions(options) || userIdFromApiPath(path);
      const groupIdNum = Number(addGroupExerciseMatch[1]);
      addToOfflineQueue(userId, { type: 'addGroupExercise', groupId: groupIdNum, exerciseId: body.exerciseId });
      cacheAddGroupExercise(userId, groupIdNum, body.exerciseId);
      // Optimistic: thêm exercise vào group trong store
      updateStore(userId, (store) => ({
        ...store,
        groups: (store.groups || []).map((g) => String(g.id) === String(groupIdNum)
          ? { ...g, exercises: [...(g.exercises || []), { id: body.exerciseId, syncStatus: 'pending' }] }
          : g)
      }));
      return { ok: true, offline: true };
    }
    const addOfflineGroupExerciseMatch = path.match(/\/api\/groups\/([^/]+)\/exercises$/);
    if (offlineQueue && method === 'POST' && addOfflineGroupExerciseMatch) {
      if (await checkServerAvailable(1000)) throw err;
      let body = {};
      try { body = JSON.parse(options.body || '{}'); } catch {}
      const userId = userIdFromRequestOptions(options) || userIdFromApiPath(path);
      const groupId = decodeURIComponent(addOfflineGroupExerciseMatch[1]);
      addToOfflineQueue(userId, { type: 'addGroupExercise', groupId, exerciseId: body.exerciseId });
      cacheAddGroupExercise(userId, groupId, body.exerciseId);
      updateStore(userId, (store) => ({
        ...store,
        groups: (store.groups || []).map((g) => String(g.id) === String(groupId)
          ? { ...g, exercises: [...(g.exercises || []), { id: body.exerciseId, syncStatus: 'pending' }] }
          : g)
      }));
      return { ok: true, offline: true };
    }
    const removeGroupExerciseMatch = path.match(/\/api\/groups\/(\d+)\/exercises\/([^/?]+)/);
    if (offlineQueue && method === 'DELETE' && removeGroupExerciseMatch) {
      if (await checkServerAvailable(1000)) throw err;
      const userId = userIdFromRequestOptions(options) || userIdFromApiPath(path);
      const groupId = Number(removeGroupExerciseMatch[1]);
      const exerciseId = decodeURIComponent(removeGroupExerciseMatch[2]);
      addToOfflineQueue(userId, { type: 'removeGroupExercise', groupId, exerciseId });
      cacheRemoveGroupExercise(userId, groupId, exerciseId);
      // Optimistic remove
      updateStore(userId, (store) => ({
        ...store,
        groups: (store.groups || []).map((g) => String(g.id) === String(groupId)
          ? { ...g, exercises: (g.exercises || []).filter((ex) => String(ex.id) !== String(exerciseId)) }
          : g)
      }));
      return { ok: true, offline: true };
    }
    const removeOfflineGroupExerciseMatch = path.match(/\/api\/groups\/([^/]+)\/exercises\/([^/?]+)/);
    if (offlineQueue && method === 'DELETE' && removeOfflineGroupExerciseMatch) {
      if (await checkServerAvailable(1000)) throw err;
      const userId = userIdFromRequestOptions(options) || userIdFromApiPath(path);
      const groupId = decodeURIComponent(removeOfflineGroupExerciseMatch[1]);
      const exerciseId = decodeURIComponent(removeOfflineGroupExerciseMatch[2]);
      addToOfflineQueue(userId, { type: 'removeGroupExercise', groupId, exerciseId });
      cacheRemoveGroupExercise(userId, groupId, exerciseId);
      updateStore(userId, (store) => ({
        ...store,
        groups: (store.groups || []).map((g) => String(g.id) === String(groupId)
          ? { ...g, exercises: (g.exercises || []).filter((ex) => String(ex.id) !== String(exerciseId)) }
          : g)
      }));
      return { ok: true, offline: true };
    }
    const reorderGroupExerciseMatch = path.match(/\/api\/groups\/([^/]+)\/exercises-order$/);
    if (offlineQueue && method === 'PATCH' && reorderGroupExerciseMatch) {
      if (await checkServerAvailable(1000)) throw err;
      let body = {};
      try { body = JSON.parse(options.body || '{}'); } catch {}
      const userId = userIdFromRequestOptions(options) || userIdFromApiPath(path);
      const groupId = decodeURIComponent(reorderGroupExerciseMatch[1]);
      addToOfflineQueue(userId, { type: 'reorderGroupExercises', groupId, exerciseIds: body.exerciseIds || [] });
      cacheGroupMutations(userId);
      return { ok: true, offline: true };
    }
    // DELETE /api/groups/:id — xoá cả group
    const deleteGroupMatch = path.match(/\/api\/groups\/([^/?]+)(?:\?|$)/);
    if (offlineQueue && method === 'DELETE' && deleteGroupMatch && !path.includes('/exercises')) {
      if (await checkServerAvailable(1000)) throw err;
      const userId = userIdFromRequestOptions(options) || userIdFromApiPath(path);
      const groupId = decodeURIComponent(deleteGroupMatch[1]);
      addToOfflineQueue(userId, { type: 'deleteGroup', groupId });
      // Optimistic: xoá khỏi store ngay
      updateStore(Number(userId), (store) => ({
        ...store,
        groups: (store.groups || []).filter((g) => String(g.id) !== String(groupId))
      }));
      cacheGroupMutations(userId);
      return { ok: true, offline: true };
    }
    if (offlineQueue && method === 'POST' && path === '/api/schedule-rules') {
      if (await checkServerAvailable(1000)) throw err;
      let body = {};
      try { body = JSON.parse(options.body || '{}'); } catch {}
      const userId = userIdFromRequestOptions(options) || userIdFromApiPath(path);
      const ruleId = `offline_${Date.now()}_${Math.random()}`;
      addToOfflineQueue(userId, {
        type: 'assignScheduleRule',
        ruleId,
        routineId: body.routineId,
        mode: body.mode,
        dayOfWeek: body.dayOfWeek,
        orderIndex: body.orderIndex
      });
      cacheAssignScheduleRule(userId);
      // Optimistic: thêm rule vào store (replace cùng slot nếu có)
      updateStore(userId, (store) => {
        const isMatchSlot = (r) => r.mode === body.mode && (body.mode === 'FIXED'
          ? Number(r.day_of_week) === Number(body.dayOfWeek)
          : Number(r.order_index) === Number(body.orderIndex));
        const others = (store.scheduleRules || []).filter((r) => !isMatchSlot(r));
        const routine = (store.routines || []).find((rt) => Number(rt.id) === Number(body.routineId));
        return {
          ...store,
          scheduleRules: [...others, {
            id: ruleId,
            routine_id: Number(body.routineId),
            routine_name: routine?.name || '',
            mode: body.mode,
            day_of_week: body.mode === 'FIXED' ? Number(body.dayOfWeek) : null,
            order_index: body.mode === 'ROLLING' ? Number(body.orderIndex) : null,
            syncStatus: 'pending'
          }]
        };
      });
      return { ok: true, offline: true };
    }
    const deleteRuleMatch = path.match(/\/api\/schedule-rules\/([^/?]+)/);
    if (offlineQueue && method === 'DELETE' && deleteRuleMatch) {
      if (await checkServerAvailable(1000)) throw err;
      const userId = userIdFromRequestOptions(options) || userIdFromApiPath(path);
      const ruleId = decodeURIComponent(deleteRuleMatch[1]);
      addToOfflineQueue(userId, { type: 'deleteScheduleRule', ruleId });
      cacheAssignScheduleRule(userId);
      // Optimistic: xóa khỏi store
      updateStore(userId, (store) => ({
        ...store,
        scheduleRules: (store.scheduleRules || []).filter((r) => String(r.id) !== String(ruleId))
      }));
      return { ok: true, offline: true };
    }
    // Khi mất mạng hoặc server tạm không tới được, trả về cache cho GET requests.
    // Cache được phủ thêm offline queue để set vừa tập vẫn hiện sau khi đổi trang/mở lại app.
    if (isGet && shouldCacheApi(path)) {
      const cached = localStorage.getItem(API_CACHE_PREFIX + path);
      if (!cached && path.includes('/api/dashboard')) return applyOfflineQueueToCachedApi(path, offlineDashboardData(userIdFromApiPath(path)));
      if (!cached && path.includes('/api/exercises/meta')) return offlineExerciseMeta(userIdFromApiPath(path));
      if (!cached && path.includes('/api/exercises')) return offlineExercisesForPath(path);
      if (path.includes('/api/groups')) return applyOfflineGroupMutations(userIdFromApiPath(path), cached ? JSON.parse(cached) : []);
      if (path.includes('/api/routines')) return applyOfflineScheduleMutations(userIdFromApiPath(path), cached ? JSON.parse(cached) : { routines: [], rules: [] });
      return applyOfflineQueueToCachedApi(path, cached ? JSON.parse(cached) : null);
    }
    throw err;
  }
}

const DialogContext = React.createContext(null);

function useAppDialog() {
  const dialog = React.useContext(DialogContext);
  if (!dialog) throw new Error('DialogProvider is missing');
  return dialog;
}

function DialogProvider({ children }) {
  const [dialog, setDialog] = useState(null);

  const openDialog = (config) => new Promise((resolve) => {
    setDialog({ ...config, value: config.defaultValue || '', resolve });
  });
  const closeDialog = (value) => {
    setDialog((current) => {
      current?.resolve(value);
      return null;
    });
  };
  const apiValue = useMemo(() => ({
    alert: (message, options = {}) => {
      const tD = createT(localStorage.getItem('familyGymUser') ? (JSON.parse(localStorage.getItem('familyGymUser') || '{}')).locale : undefined);
      return openDialog({ kind: 'alert', title: options.title || tD('dialog_alert_title'), message, okText: options.okText || tD('dialog_ok') });
    },
    confirm: (message, options = {}) => {
      const tD = createT(localStorage.getItem('familyGymUser') ? (JSON.parse(localStorage.getItem('familyGymUser') || '{}')).locale : undefined);
      return openDialog({ kind: 'confirm', title: options.title || tD('dialog_confirm_title'), message, okText: options.okText || tD('dialog_yes'), cancelText: options.cancelText || tD('dialog_no') });
    },
    prompt: (message, options = {}) => {
      const tD = createT(localStorage.getItem('familyGymUser') ? (JSON.parse(localStorage.getItem('familyGymUser') || '{}')).locale : undefined);
      return openDialog({ kind: 'prompt', title: options.title || message, message: options.description || '', inputType: options.type || 'text', defaultValue: options.defaultValue || '', okText: options.okText || tD('dialog_continue'), cancelText: options.cancelText || tD('dialog_cancel_btn') });
    }
  }), []);

  return (
    <DialogContext.Provider value={apiValue}>
      {children}
      {dialog && <AppDialog dialog={dialog} setDialog={setDialog} onClose={closeDialog} />}
    </DialogContext.Provider>
  );
}

function AppDialog({ dialog, setDialog, onClose }) {
  const isPrompt = dialog.kind === 'prompt';
  const submit = (event) => {
    event.preventDefault();
    if (dialog.kind === 'alert') onClose(true);
    else if (dialog.kind === 'confirm') onClose(true);
    else onClose(dialog.value);
  };

  return (
    <div className="app-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose(dialog.kind === 'alert' ? true : null)}>
      <form className="app-dialog" onSubmit={submit} role="dialog" aria-modal="true">
        <div className="app-dialog-mark"><Dumbbell size={20} /></div>
        <h2>{dialog.title}</h2>
        {dialog.message && <p>{dialog.message}</p>}
        {isPrompt && (
          <input
            className="input mt-3"
            autoFocus
            type={dialog.inputType}
            value={dialog.value}
            onChange={(event) => setDialog((current) => ({ ...current, value: event.target.value }))}
          />
        )}
        <div className={`app-dialog-actions ${dialog.kind === 'alert' ? 'single' : ''}`}>
          {dialog.kind !== 'alert' && <button type="button" className="ghost-btn" onClick={() => onClose(null)}>{dialog.cancelText}</button>}
          <button type="submit" className="primary">{dialog.okText}</button>
        </div>
      </form>
    </div>
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error(error);
  }

  render() {
    if (this.state.error) {
      const t = this.props.t || ((k) => k);
      return (
        <div className="panel">
          <h2 className="section-title">{t('error_display')}</h2>
          <p className="text-sm text-slate-700">{this.state.error.message}</p>
          <button className="primary mt-3" onClick={() => this.setState({ error: null })}>{t('error_retry')}</button>
        </div>
      );
    }
    return this.props.children;
  }
}

const LangContext = React.createContext(() => (k) => k);
function useLang() { return React.useContext(LangContext); }

const BOOT_CACHE_KEY = (userId) => `familyGymBoot:${userId}`;
const OFFLINE_AUTH_PREFIX = 'familyGymOfflineAuth:';

// Migrate dữ liệu từ legacy API cache vào gymStore (gọi 1 lần khi App mount cho mỗi user)
function migrateLegacyCacheToStore(userId) {
  if (!userId) return;
  const store = readStore(userId);
  if (store.lastFullSync) return; // đã migrate
  try {
    const groupsCache = localStorage.getItem(API_CACHE_PREFIX + `/api/groups?userId=${userId}`);
    if (groupsCache) replaceCollection(userId, 'groups', JSON.parse(groupsCache));
    const routinesCache = localStorage.getItem(API_CACHE_PREFIX + `/api/routines?userId=${userId}`);
    if (routinesCache) {
      const parsed = JSON.parse(routinesCache);
      if (Array.isArray(parsed?.routines)) replaceCollection(userId, 'routines', parsed.routines);
      if (Array.isArray(parsed?.rules)) replaceCollection(userId, 'scheduleRules', parsed.rules);
    }
    const dashboardCache = localStorage.getItem(API_CACHE_PREFIX + `/api/dashboard?userId=${userId}`);
    if (dashboardCache) setScalarField(userId, 'dashboard', JSON.parse(dashboardCache));
    const activeCache = localStorage.getItem(API_CACHE_PREFIX + `/api/sessions/active?userId=${userId}`);
    if (activeCache) setScalarField(userId, 'activeSessions', JSON.parse(activeCache));
    const bootCache = localStorage.getItem(BOOT_CACHE_KEY(userId));
    if (bootCache) {
      const parsed = JSON.parse(bootCache);
      setScalarField(userId, 'bootstrap', parsed);
      if (parsed?.settings) setScalarField(userId, 'settings', parsed.settings);
    }
    setScalarField(userId, 'lastFullSync', Date.now());
  } catch {}
}

function bytesToBase64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function passwordDigest(password, saltBase64) {
  const salt = saltBase64 ? base64ToBytes(saltBase64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' }, key, 256);
  return { salt: bytesToBase64(salt), hash: bytesToBase64(bits) };
}

function offlineAuthKey(username) {
  return `${OFFLINE_AUTH_PREFIX}${String(username || '').trim().toLowerCase()}`;
}

async function saveOfflineAuth(username, password, user) {
  if (!username || !password || !user?.id || !crypto?.subtle) return;
  const verifier = await passwordDigest(password);
  localStorage.setItem(offlineAuthKey(username), JSON.stringify({
    username: String(username).trim(),
    user,
    salt: verifier.salt,
    hash: verifier.hash,
    authVersion: user.authVersion || null,
    savedAt: new Date().toISOString()
  }));
}

async function verifyOfflineAuth(username, password) {
  const raw = localStorage.getItem(offlineAuthKey(username));
  if (!raw || !password || !crypto?.subtle) return null;
  const saved = JSON.parse(raw);
  const verifier = await passwordDigest(password, saved.salt);
  return verifier.hash === saved.hash ? saved.user : null;
}

function clearOfflineAuth(username) {
  if (username) localStorage.removeItem(offlineAuthKey(username));
}

function App() {
  const savedUser = JSON.parse(localStorage.getItem('familyGymUser') || sessionStorage.getItem('familyGymUser') || 'null');
  const [user, setUser] = useState(savedUser);
  const [tab, setTab] = useState('home');
  const { online: isServerOnline, forceCheck: recheckServer } = useServerStatus();
  const wasOnlineRef = React.useRef(isServerOnline);

  // Migrate dữ liệu legacy cache → gymStore lần đầu mount
  useEffect(() => {
    if (savedUser?.id) migrateLegacyCacheToStore(savedUser.id);
  }, [savedUser?.id]);

  // Sync offline queue ngay khi vừa có mạng lại (chỉ trigger lúc offline→online)
  const [syncMsg, setSyncMsg] = useState('');
  useEffect(() => {
    if (!user?.id) return;
    const justCameOnline = !wasOnlineRef.current && isServerOnline;
    wasOnlineRef.current = isServerOnline;
    if (!isServerOnline) return;
    const tSync = createT(user?.locale);
    flushOfflineQueue(user.id).then((synced) => {
      if (synced > 0) {
        setSyncMsg(tSync('sync_done', synced));
        if (justCameOnline) setRefresh((v) => v + 1);
        setTimeout(() => setSyncMsg(''), 3000);
      }
    }).catch(() => {});
  }, [isServerOnline, user?.id]);

  const cachedBoot = useMemo(() => {
    if (!user?.id) return null;
    return readBootCache(user.id);
  }, [user?.id]);
  const [boot, setBoot] = useState(cachedBoot);
  const [refresh, setRefresh] = useState(0);
  const [workout, setWorkout] = useState(null);

  // Bootstrap chỉ fetch khi: user thay đổi, refresh, hoặc vừa có mạng lại
  useEffect(() => {
    if (!user) return;
    const localBoot = readBootCache(user.id);
    if (localBoot) setBoot(localBoot);
    if (!isServerOnline) return; // Offline → dùng cache, không gọi API
    api(`/api/bootstrap?userId=${user.id}`)
      .then((data) => {
        if (user.authVersion && data.activeUser?.authVersion && user.authVersion !== data.activeUser.authVersion) {
          clearOfflineAuth(user.username);
          localStorage.removeItem('familyGymUser');
          sessionStorage.removeItem('familyGymUser');
          setUser(null);
          return;
        }
        setBoot(data);
        const nextUser = { ...user, ...data.activeUser };
        const userStorage = localStorage.getItem('familyGymUser') ? localStorage : sessionStorage;
        userStorage.setItem('familyGymUser', JSON.stringify(nextUser));
        if (JSON.stringify(nextUser) !== JSON.stringify(user)) setUser(nextUser);
        localStorage.setItem(BOOT_CACHE_KEY(user.id), JSON.stringify(data));
      })
      .catch(() => {
        // Chỉ logout nếu đang có mạng (lỗi auth thật sự)
        // Mất mạng → giữ nguyên, không bao giờ clear user
        if (isServerOnline) {
          clearOfflineAuth(user.username);
          localStorage.removeItem('familyGymUser');
          sessionStorage.removeItem('familyGymUser');
          setUser(null);
        } else if (localBoot) {
          setBoot(localBoot);
        }
        // Nếu offline + chưa có cachedBoot → vẫn giữ user, hiện màn offline
      });
  }, [user, refresh, isServerOnline]);

  if (!user) return <Login onLogin={setUser} />;
  if (!boot && !isServerOnline) {
    // Offline và chưa có cached data
    const tOffline = createT(savedUser?.locale);
    return (
      <div className="min-h-screen bg-app grid place-items-center text-center p-6">
        <div>
          <WifiOff size={48} className="mx-auto mb-4 text-slate-400" />
          <h2 className="text-xl font-bold text-slate-700">{tOffline('offline_no_connection')}</h2>
          <p className="mt-2 text-sm text-slate-500">{tOffline('offline_first_load')}</p>
          <button className="primary mt-6" onClick={() => window.location.reload()}>{tOffline('offline_retry')}</button>
        </div>
      </div>
    );
  }
  if (!boot) { const tBoot = createT(savedUser?.locale); return <div className="min-h-screen bg-app grid place-items-center text-slate-950">{tBoot('loading')}</div>; }

  const t = createT(boot.settings?.locale);

  const nav = [
    ['home', Home, t('nav_home')],
    ['start', Play, t('nav_start')],
    ['library', Library, t('nav_library')],
    ['builder', Dumbbell, t('nav_builder')],
    ['analytics', BarChart3, t('nav_analytics')],
    ['settings', Settings, t('nav_settings')]
  ];
  const startWorkout = (nextWorkout) => {
    if (nextWorkout?.sessionId) setTab('start');
    setWorkout(nextWorkout ? { ...nextWorkout, returnTab: nextWorkout.returnTab || (nextWorkout.sessionId ? 'start' : tab) } : nextWorkout);
  };
  const closeWorkout = () => {
    const returnTab = workout?.returnTab;
    setWorkout(null);
    if (returnTab) setTab(returnTab);
    setRefresh((v) => v + 1);
  };
  const cleanupWorkoutBeforeLeaving = async (nextTab) => {
    if (!workout?.sessionId) {
      setWorkout(null);
      setTab(nextTab);
      return;
    }
    const saved = JSON.parse(localStorage.getItem(`familyGymWorkout:${user.id}`) || 'null');
    const sameSession = saved?.sessionId === workout.sessionId;
    const savedView = sameSession ? saved.view : workout.initialView;
    if (savedView !== 'exercise') {
      const sessionData = await api(`/api/sessions/${workout.sessionId}?userId=${user.id}`);
      const totalSets = sessionData.exercises.reduce((sum, exercise) => sum + Number(exercise.completedSets || 0), 0);
      if (!totalSets) {
        await api(`/api/sessions/${workout.sessionId}`, { method: 'DELETE', body: JSON.stringify({ userId: user.id }) });
        localStorage.removeItem(`familyGymWorkout:${user.id}`);
      }
    }
    setWorkout(null);
    setTab(nextTab);
    setRefresh((v) => v + 1);
  };
  const continueWorkout = async () => {
    if (workout) {
      setTab('start');
      return;
    }
    const saved = JSON.parse(localStorage.getItem(`familyGymWorkout:${user.id}`) || 'null');
    const active = await api(`/api/sessions/active?userId=${user.id}`);
    const activeSessions = active?.sessions || (active?.session ? [active] : []);
    if (saved?.sessionId) {
      const savedStillActive = activeSessions.some((item) => item.session.id === saved.sessionId);
      if (savedStillActive) {
        setTab('start');
        setWorkout({
          sessionId: saved.sessionId,
          initialIndex: saved.index || 0,
          initialView: saved.view || 'list',
          returnTab: 'start'
        });
        return;
      }
    }
    if (activeSessions.length === 1) {
      setTab('start');
      setWorkout({
        sessionId: activeSessions[0].session.id,
        initialIndex: 0,
        initialView: 'list',
        returnTab: 'start'
      });
      return;
    }
    setWorkout(null);
    setTab('start');
  };

  return (
    <LangContext.Provider value={t}>
    <div className="min-h-screen bg-app text-slate-950">
      <main className="mx-auto min-h-screen w-full max-w-md bg-[#f4f6f1] px-4 pb-40 pt-5 text-slate-950 md:max-w-6xl md:px-8">
        {workout ? (
          <WorkoutLogger userId={user.id} workout={workout} settings={boot.settings} onClose={closeWorkout} />
        ) : (
          <ErrorBoundary key={tab} t={t}>
            <Header user={user} boot={boot} onLogout={() => { localStorage.removeItem('familyGymUser'); sessionStorage.removeItem('familyGymUser'); setUser(null); }} />
            {syncMsg && <div className="mx-4 mt-2 rounded-lg bg-emerald-100 px-3 py-2 text-sm font-semibold text-emerald-800 cursor-pointer" onClick={() => setSyncMsg('')}>{syncMsg} ✕</div>}
            {tab === 'home' && <Dashboard userId={user.id} onStart={startWorkout} refresh={refresh} settings={boot.settings} onChanged={() => setRefresh((v) => v + 1)} />}
            {tab === 'start' && <StartWorkoutPage userId={user.id} onStart={startWorkout} refresh={refresh} settings={boot.settings} />}
            {tab === 'library' && <ExerciseLibrary userId={user.id} settings={boot.settings} />}
            {tab === 'builder' && <Builder userId={user.id} boot={boot} onStart={startWorkout} onChanged={() => setRefresh((v) => v + 1)} />}
            {tab === 'analytics' && <Analytics userId={user.id} settings={boot.settings} />}
            {tab === 'settings' && <SettingsPage userId={user.id} boot={boot} onChanged={() => setRefresh((v) => v + 1)} />}
          </ErrorBoundary>
        )}
      </main>
      <nav className="app-taskbar">
        <div className="grid grid-cols-6 gap-1">
          {nav.map(([id, Icon, label]) => (
            <button
              key={id}
              onClick={async () => {
                if (id === 'start') {
                  await continueWorkout();
                  return;
                }
                if (workout && id !== 'start') {
                  await cleanupWorkoutBeforeLeaving(id);
                  return;
                }
                setTab(id);
              }}
              className={`nav-btn ${tab === id ? 'active' : ''}`}
            >
              <Icon size={20} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
    </LangContext.Provider>
  );
}

function Login({ onLogin }) {
  const savedLocale = (() => { try { const u = JSON.parse(localStorage.getItem('familyGymUser') || 'null'); return u?.locale || fallbackDisplay.locale; } catch { return fallbackDisplay.locale; } })();
  const t = createT(savedLocale);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const { online: serverOnline } = useServerStatus();
  const tryOfflineLogin = async () => {
    const offlineUser = await verifyOfflineAuth(username, password);
    if (!offlineUser) {
      setError(t('login_offline_no_cache'));
      return false;
    }
    localStorage.setItem('familyGymUser', JSON.stringify(offlineUser));
    sessionStorage.removeItem('familyGymUser');
    onLogin(offlineUser);
    return true;
  };
  const submit = async (event) => {
    event.preventDefault();
    setError('');
    try {
      const result = await api('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      const storage = remember ? localStorage : sessionStorage;
      localStorage.removeItem('familyGymUser');
      sessionStorage.removeItem('familyGymUser');
      storage.setItem('familyGymUser', JSON.stringify(result.user));
      await saveOfflineAuth(username, password, result.user);
      warmOfflineData(result.user.id).catch(() => {});
      onLogin(result.user);
    } catch (err) {
      const networkLikeError = /fetch|network|failed|load failed|abort/i.test(err.message || '') || !(await checkServerAvailable(1500));
      if (networkLikeError) {
        try {
          if (await tryOfflineLogin()) return;
        } catch {}
        setError(t('login_offline_error'));
        return;
      }
      if (!networkLikeError) {
        clearOfflineAuth(username);
      }
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen bg-app px-5 py-10 text-slate-950">
      <form onSubmit={submit} className="mx-auto max-w-sm rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
        <div className="mb-7 flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-emerald-500 text-green-950"><Dumbbell /></div>
          <div>
            <h1 className="text-2xl font-bold">Gym App</h1>
            <p className="text-sm text-teal-950">{t('login_subtitle')}</p>
          </div>
        </div>
        {!serverOnline && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm font-semibold text-amber-800">
            <WifiOff size={15} /> {t('login_offline_hint')}
          </div>
        )}
        <label className="label">{t('login_username')}</label>
        <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} />
        <label className="label mt-4">{t('login_password')}</label>
        <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <label className="mt-4 flex items-center gap-2 text-sm font-bold text-teal-950">
          <input
            type="checkbox"
            className="h-4 w-4 accent-orange-600"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
          />
          <span>{t('login_remember')}</span>
        </label>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <button className="primary mt-5">{t('login_btn')}</button>
        <p className="mt-4 text-xs text-teal-950">{t('login_hint')}</p>
      </form>
    </div>
  );
}

function Header({ user, boot, onLogout }) {
  const t = useLang();
  const [now, setNow] = useState(new Date());
  const [open, setOpen] = useState(false);
  const { online: serverOnline } = useServerStatus();
  const menuRef = React.useRef(null);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const closeMenu = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeMenu);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeMenu);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const pendingCount = useMemo(() => {
    try { return (JSON.parse(localStorage.getItem(`gymOfflineQueue:${user.id}`) || '[]')).length; } catch { return 0; }
  }, [user.id, serverOnline, now]);

  return (
    <header className="mb-5 flex items-center justify-between">
      <div>
        <p className="text-sm text-teal-950">{formatDateTime(now, boot.settings, { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-bold">{user.name}</h1>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${serverOnline ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}
            title={serverOnline ? t('server_connecting') : t('server_disconnected')}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${serverOnline ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            {serverOnline ? t('status_online') : t('status_offline')}
          </span>
          {pendingCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-700" title={t('pending_changes_title')}>
              ⟲ {t('pending_changes', pendingCount)}
            </span>
          )}
        </div>
        <p className="text-sm text-teal-950">{getModeLabels(t)[boot.settings.schedule_mode]} · {t('exercises_count', boot.exerciseCount)}</p>
      </div>
      <div className="relative flex flex-col items-center" ref={menuRef}>
        <button onClick={() => setOpen((current) => !current)} className="grid h-12 w-12 place-items-center overflow-hidden rounded-full bg-emerald-500 text-green-950 font-bold">
          {avatarContent(user.avatar)}
        </button>
        <span className="mt-0.5 text-[10px] font-semibold text-slate-400">{`v${__APP_VERSION__}`}</span>
        {open && (
          <div className="avatar-menu">
            <button onClick={onLogout}><LogOut size={17} /> {t('logout')}</button>
          </div>
        )}
      </div>
    </header>
  );
}

function Dashboard({ userId, onStart, refresh, settings, onChanged }) {
  // Đọc từ gymStore (single source of truth)
  const data = useGymStore(userId, (s) => s.dashboard);
  const groups = useGymStore(userId, (s) => s.groups || []);
  const routines = useGymStore(userId, (s) => s.routines || []);
  const rules = useGymStore(userId, (s) => s.scheduleRules || []);
  const routineData = { routines, rules };
  const activeSession = useGymStore(userId, (s) => s.activeSessions);
  const [clock, setClock] = useState(new Date());

  // Wrapper setters cho compatibility với code cũ trong handlers (setData để update local optimistic)
  const setData = (updater) => {
    const userIdNum = Number(userId);
    updateStore(userIdNum, (store) => ({ ...store, dashboard: typeof updater === 'function' ? updater(store.dashboard) : updater }));
  };

  const loadAll = React.useCallback(async () => {
    await syncPendingBeforeCatalogLoad(userId);
    // api() success sẽ tự ghi vào gymStore
    api(`/api/dashboard?userId=${userId}`).catch(() => {});
    api(`/api/groups?userId=${userId}`).catch(() => {});
    api(`/api/routines?userId=${userId}`).catch(() => {});
    api(`/api/sessions/active?userId=${userId}`).catch(() => {});
  }, [userId]);

  useEffect(() => { loadAll(); }, [userId, refresh]);

  // Live sync: tự refresh khi máy khác cập nhật data
  useLiveSync(userId, loadAll);
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const startRoutine = async (routine, initialIndex = 0, initialView = 'list') => {
    // Kiểm tra đã có buổi tập active cho routine này hôm nay chưa
    const active = await api(`/api/sessions/active?userId=${userId}`);
    const existing = active?.sessions?.find((s) => s.session.routine_id === routine.id);
    if (existing) {
      onStart({ sessionId: existing.session.id, initialIndex, initialView });
      return;
    }
    const session = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ userId, routineId: routine.id, scheduleMode: 'FREE' }) });
    onStart({ sessionId: session.id, initialIndex, initialView });
  };
  const startGroup = async (group) => {
    const active = await api(`/api/sessions/active?userId=${userId}`);
    const existing = active?.sessions?.find((s) => s.session.group_id === group.id);
    if (existing) {
      onStart({ sessionId: existing.session.id });
      return;
    }
    const session = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ userId, groupId: group.id, scheduleMode: 'FREE' }) });
    onStart({ sessionId: session.id });
  };

  const suggestion = data?.suggestion;
  const todaySummary = data?.todaySummary || [];
  const removeHistoryItem = async (sessionId) => {
    setData((current) => current ? {
      ...current,
      recentHistory: (current.recentHistory || []).filter((row) => row.id !== sessionId)
    } : current);
    const nextDashboard = await api(`/api/dashboard?userId=${userId}`);
    setData(nextDashboard);
    onChanged?.();
  };
  return (
    <section className="space-y-5">
      <BodyWeightInput userId={userId} settings={settings} />
      <TodayWorkoutCard suggestion={suggestion} clock={clock} todaySummary={todaySummary} onStartRoutine={startRoutine} settings={settings} activeSession={activeSession} />
      <FreeTraining routines={routineData.routines} groups={groups} onStartRoutine={startRoutine} onStartGroup={startGroup} />
      <CurrentWeekPlan suggestion={suggestion} history={data?.recentHistory || []} routines={routineData.routines} rules={routineData.rules} />
      <ActivityCalendar calendar={data?.activityCalendar || []} history={data?.recentHistory || []} settings={settings} />
      <HistoryList userId={userId} history={data?.recentHistory || []} onDeleted={removeHistoryItem} settings={settings} />
    </section>
  );
}

function BodyWeightInput({ userId, settings }) {
  const t = useLang();
  const [weight, setWeight] = useState('');
  const [unit, setUnit] = useState(settings.default_weight_unit || 'kg');
  const [history, setHistory] = useState([]);
  const loadHistory = () => api(`/api/body-weight/recent?userId=${userId}`).then(setHistory);
  useEffect(() => {
    loadHistory();
  }, [userId]);
  const save = async () => {
    if (!weight) return;
    await api('/api/body-weight', { method: 'POST', body: JSON.stringify({ userId, weight: Number(weight), unit }) });
    setWeight('');
    loadHistory();
  };
  return (
    <div className="panel body-weight-card">
      <div className="body-weight-panel">
        <div className="min-w-0">
          <label className="label">{t('bw_label')}</label>
          <input className="input compact-input" type="number" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="72.5" />
        </div>
        <select className="input body-weight-unit compact-input" value={unit} onChange={(e) => setUnit(e.target.value)}>
          <option value="kg">kg</option>
          <option value="lb">lb</option>
        </select>
        <button className="icon-btn" onClick={save}><Check /></button>
      </div>
      <div className="weight-history">
        <div className="grid grid-cols-[1fr_auto] border-b border-stone-200 pb-1 text-xs font-bold uppercase text-slate-500">
          <span>{t('bw_date')}</span>
          <span>{t('bw_weight')}</span>
        </div>
        {history.length === 0 && <p className="py-2 text-sm text-slate-600">{t('bw_no_history')}</p>}
        {history.map((row) => (
          <div key={row.id} className="grid grid-cols-[1fr_auto] gap-3 border-b border-stone-100 py-2 text-sm last:border-b-0">
            <span className="font-semibold text-slate-700">{formatDate(row.logged_at, settings)}</span>
            <span className="font-black text-slate-950">{row.weight} {row.unit}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TodayWorkoutCard({ suggestion, clock, todaySummary, onStartRoutine, settings, activeSession }) {
  const t = useLang();
  const summaryByExercise = new Map(todaySummary.map((row) => [row.exercise_id, row]));
  const routine = suggestion?.routine;
  const doneCount = routine?.exercises.filter((exercise) => summaryByExercise.has(exercise.id)).length || 0;
  const exerciseIndexById = new Map((routine?.exercises || []).map((exercise, index) => [exercise.id, index]));
  // Có buổi tập đang dở cho routine hôm nay không?
  const hasActiveSession = activeSession?.sessions?.some((s) => s.session.routine_id === routine?.id);

  return (
    <div className="panel-green">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-emerald-200">{formatTime(clock, settings)}</p>
          <h2 className="mt-1 text-2xl font-bold">{
            !suggestion ? t('today_title') :
            suggestion.mode === 'FREE' ? t('mode_free') :
            suggestion.routine ? t('today_title') :
            suggestion.mode === 'ROLLING' ? t('schedule_rolling') :
            t('no_session')
          }</h2>
          <p className="mt-2 text-sm text-emerald-200">
            {routine ? `${routine.name} · ${routine.groups.length} Group · ${routine.exercises.length} ${t('bài')}` : t('today_no_routine')}
          </p>
        </div>
        <CalendarDays size={34} />
      </div>

      {routine ? (
        <div className="mt-5 space-y-4">
          <div className="rounded-lg bg-white/8 p-3">
            <p className="text-sm text-emerald-200">{t('today_progress')}</p>
            <p className="mt-1 text-xl font-bold">{t('logged_count', doneCount, routine.exercises.length)}</p>
            <p className="mt-1 text-sm text-emerald-200">
              {todaySummary.length ? `${todaySummary.reduce((sum, row) => sum + Number(row.sets || 0), 0)} ${t('set')} · ${todaySummary.reduce((sum, row) => sum + Number(row.total_reps || 0), 0)} reps` : t('today_no_result')}
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {routine.groups.map((group) => (
              <div key={group.id} className="rounded-lg border border-white/20 p-3" style={{background:'rgba(255,255,255,0.06)'}}>
                <strong className="text-sm">{group.name}</strong>
                <div className="mt-2 space-y-2">
                  {group.exercises.map((exercise) => {
                    const summary = summaryByExercise.get(exercise.id);
                    const done = Boolean(summary);
                    return (
                      <button
                        key={exercise.id}
                        className={`flex w-full items-center gap-2 rounded-lg border p-2 text-left ${done ? 'border-emerald-300 bg-emerald-50' : 'border-orange-200 bg-orange-50'}`}
                        onClick={() => onStartRoutine(routine, exerciseIndexById.get(exercise.id) || 0, 'exercise')}
                      >
                        {exerciseAutoMediaUrl(exercise)
                          ? <img src={exerciseAutoMediaUrl(exercise)} className="h-12 w-12 shrink-0 rounded bg-white object-contain" />
                          : <span className="grid h-12 w-12 shrink-0 place-items-center rounded bg-white text-2xl">{exercise.customIcon || '🏋️'}</span>}
                        <div className="min-w-0 flex-1">
                          <p className={`text-sm font-bold leading-tight ${done ? 'text-emerald-900' : 'text-orange-900'}`}>{exercise.name}</p>
                          <p className={`mt-0.5 text-xs font-semibold ${done ? 'text-emerald-700' : 'text-orange-700'}`}>
                            {done ? `${t('sets_logged', summary.sets)} · max ${summary.max_weight} kg` : t('today_not_done')}
                          </p>
                        </div>
                        <span className={`shrink-0 rounded px-3 py-1 text-xs font-black ${done ? 'bg-emerald-600 text-white' : 'bg-[#f05a28] text-white'}`}>
                          {done ? t('continue_exercise') : t('start_exercise')}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <button className="primary-light" onClick={() => onStartRoutine(routine)}>
            {hasActiveSession ? t('today_continue') : doneCount > 0 ? t('today_continue') : t('today_start')}
          </button>
        </div>
      ) : (
        <p className="mt-5 rounded-lg bg-white/8 p-3 text-sm text-emerald-100">{t('today_go_schedule')}</p>
      )}
    </div>
  );
}

function FreeTraining({ routines, groups, onStartRoutine, onStartGroup }) {
  const t = useLang();
  return (
    <div className="panel">
      <h2 className="section-title">{t('free_title')}</h2>
      <div className="space-y-4">
        <FreeTrainingSection title={t('free_routines')} items={routines} empty={t('free_no_routine')} onStart={onStartRoutine} />
        <FreeTrainingSection title={t('free_groups')} items={groups} empty={t('free_no_group')} onStart={onStartGroup} />
      </div>
    </div>
  );
}

function FreeTrainingSection({ title, items, empty, onStart }) {
  const t = useLang();
  return (
    <div>
      <h3 className="mb-2 text-sm font-bold text-teal-950">{title}</h3>
      <div className="grid gap-2 md:grid-cols-2">
        {items.length === 0 && <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">{empty}</p>}
        {items.map((item) => {
          const thumbs = item.exercises.slice(0, 4);
          return (
            <button key={item.id} className="rounded-lg border border-slate-200 bg-white p-3 text-left" onClick={() => onStart(item)}>
              <div className="flex items-center gap-3">
                <img src={exerciseAutoMediaUrl(thumbs[0])} className="h-14 w-14 rounded-md bg-slate-50 object-contain ring-1 ring-slate-200" />
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-slate-950">{item.name}</p>
                  <p className="text-sm text-teal-950">{t('exercises', item.exercises.length)}</p>
                </div>
                <div className="flex -space-x-2">
                  {thumbs.map((exercise) => <img key={exercise.id} src={exerciseAutoMediaUrl(exercise)} className="h-9 w-9 rounded-full border-2 border-white bg-slate-50 object-contain" />)}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StartWorkoutPage({ userId, onStart, refresh, settings }) {
  const t = useLang();
  const dialog = useAppDialog();
  const groups = useGymStore(userId, (s) => s.groups || []);
  const routines = useGymStore(userId, (s) => s.routines || []);
  const routineData = { routines };
  const [activeSessions, setActiveSessions] = useState([]);

  useEffect(() => {
    syncPendingBeforeCatalogLoad(userId).finally(() => {
      api(`/api/groups?userId=${userId}`).catch(() => {});
      api(`/api/routines?userId=${userId}`).catch(() => {});
      api(`/api/sessions/active?userId=${userId}`).then((payload) => setActiveSessions(payload?.sessions || (payload?.session ? [payload] : [])));
    });
  }, [userId, refresh]);

  const startRoutine = async (routine, scheduleMode = 'FREE') => {
    const session = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ userId, routineId: routine.id, scheduleMode }) });
    onStart({ sessionId: session.id });
  };
  const startGroup = async (group) => {
    const session = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ userId, groupId: group.id, scheduleMode: 'FREE' }) });
    onStart({ sessionId: session.id });
  };
  const completeActiveSession = async (active) => {
    const totalSets = active.exercises.reduce((sum, exercise) => sum + Number(exercise.completedSets || 0), 0);
    if (!totalSets && !(await dialog.confirm(t('confirm_no_sets')))) return;
    await api(`/api/sessions/${active.session.id}/complete`, { method: 'POST', body: JSON.stringify({ userId }) });
    localStorage.removeItem(`familyGymWorkout:${userId}`);
    setActiveSessions((current) => current.filter((item) => item.session.id !== active.session.id));
  };
  const deleteActiveSession = async (active) => {
    if (!(await dialog.confirm(t('confirm_delete_session')))) return;
    await api(`/api/sessions/${active.session.id}`, { method: 'DELETE', body: JSON.stringify({ userId }) });
    localStorage.removeItem(`familyGymWorkout:${userId}`);
    setActiveSessions((current) => current.filter((item) => item.session.id !== active.session.id));
  };
  return (
    <section className="space-y-5">
      <div className="panel-green">
        <h1 className="text-2xl font-black">{t('start_continue')}</h1>
        <p className="mt-2 text-sm text-emerald-100">
          {activeSessions.length ? t('start_active', activeSessions.length) : t('start_no_active')}
        </p>
      </div>
      {activeSessions.length ? (
        <div className="grid gap-3">
          {activeSessions.map((active) => {
            const title = active.routine?.name || active.group?.name || t('session_free_label');
            const doneCount = active.exercises.filter((exercise) => Number(exercise.completedSets || 0) > 0).length;
            const totalSets = active.exercises.reduce((sum, exercise) => sum + Number(exercise.completedSets || 0), 0);
            const exerciseGroups = workoutExerciseGroups(active);
            return (
              <article key={active.session.id} className="workout-card">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-black">{title}</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {active.exercises.length} {t('bài')} · {t('logged_count', doneCount, active.exercises.length)} · {totalSets} {t('set')} · {t('started')} {formatTime(active.session.started_at, settings)}
                    </p>
                  </div>
                </div>
                <div className="mt-4 space-y-4">
                  {exerciseGroups.map((group) => (
                    <div key={`${active.session.id}-${group.id}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <h3 className="font-black text-slate-950">{group.name}</h3>
                        <span className="text-xs font-bold text-slate-500">{t('builder_exercises_count', group.exercises.length)}</span>
                      </div>
                      <div className="grid gap-2">
                        {group.exercises.map((exercise) => (
                          <button
                            key={`${active.session.id}-${group.id}-${exercise.id}-${exercise.workoutIndex}`}
                            className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left ${exercise.completedSets ? 'border-emerald-300 bg-emerald-50' : 'border-orange-200 bg-orange-50'}`}
                            onClick={() => onStart({ sessionId: active.session.id, initialIndex: exercise.workoutIndex, initialView: 'exercise' })}
                          >
                            {exerciseAutoMediaUrl(exercise) ? <img src={exerciseAutoMediaUrl(exercise)} className="h-12 w-12 shrink-0 rounded bg-white object-contain" /> : <span className="grid h-12 w-12 shrink-0 place-items-center rounded bg-white text-2xl">{exercise.customIcon || '🏋️'}</span>}
                            <div className="min-w-0 flex-1">
                              <p className="break-words font-bold leading-snug">{exercise.name}</p>
                              <p className={`mt-0.5 text-sm font-semibold ${exercise.completedSets ? 'text-emerald-800' : 'text-orange-800'}`}>
                                {exercise.completedSets ? t('exercise_set_done', exercise.completedSets) : t('exercise_not_done')} · {exercise.target}
                              </p>
                            </div>
                            <span className={`shrink-0 rounded px-2 py-1 text-xs font-black ${exercise.completedSets ? 'bg-emerald-600 text-white' : 'bg-[#f05a28] text-white'}`}>
                              {exercise.completedSets ? t('continue_exercise') : t('start_exercise')}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 grid gap-2 md:grid-cols-3">
                  <button className="primary-green" onClick={() => onStart({ sessionId: active.session.id, initialIndex: 0, initialView: 'list' })}>{t('start_continue')}</button>
                  <button className="primary" onClick={() => completeActiveSession(active)}>{t('end_session')}</button>
                  <button className="danger-btn" onClick={() => deleteActiveSession(active)}>{t('delete_session')}</button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="workout-card py-10 text-center">
          <h2 className="text-xl font-black text-slate-950">{t('start_no_active')}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm font-semibold text-slate-500">{t('start_continue')}</p>
        </div>
      )}
    </section>
  );
}

function CurrentWeekPlan({ suggestion, history, routines, rules }) {
  const t = useLang();
  const [offset, setOffset] = useState(0); // offset in days from today-centered view

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const historyByDay = new Map();
  for (const row of history) {
    const key = localIsoDate(parseServerDate(row.completed_at));
    if (!historyByDay.has(key)) historyByDay.set(key, []);
    historyByDay.get(key).push(row);
  }
  const doneDays = new Set(historyByDay.keys());
  const routineById = new Map(routines.map((routine) => [routine.id, routine]));
  const fixedByDay = new Map(rules.filter((rule) => rule.mode === 'FIXED').map((rule) => [rule.day_of_week, routineById.get(rule.routine_id)]));
  const rollingRules = rules.filter((rule) => rule.mode === 'ROLLING').sort((a, b) => a.order_index - b.order_index);
  const isRolling = suggestion?.mode === 'ROLLING';

  // Luôn hiện 7 ngày, today ở giữa (cả fixed lẫn rolling)
  const dayCount = 7;
  const centerOffset = -3; // today at index 3

  // For rolling: count future sessions from rolling index
  let rollingFutureOffset = 0;

  const scheduleItems = Array.from({ length: dayCount }, (_, itemIndex) => {
    const date = new Date(startOfToday);
    date.setDate(startOfToday.getDate() + centerOffset + itemIndex + offset);
    const weekdayIndex = date.getDay() === 0 ? 6 : date.getDay() - 1;
    const key = localIsoDate(date);
    const dayHistory = historyByDay.get(key) || [];
    const done = doneDays.has(key);
    const mainDone = dayHistory[0];
    const fixedRoutine = fixedByDay.get(weekdayIndex);

    let rollingRoutine = null;
    if (isRolling && rollingRules.length) {
      const isPastOrToday = date <= startOfToday;
      if (isPastOrToday && done) {
        // Ngày đã tập: lấy từ history
        const historyRoutineId = mainDone?.routine_id;
        rollingRoutine = historyRoutineId ? routineById.get(historyRoutineId) : null;
      } else if (!isPastOrToday || (isPastOrToday && date.toDateString() === today.toDateString())) {
        // Hôm nay hoặc tương lai: tính theo rolling index, KHÔNG wrap — hết buổi thì để trống
        const baseIndex = Math.max(0, (suggestion?.rollingIndex || 1) - 1);
        const ruleIndex = baseIndex + rollingFutureOffset;
        const rule = ruleIndex < rollingRules.length ? rollingRules[ruleIndex] : null;
        rollingRoutine = rule ? routineById.get(rule.routine_id) : null;
        rollingFutureOffset++;
      }
    }

    const routine = suggestion?.mode === 'FIXED' ? fixedRoutine : isRolling ? rollingRoutine : null;
    return {
      key,
      label: t('days')[weekdayIndex],
      date,
      isToday: date.toDateString() === today.toDateString(),
      isPast: date < startOfToday,
      done,
      mainDone,
      dayHistory,
      routine,
      title: done ? (mainDone?.routine_name || mainDone?.group_name || t('session_free')) : routine?.name || t('no_session'),
      imageUrl: done ? (mainDone?.gifUrl || mainDone?.imageUrl) : exerciseAutoMediaUrl(routine?.exercises?.[0]),
      content: done
        ? `${t('sets_min', mainDone?.sets || 0, mainDone?.duration_minutes || 0)}${dayHistory.length > 1 ? ` · ${t('more_sessions', dayHistory.length - 1)}` : ''}`
        : routine ? `${routine.groups?.length || 0} Group · ${routine.exercises?.length || 0} ${t('bài')}` : t('go_schedule')
    };
  });

  // Date range label for header
  const firstDate = scheduleItems[0]?.date;
  const lastDate = scheduleItems[scheduleItems.length - 1]?.date;
  const rangeLabel = firstDate && lastDate
    ? `${firstDate.getDate()}/${firstDate.getMonth() + 1} – ${lastDate.getDate()}/${lastDate.getMonth() + 1}`
    : '';

  return (
    <div className="panel">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="section-title mb-0">{isRolling ? t('rolling_title') : t('week_title')}</h2>
        <div className="flex items-center gap-2">
            <button
              className="tiny-btn"
              onClick={() => setOffset((v) => v - 3)}
              title="Lui 3 ngày"
            >‹‹</button>
            {offset !== 0 && (
              <button
                className="ghost-btn px-2 py-1 text-xs"
                onClick={() => setOffset(0)}
                title="Về hôm nay"
              >↩</button>
            )}
            <span className="text-xs text-slate-500 font-semibold">{rangeLabel}</span>
            <button
              className="tiny-btn"
              onClick={() => setOffset((v) => v + 3)}
              title="Tới 3 ngày"
            >››</button>
          </div>
      </div>
      <div className="week-plan-grid">
        {scheduleItems.map((item) => {
          const hasRoutine = Boolean(item.routine);
          const isFuture = !item.isPast && !item.isToday;

          // Badge: trạng thái rõ ràng
          let badge = null;
          if (item.done) {
            badge = (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black"
                style={{background:'#16a34a',color:'#fff'}}>
                ✓ {t('today_done')}
              </span>
            );
          } else if (hasRoutine && item.isPast) {
            badge = (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black"
                style={{background:'#f05a28',color:'#fff'}}>
                ✗ {t('not_trained')}
              </span>
            );
          } else if (hasRoutine && (item.isToday || isFuture)) {
            badge = (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black"
                style={{background:'#2563eb',color:'#fff'}}>
                ◉ {t('schedule_fixed')}
              </span>
            );
          } else if (!hasRoutine && !item.done) {
            badge = (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black"
                style={{background:'rgba(0,0,0,0.12)',color:'inherit',opacity:0.7}}>
                – {t('no_session')}
              </span>
            );
          }

          return (
          <div key={item.key} className={`week-day-card ${item.isToday ? 'today' : ''} ${item.isPast && !item.done ? 'past' : ''} ${item.done ? 'done' : ''}`}>
            <div className="week-day-date">
              <p>{item.label}</p>
              <strong>{item.date.getDate()}</strong>
            </div>
            {item.imageUrl ? (
              <img src={item.imageUrl} className="week-day-image" />
            ) : (
              <div className="week-day-image empty"><Dumbbell size={22} /></div>
            )}
            <div className="week-day-content">
              <h3>{item.title}</h3>
              <p>{item.content}</p>
              <div className="mt-1 md:flex md:justify-center">{badge}</div>
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}

function ActivityCalendar({ calendar, history, settings }) {
  const t = useLang();
  const [tip, setTip] = useState(null);
  const byDay = new Map(calendar.map((row) => [row.day, row]));
  const freeSessionName = t('history_free_session');
  const historyByDay = new Map();
  for (const row of history) {
    const date = parseServerDate(row.completed_at);
    if (!date) continue;
    const key = localIsoDate(date);
    const name = row.routine_name || row.group_name || freeSessionName;
    const list = historyByDay.get(key) || [];
    list.push({ ...row, activityName: name, color: stableColorForName(name) });
    historyByDay.set(key, list);
  }
  const cells = [];
  const today = new Date();
  const start = new Date(today);
  const offset = today.getDay() === 0 ? -27 : 1 - today.getDay() - 21;
  start.setDate(today.getDate() + offset);
  for (let i = 0; i < 28; i += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const iso = localIsoDate(date);
    const activities = historyByDay.get(iso) || [];
    cells.push({ iso, date, data: byDay.get(iso), activities });
  }
  const total = calendar.reduce((sum, row) => sum + Number(row.total || 0), 0);
  const bars = history.slice(0, 3);
  const legend = [];
  const legendKeys = new Set();
  for (const row of bars) {
    const name = row.routine_name || row.group_name || freeSessionName;
    if (legendKeys.has(name)) continue;
    legendKeys.add(name);
    legend.push({ name, color: stableColorForName(name) });
  }

  return (
    <div className="panel">
      <div className="grid grid-cols-[120px_1fr] gap-4 md:grid-cols-[150px_240px_1fr]">
        <div>
          <p className="text-sm font-bold">{t('cal_4weeks')}</p>
          <p className="mt-4 text-6xl font-black">{total}</p>
          <p className="mt-2 text-sm text-slate-600">{t('cal_total')}</p>
        </div>
        <div>
          <div className="grid grid-cols-7 text-center text-sm font-bold">
            {t('days').map((d) => <span key={d}>{d}</span>)}
          </div>
          <div className="mt-3 grid grid-cols-7 gap-y-3 text-center">
            {cells.map((cell) => (
              <div
                key={cell.iso}
                onMouseEnter={(event) => setTip({ x: event.clientX, y: event.clientY, text: `${formatDate(cell.date, settings)} · ${cell.data?.total || 0} ${t('cal_activity')}${cell.activities.length ? ` · ${cell.activities.map((item) => item.activityName).join(', ')}` : ''}` })}
                onMouseMove={(event) => setTip((old) => old ? { ...old, x: event.clientX, y: event.clientY } : old)}
                onMouseLeave={() => setTip(null)}
                onClick={() => setTip({ x: window.innerWidth / 2, y: 180, text: `${formatDate(cell.date, settings)} · ${cell.data?.total || 0} ${t('cal_activity')}${cell.activities.length ? ` · ${cell.activities.map((item) => item.activityName).join(', ')}` : ''}` })}
                className="grid cursor-pointer place-items-center"
              >
                {cell.data ? <Dumbbell size={15} style={cell.activities.length === 1 ? { color: cell.activities[0].color.dot } : undefined} className={cell.activities.length === 1 ? '' : 'text-teal-950'} /> : <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
              </div>
            ))}
          </div>
        </div>
        <div className="col-span-2 space-y-3 md:col-span-1">
          {bars.length === 0 && <p className="text-sm text-slate-600">{t('cal_no_data')}</p>}
          {legend.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1">
              {legend.map((item) => (
                <span key={item.name} className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700">
                  <span className="h-2.5 w-2.5 rounded-full ring-1" style={{ backgroundColor: item.color.dot, borderColor: item.color.ring }} />
                  {item.name}
                </span>
              ))}
            </div>
          )}
          {bars.map((row) => {
            const color = stableColorForName(row.routine_name || row.group_name || freeSessionName);
            return (
              <div key={row.id} className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full ring-1" style={{ backgroundColor: color.dot, borderColor: color.ring }} />
                <div
                  className="h-5 ring-1"
                  title={row.routine_name || row.group_name || freeSessionName}
                  style={{
                    width: `${Math.min(220, 60 + row.duration_minutes * 2)}px`,
                    backgroundColor: color.fill,
                    borderColor: color.ring
                  }}
                />
                <span className="text-sm font-bold">{row.duration_minutes} {t('min')}</span>
              </div>
            );
          })}
        </div>
      </div>
      {tip && <div className="calendar-tip" style={{ left: tip.x + 10, top: tip.y + 10 }}>{tip.text}</div>}
    </div>
  );
}

function HistoryList({ userId, history, onDeleted, settings }) {
  const t = useLang();
  const dialog = useAppDialog();
  const [openSessionId, setOpenSessionId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loadedHistory, setLoadedHistory] = useState(history.slice(0, 20));
  const [hasMore, setHasMore] = useState(history.length >= 20);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => {
    setLoadedHistory(history.slice(0, 20));
    setHasMore(history.length >= 20);
  }, [history]);
  const removeSession = async (sessionId) => {
    if (!(await dialog.confirm(t('history_confirm_delete')))) return;
    await api(`/api/sessions/${sessionId}`, { method: 'DELETE', body: JSON.stringify({ userId }) });
    if (openSessionId === sessionId) {
      setOpenSessionId(null);
      setDetail(null);
    }
    setLoadedHistory((current) => current.filter((row) => row.id !== sessionId));
    onDeleted(sessionId);
  };
  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const payload = await api(`/api/history?userId=${userId}&offset=${loadedHistory.length}&limit=20`);
      setLoadedHistory((current) => {
        const seen = new Set(current.map((row) => row.id));
        return [...current, ...(payload.rows || []).filter((row) => !seen.has(row.id))];
      });
      setHasMore(Boolean(payload.hasMore));
    } finally {
      setLoadingMore(false);
    }
  };
  const toggleDetail = async (sessionId) => {
    if (openSessionId === sessionId) {
      setOpenSessionId(null);
      setDetail(null);
      return;
    }
    setOpenSessionId(sessionId);
    setDetail(null);
    setDetail(await api(`/api/sessions/${sessionId}/detail?userId=${userId}`));
  };
  return (
    <div>
      <h2 className="section-title">{t('history_title')}</h2>
      <div className="space-y-2">
        {loadedHistory.map((row) => {
          const activityName = row.routine_name || row.group_name || t('history_free_session');
          const color = stableColorForName(activityName);
          return (
            <div key={row.id} className="panel">
              <div className="flex items-center justify-between gap-3">
                <button className="min-w-0 flex-1 text-left" onClick={() => toggleDetail(row.id)}>
                  <p className="font-bold">{activityName}</p>
                  <p className="text-sm text-teal-900">
                    {formatDateTime(row.completed_at, settings)} · {row.exercises || 0} {t('bài')} · {row.sets} {t('set')} · {row.duration_minutes} {t('min')}
                  </p>
                </button>
                <div className="flex items-center gap-2">
                  <Dumbbell style={{ color: color.dot }} />
                  <button className="small-danger" onClick={() => removeSession(row.id)}><Trash2 size={16} /> {t('history_delete')}</button>
                </div>
              </div>
              {openSessionId === row.id && <SessionDetail detail={detail} settings={settings} />}
            </div>
          );
        })}
        {hasMore && (
          <button className="ghost-btn w-full" disabled={loadingMore} onClick={loadMore}>
            {loadingMore ? t('history_loading') : t('history_load_more')}
          </button>
        )}
      </div>
    </div>
  );
}

function fileToDataUrl(file) {
  if (!file) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function exerciseMediaUrl(exercise) {
  if (exercise?.displayMedia === 'icon') return '';
  if (exercise?.displayMedia === 'image') return exercise?.imageUrl || '';
  if (exercise?.displayMedia === 'gif') return exercise?.gifUrl || '';
  return exercise?.imageUrl || exercise?.gifUrl || '';
}

function exerciseAutoMediaUrl(exercise) {
  if (exercise?.displayMedia === 'icon') return '';
  if (exercise?.displayMedia === 'image') return exercise?.imageUrl || '';
  return exercise?.gifUrl || exercise?.imageUrl || '';
}

function workoutExerciseGroups(sessionData, t) {
  const flat = sessionData?.exercises || [];
  const used = new Set();
  const takeFlatExercise = (exercise, groupName) => {
    let index = flat.findIndex((item, itemIndex) => !used.has(itemIndex) && item.id === exercise.id && (!groupName || item.groupName === groupName));
    if (index < 0) index = flat.findIndex((item, itemIndex) => !used.has(itemIndex) && item.id === exercise.id);
    if (index < 0) index = flat.findIndex((item) => item.id === exercise.id);
    const source = index >= 0 ? flat[index] : exercise;
    if (index >= 0) used.add(index);
    return { ...exercise, ...source, workoutIndex: index >= 0 ? index : 0 };
  };

  if (sessionData?.routine?.groups?.length) {
    return sessionData.routine.groups.map((group) => ({
      id: group.id,
      name: group.name,
      exercises: (group.exercises || []).map((exercise) => takeFlatExercise(exercise, group.name))
    })).filter((group) => group.exercises.length);
  }

  if (sessionData?.group?.exercises?.length) {
    return [{
      id: sessionData.group.id || 'group',
      name: sessionData.group.name || (t ? t('free_groups') : 'Exercise Group'),
      exercises: sessionData.group.exercises.map((exercise) => takeFlatExercise(exercise, sessionData.group.name))
    }];
  }

  return [{ id: 'all', name: t ? t('nav_library') : 'Exercises', exercises: flat.map((exercise, index) => ({ ...exercise, workoutIndex: index })) }];
}

function SessionDetail({ detail, settings }) {
  const t = useLang();
  if (!detail) return <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm text-slate-600">{t('detail_loading')}</div>;
  const statusText = detail.summary.effectiveness >= 60
    ? t('detail_effective')
    : detail.summary.effectiveness >= 30
      ? t('detail_progress')
      : t('detail_maintain');
  return (
    <div className="mt-3 space-y-3 rounded-lg border border-stone-200 bg-white p-3">
      <div className="rounded-md bg-slate-50 p-2 text-sm text-slate-700">
        <strong>{t('detail_time')}:</strong> {formatTime(detail.session.started_at, settings)} - {formatTime(detail.session.completed_at, settings)} · {detail.session.duration_minutes} {t('min')}
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md bg-slate-50 p-2"><p className="text-xs text-slate-500">{t('detail_exercises')}</p><strong>{detail.summary.exerciseCount}</strong></div>
        <div className="rounded-md bg-slate-50 p-2"><p className="text-xs text-slate-500">{t('detail_sets')}</p><strong>{detail.summary.totalSets}</strong></div>
        <div className="rounded-md bg-slate-50 p-2"><p className="text-xs text-slate-500">{t('detail_volume')}</p><strong>{Math.round(detail.summary.totalVolume)}</strong></div>
      </div>
      <p className="rounded-md bg-orange-50 p-2 text-sm font-bold text-orange-900">{statusText} · {t('detail_improved', detail.summary.improvedCount, detail.summary.exerciseCount)}</p>
      <div className="space-y-2">
        {detail.exercises.map((exercise) => {
          const volumeDiff = exercise.volume - exercise.previousVolume;
          const weightDiff = exercise.maxWeight - exercise.previousMaxWeight;
          return (
            <div key={exercise.id} className="rounded-md bg-slate-50 p-2">
              <div className="flex gap-2">
                <img src={exerciseAutoMediaUrl(exercise)} className="h-12 w-12 rounded bg-white object-contain" />
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{exercise.name}</p>
                  <p className="text-xs text-slate-600">{exercise.sets.length} set · max {exercise.maxWeight} kg · volume {Math.round(exercise.volume)}</p>
                  <p className={`text-xs font-bold ${volumeDiff > 0 || weightDiff > 0 ? 'text-green-700' : 'text-slate-500'}`}>
                    {t('detail_vs_prev', `${volumeDiff >= 0 ? '+' : ''}${Math.round(volumeDiff)}`, `${weightDiff >= 0 ? '+' : ''}${weightDiff}`)}
                  </p>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1 text-xs">
                {exercise.sets.map((set) => <span key={set.id} className="rounded bg-white px-2 py-1">Set {set.setIndex}: {set.weightKg}kg x {set.reps}</span>)}
              </div>
              <div className="mt-2 rounded-md border border-dashed border-slate-200 bg-white p-2">
                <p className="mb-1 text-xs font-bold text-slate-500">
                  {t('detail_prev')} {exercise.previousCompletedAt ? `(${formatDateTime(exercise.previousCompletedAt, settings)})` : ''}
                </p>
                {exercise.previous.length ? (
                  <div className="grid grid-cols-3 gap-1 text-xs">
                    {exercise.previous.map((set) => <span key={set.id} className="rounded bg-slate-50 px-2 py-1">Set {set.setIndex}: {set.weightKg}kg x {set.reps}</span>)}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">{t('detail_no_prev')}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ExerciseLibrary({ userId, settings }) {
  const t = useLang();
  const dialog = useAppDialog();
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({ targets: [] });
  const [q, setQ] = useState('');
  const [target, setTarget] = useState('');
  // Đọc groups từ gymStore để phản ánh offline changes ngay lập tức
  const groups = useGymStore(userId, (s) => s.groups || []);
  const [selectedExercise, setSelectedExercise] = useState(null);
  const [editingExercise, setEditingExercise] = useState(null);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [visibleCount, setVisibleCount] = useState(60);
  const [previewGifId, setPreviewGifId] = useState(null);
  const [pinnedGifIds, setPinnedGifIds] = useState(() => new Set());

  const refreshLibrary = async () => {
    await syncPendingBeforeCatalogLoad(userId);
    setVisibleCount(60);
    setPreviewGifId(null);
    setPinnedGifIds(new Set());
    api(`/api/exercises?userId=${userId}&q=${encodeURIComponent(q)}&target=${encodeURIComponent(target)}`).then((items) => {
      setItems(items);
      // Lazy warm media cho 60 bài đầu hiển thị → có sẵn cho offline
      if (navigator.onLine) {
        const urls = [];
        for (const ex of items.slice(0, 60)) {
          if (ex.imageUrl) urls.push(ex.imageUrl);
          if (ex.gifUrl) urls.push(ex.gifUrl);
        }
        if (urls.length) cacheMediaUrls([...new Set(urls)]).catch(() => {});
      }
    });
    api(`/api/exercises/meta?userId=${userId}`).then(setMeta);
  };

  useEffect(() => {
    syncPendingBeforeCatalogLoad(userId).finally(() => {
      api(`/api/exercises/meta?userId=${userId}`).then(setMeta);
      // groups đọc từ gymStore, chỉ cần fetch để store update
      api(`/api/groups?userId=${userId}`).catch(() => {});
    });
  }, [userId]);
  useEffect(() => {
    setSelectedExercise(null);
    refreshLibrary();
  }, [q, target, userId]);

  const addToGroup = async (groupId, exerciseId) => {
    await api(`/api/groups/${groupId}/exercises`, { method: 'POST', body: JSON.stringify({ userId, exerciseId }) });
    // groups từ gymStore tự cập nhật, không cần setGroups
    const updated = readStore(Number(userId)).groups || [];
    const exercise = updated.flatMap((g) => g.exercises).find((e) => e.id === exerciseId);
    if (exercise && 'caches' in window) {
      const cache = await caches.open(MEDIA_CACHE);
      const urls = [exercise.imageUrl, exercise.gifUrl].filter(Boolean);
      for (const url of urls) { try { if (!(await cache.match(url))) await cache.add(url); } catch {} }
    }
  };
  const handleAddToGroupSelect = async (event, exerciseId) => {
    event.stopPropagation();
    const value = event.target.value;
    event.target.value = '';
    if (!value) return;
    if (value === '__new_group__') {
      const name = await dialog.prompt(t('builder_group_name'));
      if (!name?.trim()) return;
      const created = await api('/api/groups', { method: 'POST', body: JSON.stringify({ userId, name: name.trim() }) });
      // gymStore đã có group mới (optimistic), fetch để sync
      api(`/api/groups?userId=${userId}`).catch(() => {});
      await addToGroup(created.id, exerciseId);
      return;
    }
    await addToGroup(value, exerciseId);
  };
  const playSmallGif = (exercise) => {
    if (exercise.displayMedia === 'icon' || exercise.displayMedia === 'image') return;
    if (exercise.gifUrl) {
      const image = new Image();
      image.src = exercise.gifUrl;
    }
    setPreviewGifId(exercise.id);
  };
  const pinSmallGif = (exercise) => {
    playSmallGif(exercise);
    setPinnedGifIds((current) => {
      const next = new Set(current);
      next.add(exercise.id);
      return next;
    });
  };
  const saveCustomExercise = async (payload) => {
    const method = payload.id ? 'PATCH' : 'POST';
    const path = payload.id ? `/api/exercises/${payload.id}/custom` : '/api/exercises/custom';
    const saved = await api(path, { method, body: JSON.stringify({ ...payload, userId }) });
    setShowCustomForm(false);
    setEditingExercise(null);
    setSelectedExercise(saved);
    refreshLibrary();
  };
  const hideCustomExercise = async (exercise) => {
    if (!(await dialog.confirm(t('lib_hide_confirm')))) return;
    await api(`/api/exercises/${exercise.id}/custom`, { method: 'DELETE', body: JSON.stringify({ userId }) });
    setSelectedExercise(null);
    refreshLibrary();
  };

  if (selectedExercise) {
    return (
      <section className="space-y-4">
        <button className="ghost-btn" onClick={() => setSelectedExercise(null)}>{t('lib_back')}</button>
        <article className="panel">
          {selectedExercise.gifUrl || selectedExercise.imageUrl ? (
            <img src={selectedExercise.gifUrl || selectedExercise.imageUrl} alt={selectedExercise.name} className="mx-auto h-[300px] max-h-[45vh] w-full max-w-xl rounded-lg bg-white object-contain md:h-[360px]" />
          ) : (
            <div className="mx-auto grid h-[300px] max-h-[45vh] w-full max-w-xl place-items-center rounded-lg bg-white text-7xl ring-1 ring-slate-200 md:h-[360px]">{selectedExercise.customIcon || '🏋️'}</div>
          )}
          <h2 className="mt-4 text-2xl font-black">{exerciseDisplayName(selectedExercise, settings)}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {selectedExercise.isCustom && <span className="rounded bg-orange-100 px-2 py-1 text-xs font-black text-orange-900">{t('lib_custom_badge')}</span>}
            {!selectedExercise.imageUrl && !selectedExercise.gifUrl && <span className="text-2xl">{selectedExercise.customIcon || '🏋️'}</span>}
          </div>
          <p className="mt-2 text-sm font-semibold text-teal-950">
            {t('lib_detail_main')} {selectedExercise.target || t('lib_unknown')} · {t('lib_detail_area')} {selectedExercise.bodyPart || t('lib_unknown')} · {t('lib_detail_equipment')} {selectedExercise.equipment || t('lib_unknown')}
          </p>
          {selectedExercise.secondaryMuscles?.length > 0 && (
            <p className="mt-1 text-sm text-slate-600">{t('lib_detail_secondary')} {selectedExercise.secondaryMuscles.join(', ')}</p>
          )}
          <ExerciseInstructions exercise={selectedExercise} settings={settings} />
          <select onChange={(e) => handleAddToGroupSelect(e, selectedExercise.id)} className="input mt-4 py-2 text-sm">
            <option value="">{t('lib_add_to_group_option')}</option>
            {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            <option value="__new_group__">{t('lib_add_new_group_option')}</option>
          </select>
          {selectedExercise.isCustom && (
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <button className="ghost-btn" onClick={() => { setEditingExercise(selectedExercise); setShowCustomForm(true); setSelectedExercise(null); }}>{t('lib_edit_custom')}</button>
              <button className="danger-btn" onClick={() => hideCustomExercise(selectedExercise)}>{t('lib_hide_custom')}</button>
            </div>
          )}
        </article>
      </section>
    );
  }

  if (showCustomForm) {
    return (
      <CustomExerciseForm
        initial={editingExercise}
        onCancel={() => { setShowCustomForm(false); setEditingExercise(null); }}
        onSave={saveCustomExercise}
      />
    );
  }

  const visibleItems = items.slice(0, visibleCount);
  return (
    <section className="space-y-4">
      <div className="sticky top-0 z-10 bg-[#f4f6f1]/95 py-2 backdrop-blur">
        <div className="grid gap-2 md:grid-cols-[1fr_auto]">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('lib_search')} className="input" />
          <button className="primary md:w-auto" onClick={() => { setEditingExercise(null); setShowCustomForm(true); }}>{t('lib_add_custom')}</button>
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          <Chip active={!target} onClick={() => setTarget('')}>{t('lib_all')}</Chip>
          {meta.targets.slice(0, 18).map((value) => <Chip key={value} active={target === value} onClick={() => setTarget(value)}>{value}</Chip>)}
        </div>
        <p className="library-play-hint">{t('lib_gif_hint')}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {visibleItems.map((exercise) => {
          const isPlayingGif = previewGifId === exercise.id || pinnedGifIds.has(exercise.id);
          return (
          <article
            key={exercise.id}
            className="panel cursor-pointer" style={{background:'#fff'}}
            onClick={() => setSelectedExercise(exercise)}
            onMouseLeave={() => {
              if (!pinnedGifIds.has(exercise.id)) setPreviewGifId((id) => id === exercise.id ? null : id);
            }}
          >
            <div className="flex gap-3">
              {exercise.imageUrl || exercise.gifUrl ? (
                <div
                  className="library-media-thumb"
                  onPointerEnter={() => playSmallGif(exercise)}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    playSmallGif(exercise);
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    pinSmallGif(exercise);
                  }}
                >
                  <img
                    src={isPlayingGif && exercise.displayMedia !== 'image' ? exercise.gifUrl || exerciseMediaUrl(exercise) : exerciseMediaUrl(exercise)}
                    alt={exercise.name}
                    loading={isPlayingGif ? 'eager' : 'lazy'}
                    onError={(e) => {
                      const fallback = exercise.gifUrl && e.target.src !== exercise.gifUrl ? exercise.gifUrl
                        : (exercise.imageUrl && e.target.src !== exercise.imageUrl ? exercise.imageUrl : null);
                      if (fallback) e.target.src = fallback;
                    }}
                  />
                </div>
              ) : (
                <div className="grid h-24 w-24 place-items-center rounded-md bg-white text-4xl ring-1 ring-slate-200">{exercise.customIcon || '🏋️'}</div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-bold leading-tight">{exerciseDisplayName(exercise, settings)}</h3>
                  {exercise.isCustom && <span className="rounded bg-orange-100 px-2 py-0.5 text-[11px] font-black text-orange-600">{t('lib_custom_badge')}</span>}
                </div>
                <p className="mt-1 text-sm text-slate-500">{exercise.target} · {exercise.equipment}</p>
                <select onClick={(event) => event.stopPropagation()} onChange={(e) => handleAddToGroupSelect(e, exercise.id)} className="input mt-3 py-2 text-sm">
                  <option value="">{t('lib_add_to_group_option')}</option>
                  {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                  <option value="__new_group__">{t('lib_add_new_group_option')}</option>
                </select>
              </div>
            </div>
          </article>
          );
        })}
      </div>
      {visibleCount < items.length && (
        <button className="ghost-btn w-full" onClick={() => setVisibleCount((count) => count + 60)}>
          {t('lib_show_more', Math.min(60, items.length - visibleCount), visibleCount, items.length)}
        </button>
      )}
    </section>
  );
}

function CustomExerciseForm({ initial, onCancel, onSave }) {
  const t = useLang();
  const customTargetOptions = getCustomTargetOptions(t);
  const [name, setName] = useState(initial?.name || '');
  const [target, setTarget] = useState(initial?.target || customTargetOptions[0]);
  const [bodyPart, setBodyPart] = useState(initial?.bodyPart || initial?.target || customTargetOptions[0]);
  const [secondaryMuscles, setSecondaryMuscles] = useState(initial?.secondaryMuscles?.join(', ') || '');
  const [equipment, setEquipment] = useState(initial?.equipment || customEquipmentOptions[0]);
  const [instructions, setInstructions] = useState(initial?.steps?.length ? initial.steps.join('\n') : initial?.instructions || '');
  const [customIcon, setCustomIcon] = useState(initial?.customIcon || customExerciseIcons[0]);
  const [displayMedia, setDisplayMedia] = useState(initial?.displayMedia || 'auto');
  const [imageDataUrl, setImageDataUrl] = useState(undefined);
  const [gifDataUrl, setGifDataUrl] = useState(undefined);
  const [imagePreview, setImagePreview] = useState(initial?.imageUrl || '');
  const [gifPreview, setGifPreview] = useState(initial?.gifUrl || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const pickImage = async (file) => {
    const dataUrl = await fileToDataUrl(file);
    setImageDataUrl(dataUrl || '');
    setImagePreview(dataUrl || '');
  };
  const pickGif = async (file) => {
    const dataUrl = await fileToDataUrl(file);
    setGifDataUrl(dataUrl || '');
    setGifPreview(dataUrl || '');
  };
  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (!name.trim()) {
      setError(t('custom_error_name'));
      return;
    }
    setSaving(true);
    try {
      await onSave({
        id: initial?.id,
        name,
        target,
        bodyPart,
        muscleGroup: target,
        secondaryMuscles,
        equipment,
        instructions,
        customIcon,
        displayMedia,
        imageDataUrl,
        gifDataUrl
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={submit}>
      <button type="button" className="ghost-btn" onClick={onCancel}>{t('custom_back')}</button>
      <div className="panel space-y-4">
        <div>
          <h2 className="section-title">{initial ? t('custom_title_edit') : t('custom_title_new')}</h2>
          <p className="text-sm text-slate-600">{t('custom_subtitle')}</p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="label">{t('custom_name')}</label>
            <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder={t('custom_name_placeholder')} />
          </div>
          <div>
            <label className="label">{t('custom_target')}</label>
            <select className="input" value={target} onChange={(event) => { setTarget(event.target.value); setBodyPart(event.target.value); }}>
              {customTargetOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>
          <div>
            <label className="label">{t('custom_secondary')}</label>
            <input className="input" value={secondaryMuscles} onChange={(event) => setSecondaryMuscles(event.target.value)} placeholder={t('custom_secondary_placeholder')} />
          </div>
          <div>
            <label className="label">{t('custom_equipment')}</label>
            <select className="input" value={equipment} onChange={(event) => setEquipment(event.target.value)}>
              {customEquipmentOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="label">{t('custom_display')}</label>
          <div className="mt-2 grid grid-cols-4 overflow-hidden rounded-md border border-slate-200 bg-white">
            {[
              ['auto', t('custom_display_auto')],
              ['image', t('custom_display_image')],
              ['gif', t('custom_display_gif')],
              ['icon', t('custom_display_icon')]
            ].map(([value, label]) => (
              <button
                type="button"
                key={value}
                className={`px-2 py-3 text-sm font-black ${displayMedia === value ? 'bg-orange-600 text-white' : 'text-slate-600'}`}
                onClick={() => setDisplayMedia(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label">{t('custom_icon_label')}</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {customExerciseIcons.map((icon) => (
              <button
                type="button"
                key={icon}
                className={`grid h-11 w-11 place-items-center rounded-lg border bg-white text-2xl ${customIcon === icon ? 'border-orange-500 ring-2 ring-orange-200' : 'border-slate-200'}`}
                onClick={() => setCustomIcon(icon)}
              >
                {icon}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <span className="label">{t('custom_image_label')}</span>
            <input className="mt-2 block w-full text-sm" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => pickImage(event.target.files?.[0])} />
            {imagePreview && <img src={imagePreview} className="mt-3 h-32 w-full rounded-md bg-white object-contain" />}
          </label>
          <label className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <span className="label">{t('custom_gif_label')}</span>
            <input className="mt-2 block w-full text-sm" type="file" accept="image/gif,image/webp" onChange={(event) => pickGif(event.target.files?.[0])} />
            {gifPreview && <img src={gifPreview} className="mt-3 h-32 w-full rounded-md bg-white object-contain" />}
          </label>
        </div>

        <div>
          <label className="label">{t('custom_instructions')}</label>
          <textarea className="input min-h-36" value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder={t('custom_instructions_placeholder')} />
        </div>
        {error && <p className="text-sm font-bold text-red-600">{error}</p>}
        <div className="grid gap-2 md:grid-cols-2">
          <button type="submit" className="primary" disabled={saving}>{saving ? t('custom_saving') : t('custom_save')}</button>
          <button type="button" className="ghost-btn" onClick={onCancel}>{t('custom_cancel')}</button>
        </div>
      </div>
    </form>
  );
}

function ExerciseInstructions({ exercise, compact = false, settings = {} }) {
  const t = useLang();
  const rawSteps = (exercise.steps?.length
    ? exercise.steps
    : exercise.instructions
      ? String(exercise.instructions).split(/\n+/)
      : []);
  const steps = rawSteps
    .map((step) => {
      if (typeof step === 'string') return step;
      if (step && typeof step === 'object') return step.text || step.instruction || step.description || Object.values(step).join(' ');
      return String(step || '');
    })
    .map((step) => step.trim())
    .filter(Boolean);
  if (!steps.length) return null;

  return (
    <details className={`mt-3 rounded-md border border-stone-200 bg-stone-50 ${compact ? 'p-2' : 'p-3'}`}>
      <summary className="cursor-pointer text-sm font-bold text-slate-900">{t('lib_instructions_summary')}</summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-slate-700">
        {steps.map((step, index) => <li key={`${exercise.id}-step-${index}`}>{step}</li>)}
      </ol>
    </details>
  );
}

function SortableExerciseRow({ exercise, onRemove }) {
  const t = useLang();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: exercise.id });
  return (
    <div
      ref={setNodeRef}
      className={`exercise-drag-row ${isDragging ? 'dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button className="drag-handle" type="button" title={t('builder_drag_title')} {...attributes} {...listeners}><GripVertical size={18} /></button>
      <img src={exerciseAutoMediaUrl(exercise)} className="h-14 w-14 rounded bg-white object-contain" />
      <span className="min-w-0 flex-1 text-base font-semibold">{exercise.name}</span>
      <button className="small-danger shrink-0" onClick={() => onRemove(exercise.id)}><Trash2 size={16} /> {t('delete')}</button>
    </div>
  );
}

function SortableRoutineGroupRow({ group, onRemove }) {
  const t = useLang();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: group.id });
  return (
    <div
      ref={setNodeRef}
      className={`exercise-drag-row ${isDragging ? 'dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button className="drag-handle" type="button" title={t('builder_drag_title')} {...attributes} {...listeners}><GripVertical size={18} /></button>
      <span className="min-w-0 flex-1 text-sm font-semibold">{group.name}</span>
      <button className="small-danger" onClick={() => onRemove(group.id)}><Trash2 size={16} /> {t('builder_remove_from_routine')}</button>
    </div>
  );
}

function Builder({ userId, boot, onStart, onChanged }) {
  const t = useLang();
  const dialog = useAppDialog();
  // Đọc từ gymStore (single source). Local state đã được bỏ.
  const groups = useGymStore(userId, (s) => s.groups || []);
  const routines = useGymStore(userId, (s) => s.routines || []);
  const rules = useGymStore(userId, (s) => s.scheduleRules || []);
  const routineData = { routines, rules };
  const [groupName, setGroupName] = useState('');
  const [routineName, setRoutineName] = useState('');
  const [selectedGroups, setSelectedGroups] = useState([]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const load = React.useCallback(async () => {
    await syncPendingBeforeCatalogLoad(userId);
    // api() success sẽ tự ghi vào gymStore via routeGetResponseToStore
    api(`/api/groups?userId=${userId}`).catch(() => {});
    api(`/api/routines?userId=${userId}`).catch(() => {});
  }, [userId]);
  useEffect(() => { load(); }, [load]);
  // Stub setters cho backward compat trong handlers cũ
  const setGroups = () => load();
  const setRoutineData = () => load();

  const createGroup = async () => {
    if (!groupName.trim()) return;
    await api('/api/groups', { method: 'POST', body: JSON.stringify({ userId, name: groupName }) });
    setGroupName('');
    load();
  };
  const reorderGroupExercises = async (groupId, fromExerciseId, toExerciseId) => {
    if (!fromExerciseId || !toExerciseId || fromExerciseId === toExerciseId) return;
    const group = groups.find((item) => item.id === groupId);
    if (!group) return;
    const next = [...group.exercises];
    const fromIndex = next.findIndex((exercise) => exercise.id === fromExerciseId);
    const toIndex = next.findIndex((exercise) => exercise.id === toExerciseId);
    if (fromIndex < 0 || toIndex < 0) return;
    const reordered = arrayMove(next, fromIndex, toIndex);
    setGroups((old) => old.map((item) => item.id === groupId ? { ...item, exercises: reordered } : item));
    await api(`/api/groups/${groupId}/exercises-order`, { method: 'PATCH', body: JSON.stringify({ userId, exerciseIds: reordered.map((exercise) => exercise.id) }) });
    load();
  };
  const handleExerciseDragEnd = ({ active, over }, groupId) => {
    if (!over || active.id === over.id) return;
    reorderGroupExercises(groupId, active.id, over.id);
  };
  const removeExercise = async (groupId, exerciseId) => {
    // Lấy URL trước khi xóa
    const exercise = groups.flatMap((g) => g.exercises).find((e) => e.id === exerciseId);
    await api(`/api/groups/${groupId}/exercises/${exerciseId}?userId=${userId}`, { method: 'DELETE' });
    const updated = await api(`/api/groups?userId=${userId}`);
    setGroups(updated);
    // Xóa cache nếu bài này không còn trong group nào nữa
    const stillExists = updated.flatMap((g) => g.exercises).some((e) => e.id === exerciseId);
    if (!stillExists && exercise && 'caches' in window) {
      const cache = await caches.open(MEDIA_CACHE);
      const urls = [exercise.imageUrl, exercise.gifUrl].filter(Boolean);
      for (const url of urls) { try { await cache.delete(url); } catch {} }
    }
  };
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [editingGroupName, setEditingGroupName] = useState('');
  const [editingRoutineId, setEditingRoutineId] = useState(null);
  const [editingRoutineName, setEditingRoutineName] = useState('');

  const startEditGroup = (group) => { setEditingGroupId(group.id); setEditingGroupName(group.name); };
  const saveEditGroup = async (groupId) => {
    if (!editingGroupName.trim()) return;
    await api(`/api/groups/${groupId}`, { method: 'PATCH', body: JSON.stringify({ userId, name: editingGroupName.trim() }) });
    setEditingGroupId(null);
    load();
  };
  const startEditRoutine = (routine) => { setEditingRoutineId(routine.id); setEditingRoutineName(routine.name); };
  const saveEditRoutine = async (routineId) => {
    if (!editingRoutineName.trim()) return;
    await api(`/api/routines/${routineId}`, { method: 'PATCH', body: JSON.stringify({ userId, name: editingRoutineName.trim() }) });
    setEditingRoutineId(null);
    load();
  };

  const deleteGroup = async (groupId) => {
    if (!(await dialog.confirm(t('builder_confirm_delete_group_msg')))) return;
    await api(`/api/groups/${groupId}`, { method: 'DELETE', body: JSON.stringify({ userId }) });
    load();
    onChanged();
  };
  const startGroup = async (group) => {
    const session = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ userId, groupId: group.id, scheduleMode: 'FREE' }) });
    onStart({ sessionId: session.id });
  };
  const createRoutine = async () => {
    if (!routineName.trim() || selectedGroups.length === 0) return;
    await api('/api/routines', { method: 'POST', body: JSON.stringify({ userId, name: routineName, groupIds: selectedGroups }) });
    setRoutineName('');
    setSelectedGroups([]);
    load();
  };
  const startRoutine = async (routine) => {
    const session = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ userId, routineId: routine.id, scheduleMode: 'FREE' }) });
    onStart({ sessionId: session.id });
  };
  const deleteRoutine = async (routineId) => {
    if (!(await dialog.confirm(t('builder_confirm_delete_routine_msg')))) return;
    await api(`/api/routines/${routineId}`, { method: 'DELETE', body: JSON.stringify({ userId }) });
    load();
    onChanged();
  };
  const addRoutineGroup = async (routineId, groupId) => {
    if (!groupId) return;
    await api(`/api/routines/${routineId}/groups`, { method: 'POST', body: JSON.stringify({ userId, groupId: Number(groupId) }) });
    load();
    onChanged();
  };
  const removeRoutineGroup = async (routineId, groupId) => {
    await api(`/api/routines/${routineId}/groups/${groupId}?userId=${userId}`, { method: 'DELETE' });
    load();
    onChanged();
  };
  const reorderRoutineGroups = async (routineId, fromGroupId, toGroupId) => {
    if (!fromGroupId || !toGroupId || fromGroupId === toGroupId) return;
    const routine = routineData.routines.find((item) => item.id === routineId);
    if (!routine) return;
    const next = [...routine.groups];
    const fromIndex = next.findIndex((group) => group.id === fromGroupId);
    const toIndex = next.findIndex((group) => group.id === toGroupId);
    if (fromIndex < 0 || toIndex < 0) return;
    const reordered = arrayMove(next, fromIndex, toIndex);
    setRoutineData((old) => ({
      ...old,
      routines: old.routines.map((item) => item.id === routineId ? { ...item, groups: reordered } : item)
    }));
    await api(`/api/routines/${routineId}/groups-order`, { method: 'PATCH', body: JSON.stringify({ userId, groupIds: reordered.map((group) => group.id) }) });
    load();
    onChanged();
  };
  const handleRoutineGroupDragEnd = ({ active, over }, routineId) => {
    if (!over || active.id === over.id) return;
    reorderRoutineGroups(routineId, Number(active.id), Number(over.id));
  };
  const setMode = async (mode) => {
    await api('/api/settings', { method: 'PATCH', body: JSON.stringify({ userId, scheduleMode: mode }) });
    onChanged();
  };
  const assignRule = async (routineId, mode, value) => {
    await api('/api/schedule-rules', {
      method: 'POST',
      body: JSON.stringify({ userId, routineId, mode, dayOfWeek: mode === 'FIXED' ? Number(value) : undefined, orderIndex: mode === 'ROLLING' ? Number(value) : undefined })
    });
    load();
    onChanged();
  };
  const deleteRule = async (ruleId) => {
    await api(`/api/schedule-rules/${ruleId}?userId=${userId}`, { method: 'DELETE' });
    load();
    onChanged();
  };

  return (
    <section className="space-y-5">
      <div className="builder-section">
        <h2 className="section-title">{t('schedule_title')}</h2>
        <p className="mb-2 text-sm text-teal-900">{t('schedule_hint')}</p>
        <div className="grid gap-2">
          {['FIXED', 'ROLLING'].map((mode) => (
            <label key={mode} className={`mode-btn flex items-center gap-3 ${boot.settings.schedule_mode === mode ? 'active' : ''}`}>
              <input
                type="radio"
                name="scheduleMode"
                checked={boot.settings.schedule_mode === mode}
                onChange={() => setMode(mode)}
              />
              <span>{getModeLabels(t)[mode]}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="builder-section">
        <h2 className="section-title">{t('builder_groups_title')}</h2>
        <div className="flex gap-2">
          <input className="input" value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder={t('builder_group_placeholder')} />
          <button className="icon-btn" onClick={createGroup}><Plus /></button>
        </div>
      </div>

      <div className="builder-section">
        <h2 className="section-title">{t('builder_groups_title')}</h2>
        {groups.map((group) => (
          <div key={group.id} className="panel">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {editingGroupId === group.id ? (
                <div className="flex flex-1 gap-2">
                  <input className="input flex-1 py-1 text-sm" autoFocus value={editingGroupName} onChange={(e) => setEditingGroupName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveEditGroup(group.id); if (e.key === 'Escape') setEditingGroupId(null); }} placeholder={t('builder_rename_placeholder')} />
                  <button className="small-action" onClick={() => saveEditGroup(group.id)}><Check size={15} /></button>
                  <button className="icon-btn" onClick={() => setEditingGroupId(null)}><X size={15} /></button>
                </div>
              ) : (
                <div className="flex items-center gap-2 font-bold">
                  {group.name} · {t('builder_exercises_count', group.exercises.length)}
                  {group.syncStatus === 'pending' && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700" title="Đang chờ đồng bộ">⟲</span>}
                  <button className="icon-btn" title={t('builder_rename_group')} onClick={() => startEditGroup(group)}><Pencil size={14} /></button>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button className="icon-btn" title={t('start_exercise')} onClick={() => startGroup(group)}><Play size={16} /></button>
                <button className="icon-btn text-red-500" title={t('delete')} onClick={() => deleteGroup(group.id)}><Trash2 size={16} /></button>
              </div>
            </div>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-bold text-teal-950">{t('builder_exercise_list')}</summary>
              <div className="mt-3 space-y-2">
                {group.exercises.length === 0 && <p className="text-sm text-slate-600">{t('builder_no_exercises')}</p>}
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => handleExerciseDragEnd(event, group.id)}>
                  <SortableContext items={group.exercises.map((exercise) => exercise.id)} strategy={verticalListSortingStrategy}>
                    {group.exercises.map((exercise) => (
                      <SortableExerciseRow key={exercise.id} exercise={exercise} onRemove={(exerciseId) => removeExercise(group.id, exerciseId)} />
                    ))}
                  </SortableContext>
                </DndContext>
              </div>
            </details>
          </div>
        ))}
      </div>

      <div className="builder-section">
        <h2 className="section-title">{t('builder_routines_title')}</h2>
        <input className="input" value={routineName} onChange={(e) => setRoutineName(e.target.value)} placeholder={t('builder_routine_placeholder')} />
        <div className="mt-3 grid gap-2">
          {groups.map((group) => (
            <label key={group.id} className="flex items-center gap-3 rounded-md bg-slate-50 p-3">
              <input type="checkbox" checked={selectedGroups.includes(group.id)} onChange={(e) => setSelectedGroups((prev) => e.target.checked ? [...prev, group.id] : prev.filter((id) => id !== group.id))} />
              <span className="min-w-0 flex-1">{group.name} <small className="text-teal-950">({t('builder_exercises_count', group.exercises.length)})</small></span>
              <div className="flex -space-x-2">
                {group.exercises.slice(0, 4).map((exercise) => (
                  <img key={exercise.id} src={exerciseAutoMediaUrl(exercise)} title={exercise.name} className="h-8 w-8 rounded-full border-2 border-white bg-white object-contain" />
                ))}
              </div>
            </label>
          ))}
        </div>
        <button className="primary mt-3" onClick={createRoutine}>{t('builder_routine_add')}</button>
      </div>

      <div className="builder-section">
        <h2 className="section-title">{t('builder_routines_title')}</h2>
        <div className="mb-4 grid gap-3">
          {routineData.routines.length === 0 && <p className="text-sm text-slate-600">{t('builder_no_routines')}</p>}
          {routineData.routines.map((routine) => {
            const availableGroups = groups.filter((group) => !routine.groups.some((item) => item.id === group.id));
            return (
              <article key={routine.id} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-start gap-3">
                  <img src={exerciseAutoMediaUrl(routine.exercises[0])} className="h-12 w-12 shrink-0 rounded-md bg-slate-50 object-contain ring-1 ring-slate-200" />
                  <div className="min-w-0 flex-1">
                    {editingRoutineId === routine.id ? (
                      <div className="flex gap-2">
                        <input className="input flex-1 py-1 text-sm" autoFocus value={editingRoutineName} onChange={(e) => setEditingRoutineName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveEditRoutine(routine.id); if (e.key === 'Escape') setEditingRoutineId(null); }} placeholder={t('builder_rename_placeholder')} />
                        <button className="small-action" onClick={() => saveEditRoutine(routine.id)}><Check size={15} /></button>
                        <button className="icon-btn" onClick={() => setEditingRoutineId(null)}><X size={15} /></button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <h3 className="font-bold">{routine.name}</h3>
                        <button className="icon-btn" title={t('builder_rename_routine')} onClick={() => startEditRoutine(routine)}><Pencil size={14} /></button>
                      </div>
                    )}
                    <p className="text-sm text-slate-500">{routine.groups.length} group · {t('builder_exercises_count', routine.exercises.length)}</p>
                  </div>
                  <button className="icon-btn" title={t('start_exercise')} onClick={() => startRoutine(routine)}><Play size={16} /></button>
                  <button className="icon-btn text-red-500" title={t('delete')} onClick={() => deleteRoutine(routine.id)}><Trash2 size={16} /></button>
                </div>
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-bold text-teal-950">{t('builder_group_list')}</summary>
                  <div className="mt-3 grid gap-2">
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => handleRoutineGroupDragEnd(event, routine.id)}>
                    <SortableContext items={routine.groups.map((group) => group.id)} strategy={verticalListSortingStrategy}>
                      {routine.groups.map((group) => (
                        <SortableRoutineGroupRow key={group.id} group={group} onRemove={(groupId) => removeRoutineGroup(routine.id, groupId)} />
                      ))}
                    </SortableContext>
                  </DndContext>
                  </div>
                </details>
                <select className="input mt-3 py-2 text-sm" value="" onChange={(event) => addRoutineGroup(routine.id, event.target.value)}>
                  <option value="">{t('builder_select_groups')}</option>
                  {availableGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
              </article>
            );
          })}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <ScheduleAssignPanel
            title={t('schedule_fixed_panel_title')}
            description={t('schedule_fixed_panel_desc')}
            mode="FIXED"
            routines={routineData.routines}
            rules={routineData.rules.filter((rule) => rule.mode === 'FIXED')}
            onAssign={assignRule}
            onDelete={deleteRule}
            onStart={startRoutine}
          />
          <ScheduleAssignPanel
            title={t('schedule_rolling_panel_title')}
            description={t('schedule_rolling_panel_desc')}
            mode="ROLLING"
            routines={routineData.routines}
            rules={routineData.rules.filter((rule) => rule.mode === 'ROLLING')}
            onAssign={assignRule}
            onDelete={deleteRule}
            onStart={startRoutine}
          />
        </div>
      </div>
    </section>
  );
}

function ScheduleAssignPanel({ title, description, mode, routines, rules, onAssign, onDelete, onStart }) {
  const t = useLang();
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-2">
        <strong>{title}</strong>
      </div>
      <p className="mt-1 text-sm text-slate-600">{description}</p>
      <div className="mt-3 space-y-3">
        {routines.map((routine) => (
          <article key={`${mode}-${routine.id}`} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-center gap-3">
              <img src={exerciseAutoMediaUrl(routine.exercises[0])} className="h-11 w-11 rounded-md bg-slate-50 object-contain ring-1 ring-slate-200" />
              <div className="min-w-0 flex-1">
                <h3 className="font-bold">{routine.name}</h3>
                <p className="text-xs text-slate-500">{t('builder_exercises_count', routine.exercises.length)} · {routine.groups.map((g) => g.name).join(' + ')}</p>
              </div>
            </div>
            <select className="input mt-3" onChange={(e) => e.target.value && onAssign(routine.id, mode, e.target.value)}>
              <option value="">{mode === 'FIXED' ? t('schedule_assign_fixed') : t('schedule_assign_rolling')}</option>
              {mode === 'FIXED'
                ? t('days').map((d, i) => <option key={d} value={i}>{d}</option>)
                : [1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{t('schedule_session_n', n)}</option>)}
            </select>
          </article>
        ))}
      </div>
      <ScheduleRules rules={rules} onDelete={onDelete} />
    </div>
  );
}

function ScheduleRules({ rules, onDelete }) {
  const t = useLang();
  if (!rules.length) return <p className="text-sm text-slate-600">{t('schedule_no_rules')}</p>;
  return (
    <div className="panel">
      <h3 className="mb-2 font-bold">{t('schedule_active_rules')}</h3>
      {rules.map((rule) => (
        <div key={rule.id} className="flex items-center justify-between gap-3 border-t border-slate-200 py-2 first:border-t-0">
          <p className="text-sm text-slate-700">
            {rule.mode === 'FIXED' ? t('days')[rule.day_of_week] : t('schedule_session_n', rule.order_index)} · {rule.routine_name}
          </p>
          <button className="tiny-btn" onClick={() => onDelete(rule.id)}><Trash2 size={16} /></button>
        </div>
      ))}
    </div>
  );
}

function WorkoutSummary({ summary, settings, onClose }) {
  const t = useLang();
  const { detail, sessionName } = summary;
  const { summary: s, exercises, session } = detail;
  const totalVolume = s?.totalVolume || 0;
  const volumeDisplay = totalVolume >= 1000 ? `${(totalVolume / 1000).toFixed(1)}k` : totalVolume;
  const grade = s?.improvedCount >= Math.ceil((s?.exerciseCount || 1) * 0.6) ? 'great' : s?.improvedCount > 0 ? 'ok' : 'start';
  const gradeText = { great: t('summary_great'), ok: t('summary_ok'), start: t('summary_start') }[grade];
  const gradeGradient = { great: 'linear-gradient(135deg,#6366f1,#a855f7,#ec4899)', ok: 'linear-gradient(135deg,#f05a28,#f59e0b)', start: 'linear-gradient(135deg,#0ea5e9,#14b8a6)' }[grade];
  const shareCardRef = React.useRef(null);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [shareImageUrl, setShareImageUrl] = useState(null);

  const generateShareImage = async () => {
    if (!shareCardRef.current) return null;
    setGeneratingImage(true);
    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(shareCardRef.current, {
        backgroundColor: null,
        scale: 2,
        useCORS: true,
        allowTaint: true,
        logging: false
      });
      const url = canvas.toDataURL('image/png');
      setShareImageUrl(url);
      return { canvas, url };
    } finally {
      setGeneratingImage(false);
    }
  };

  const handleDownload = async () => {
    const result = shareImageUrl ? { url: shareImageUrl } : await generateShareImage();
    if (!result) return;
    const a = document.createElement('a');
    a.href = result.url;
    a.download = `gym-${sessionName.replace(/[^a-zA-Z0-9]/g, '-')}-${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
  };

  const handleShare = async () => {
    const result = await generateShareImage();
    if (!result) return;
    if (navigator.share && navigator.canShare) {
      try {
        result.canvas.toBlob(async (blob) => {
          const file = new File([blob], 'workout.png', { type: 'image/png' });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: sessionName });
            return;
          }
          // Fallback: share text
          await navigator.share({ title: sessionName, text: `💪 ${sessionName} — ${session?.duration_minutes} min · ${s?.totalSets} sets` });
        });
      } catch {}
    } else {
      // Desktop: download
      handleDownload();
    }
  };

  return (
    <section className="space-y-4 pb-8">
      {/* Share image preview */}
      {shareImageUrl && (
        <div className="rounded-2xl overflow-hidden shadow-soft">
          <img src={shareImageUrl} alt="Share preview" className="w-full" />
          <div className="flex gap-2 p-3 bg-white border border-stone-200 rounded-b-2xl">
            <button className="primary flex-1 flex items-center justify-center gap-2" onClick={handleDownload}>
              ⬇ {t('summary_download')}
            </button>
            <button className="ghost-btn" onClick={() => setShareImageUrl(null)}>✕</button>
          </div>
        </div>
      )}

      {/* Hidden share card — fixed size 400×520px, captured for PNG */}
      <div style={{ position: 'fixed', left: '-9999px', top: 0, width: 400, pointerEvents: 'none' }}>
        <div ref={shareCardRef} style={{ width: 400, fontFamily: 'Inter, system-ui, sans-serif', borderRadius: 20, overflow: 'hidden', background: gradeGradient }}>
          <div style={{ padding: 28, color: '#fff' }}>
            {/* Header */}
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, opacity: 0.75, marginBottom: 6 }}>💪 Workout Summary</div>
            <div style={{ fontSize: 22, fontWeight: 900, lineHeight: 1.2, marginBottom: 4 }}>{sessionName}</div>
            <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 20 }}>{gradeText}</div>
            {/* Stats */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              {[
                { label: 'Duration', value: `${session?.duration_minutes}`, unit: 'min' },
                { label: 'Exercises', value: s?.exerciseCount, unit: '' },
                { label: 'Sets', value: s?.totalSets, unit: '' },
                { label: 'Volume', value: volumeDisplay, unit: 'kg' },
              ].map((stat) => (
                <div key={stat.label} style={{ flex: 1, background: 'rgba(255,255,255,0.18)', borderRadius: 12, padding: '10px 6px', textAlign: 'center' }}>
                  <div style={{ fontSize: 20, fontWeight: 900, lineHeight: 1 }}>{stat.value}<span style={{ fontSize: 10, opacity: 0.75 }}> {stat.unit}</span></div>
                  <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>{stat.label}</div>
                </div>
              ))}
            </div>
            {/* Top exercises — max 5 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(exercises || []).slice(0, 5).map((exercise) => {
                const improved = exercise.volume > exercise.previousVolume || exercise.maxWeight > exercise.previousMaxWeight;
                return (
                  <div key={exercise.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,0.15)', borderRadius: 10, padding: '8px 10px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 }}>{exercise.name}</div>
                      <div style={{ fontSize: 11, opacity: 0.75 }}>{exercise.sets.length} sets · max {exercise.maxWeight} kg</div>
                    </div>
                    {improved && <div style={{ fontSize: 11, fontWeight: 800, background: 'rgba(255,255,255,0.25)', borderRadius: 6, padding: '2px 7px' }}>▲ PR</div>}
                  </div>
                );
              })}
              {(exercises || []).length > 5 && (
                <div style={{ textAlign: 'center', fontSize: 12, opacity: 0.7, padding: '4px 0' }}>+{exercises.length - 5} more exercises</div>
              )}
            </div>
            {/* Footer */}
            <div style={{ marginTop: 18, textAlign: 'center', fontSize: 11, opacity: 0.6 }}>Tracked with Gym App</div>
          </div>
        </div>
      </div>

      {/* Header gradient card — displayed in app */}
      <div className="rounded-2xl p-6 text-white" style={{ background: gradeGradient }}>
        <div className="mb-2 flex items-center gap-2">
          <Trophy size={22} />
          <span className="text-sm font-bold uppercase tracking-wide opacity-80">{t('summary_title')}</span>
        </div>
        <h2 className="text-2xl font-black leading-tight">{sessionName}</h2>
        <p className="mt-1 text-sm opacity-80">{gradeText}</p>

        {/* Stats row */}
        <div className="mt-5 grid grid-cols-4 gap-2">
          {[
            { label: t('summary_duration'), value: `${session?.duration_minutes}`, unit: 'min' },
            { label: t('summary_exercises'), value: s?.exerciseCount, unit: '' },
            { label: t('summary_sets'), value: s?.totalSets, unit: '' },
            { label: t('summary_volume'), value: volumeDisplay, unit: 'kg' },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl bg-white/15 p-3 text-center">
              <div className="text-xl font-black">{stat.value}<span className="text-xs font-bold opacity-70"> {stat.unit}</span></div>
              <div className="mt-0.5 text-[11px] opacity-70">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Improved badge */}
        {s?.exerciseCount > 0 && (
          <div className="mt-3 flex items-center gap-1.5 rounded-xl bg-white/20 px-3 py-2 text-sm font-bold">
            <TrendingUp size={15} />
            {t('summary_improved', s.improvedCount, s.exerciseCount)}
          </div>
        )}
      </div>

      {/* Exercise list */}
      <div className="space-y-2">
        {exercises?.map((exercise) => {
          const improved = exercise.volume > exercise.previousVolume || exercise.maxWeight > exercise.previousMaxWeight;
          return (
            <div key={exercise.id} className={`flex items-center gap-3 rounded-xl border p-3 ${improved ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
              {exercise.imageUrl
                ? <img src={exercise.imageUrl} className="h-10 w-10 shrink-0 rounded bg-white object-contain" />
                : <span className="grid h-10 w-10 shrink-0 place-items-center rounded bg-slate-100 text-xl">🏋️</span>}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{exercise.name}</p>
                <p className="text-xs text-slate-500">{exercise.sets.length} sets · max {exercise.maxWeight} kg · vol {exercise.volume}</p>
                {improved && <p className="text-xs font-bold text-emerald-600">▲ {exercise.volume > exercise.previousVolume ? `vol +${exercise.volume - exercise.previousVolume}` : ''}{exercise.maxWeight > exercise.previousMaxWeight ? ` max +${exercise.maxWeight - exercise.previousMaxWeight}kg` : ''}</p>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button className="ghost-btn flex-1 flex items-center justify-center gap-2" disabled={generatingImage} onClick={handleShare}>
          <Share2 size={16} /> {generatingImage ? '...' : t('summary_share')}
        </button>
        <button className="ghost-btn flex items-center justify-center gap-1 px-3" disabled={generatingImage} onClick={handleDownload} title={t('summary_download')}>
          ⬇
        </button>
        <button className="primary flex-1" onClick={onClose}>{t('summary_close')}</button>
      </div>
    </section>
  );
}

function WorkoutLogger({ userId, workout, settings, onClose }) {
  const t = useLang();
  const dialog = useAppDialog();
  const { online: isOnline } = useServerStatus();
  const [data, setData] = useState(null);
  const [summary, setSummary] = useState(null);
  const savedWorkout = useMemo(() => JSON.parse(localStorage.getItem(`familyGymWorkout:${userId}`) || 'null'), [userId, workout.sessionId]);
  const restoreSaved = savedWorkout?.sessionId === workout.sessionId;
  const [index, setIndex] = useState(() => Number(workout.initialIndex ?? (restoreSaved ? savedWorkout.index : 0) ?? 0));
  const [view, setView] = useState(() => workout.initialView || (restoreSaved ? savedWorkout.view : 'list') || 'list');
  const [paused, setPaused] = useState(false);
  const [sets, setSets] = useState([]);
  const [previousSets, setPreviousSets] = useState([]);
  const [note, setNote] = useState('');
  const [targetSets, setTargetSets] = useState(3);
  const [weightMode, setWeightMode] = useState('KG');
  const [manualWeight, setManualWeight] = useState('');
  const [timer, setTimer] = useState(0);
  const timerEndAt = React.useRef(0); // timestamp khi timer hết
  const [swipeDx, setSwipeDx] = useState(0);
  const [slideDir, setSlideDir] = useState(null); // 'out-left' | 'out-right' | 'in-left' | 'in-right' | null
  const swipeStartX = React.useRef(0);
  const swipeContainerRef = React.useRef(null);

  // Gắn touchmove với passive:false để preventDefault hoạt động
  useEffect(() => {
    const el = swipeContainerRef.current;
    if (!el) return;
    const handleMove = (e) => {
      const dx = e.touches[0].clientX - swipeStartX.current;
      if (Math.abs(dx) > 10) e.preventDefault();
    };
    el.addEventListener('touchmove', handleMove, { passive: false });
    return () => el.removeEventListener('touchmove', handleMove);
  }, []);
  const previousTimer = React.useRef(0);
  const defaultWeightUnit = settings?.default_weight_unit || 'kg';
  const weightStepsKgOptions = useMemo(() => parseWeightSteps(settings?.weight_steps_kg, defaultKgOptions, 'kg'), [settings?.weight_steps_kg]);
  const weightStepsLbOptions = useMemo(() => parseWeightSteps(settings?.weight_steps_lb, defaultLbOptions, 'lb'), [settings?.weight_steps_lb]);
  const manualUnitLabel = defaultWeightUnit === 'lb' ? 'Lb' : 'Kg';

  useEffect(() => {
    api(`/api/sessions/${workout.sessionId}?userId=${userId}`)
      .then((payload) => {
        if (payload?.session?.status === 'DELETED' || !payload?.exercises?.length) {
          setData(findOfflineSessionPayload(userId, workout.sessionId) || payload);
          return;
        }
        setData(payload);
      })
      .catch(() => setData(findOfflineSessionPayload(userId, workout.sessionId)));
  }, [workout.sessionId, userId]);

  // Live sync: reload session data khi máy khác cập nhật
  useLiveSync(userId, () => {
    api(`/api/sessions/${workout.sessionId}?userId=${userId}`).then(setData).catch(() => {});
  });

  // Auto-sync offline queue khi có mạng trở lại
  useEffect(() => {
    if (!isOnline) return;
    flushOfflineQueue(userId).then((synced) => {
      if (synced > 0) dialog.alert(t('offline_synced', synced));
    });
  }, [isOnline]);
  const exercise = data?.exercises?.[index];
  useEffect(() => {
    if (!workout.sessionId) return;
    localStorage.setItem(`familyGymWorkout:${userId}`, JSON.stringify({ sessionId: workout.sessionId, index, view }));
  }, [userId, workout.sessionId, index, view]);
  useEffect(() => {
    if (!exercise) return;
    api(`/api/sessions/${workout.sessionId}/exercises/${exercise.id}/sets?userId=${userId}`).then((payload) => {
      setPreviousSets(payload.previous || []);
      setNote(payload.note || '');
      setWeightMode(payload.weightMode || 'KG');
      setManualWeight(payload.manualWeightKg ?? '');
      const target = Math.max(1, Number(payload.targetSets || 3));
      setTargetSets(target);
      const current = payload.current || [];
      const buildDraftSet = (setIndex) => {
        const previous = payload.previous?.[setIndex - 1];
        const lastCurrent = current[current.length - 1];
        const preferredManual = payload.weightMode === 'MANUAL' && payload.manualWeightKg !== null ? Number(payload.manualWeightKg) : null;
        const defaultReps = payload.defaultReps ?? 12;
        const defaultWeightKg = payload.defaultWeightKg ?? null;
        const overloadStepKg = defaultWeightUnit === 'lb' ? lbToKg(5) : 2.5;
        const suggestedPreviousWeight = settings?.progressive_overload && previous?.reps >= defaultReps
          ? Number((Number(previous.weight_kg || 0) + overloadStepKg).toFixed(2))
          : previous?.weight_kg;
        return {
          setIndex,
          weightKg: preferredManual ?? defaultWeightKg ?? suggestedPreviousWeight ?? lastCurrent?.weight_kg ?? 20,
          reps: previous?.reps ?? lastCurrent?.reps ?? defaultReps,
          done: false
        };
      };
      if (current.length) {
        const doneSets = current.map((row) => ({ id: row.id, setIndex: row.set_index, weightKg: row.weight_kg, reps: row.reps, done: true }));
        const total = Math.max(target, doneSets.length);
        const drafts = Array.from({ length: Math.max(0, total - doneSets.length) }, (_, offset) => buildDraftSet(doneSets.length + offset + 1));
        setSets([...doneSets, ...drafts]);
      } else {
        const seed = Array.from({ length: target }, (_, index) => buildDraftSet(index + 1));
        setSets(seed);
      }
    });
  }, [exercise?.id, userId, workout.sessionId]);
  // startTimer: set thời điểm kết thúc theo thời gian thực
  const startTimer = React.useCallback((seconds) => {
    timerEndAt.current = Date.now() + seconds * 1000;
    setTimer(seconds);
  }, []);

  useEffect(() => {
    if (!timerEndAt.current) return;
    const id = setInterval(() => {
      const remaining = Math.round((timerEndAt.current - Date.now()) / 1000);
      const clamped = Math.max(0, remaining);
      setTimer(clamped);
      if (clamped === 0) timerEndAt.current = 0;
    }, 500);
    return () => clearInterval(id);
  }, [timerEndAt.current > 0 ? timerEndAt.current : 0]);
  useEffect(() => {
    if (previousTimer.current > 0 && timer === 0) {
      if (settings?.vibrate_rest_done && navigator.vibrate) navigator.vibrate([180, 80, 180]);
      if (settings?.sound_rest_done) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
          const audio = new AudioContextClass();
          const oscillator = audio.createOscillator();
          const gain = audio.createGain();
          oscillator.frequency.value = 880;
          gain.gain.value = 0.08;
          oscillator.connect(gain);
          gain.connect(audio.destination);
          oscillator.start();
          oscillator.stop(audio.currentTime + 0.18);
        }
      }
    }
    previousTimer.current = timer;
  }, [timer, settings?.sound_rest_done, settings?.vibrate_rest_done]);

  if (!data) {
    // Sau 1s loading → thử fallback cache offline
    const offlineFallback = findOfflineSessionPayload(userId, workout.sessionId);
    if (offlineFallback) {
      setTimeout(() => setData(offlineFallback), 0);
    }
    return (
      <div className="panel">
        <p>{t('loading')}</p>
        {!isOnline && (
          <p className="mt-2 text-sm text-amber-700">
            ⚠ Offline — đang tải từ cache, vui lòng đợi...
          </p>
        )}
        <button className="ghost-btn mt-3" onClick={onClose}>{t('workout_nav_exit')}</button>
      </div>
    );
  }
  if (!exercise) {
    const closeEmptySession = async () => {
      await api(`/api/sessions/${workout.sessionId}`, { method: 'DELETE', body: JSON.stringify({ userId }) });
      localStorage.removeItem(`familyGymWorkout:${userId}`);
      onClose();
    };
    return (
      <div className="panel space-y-4">
        <div>
          <h2 className="section-title">{t('workout_empty_routine')}</h2>
          <p className="text-sm text-slate-600">{t('workout_empty_desc')}</p>
        </div>
        <button className="ghost-btn w-full" onClick={closeEmptySession}>{t('workout_exit_btn')}</button>
      </div>
    );
  }

  const openExercise = (nextIndex) => {
    const goNext = nextIndex > index;
    setSlideDir(goNext ? 'out-left' : 'out-right');
    setTimeout(() => {
      setIndex(nextIndex);
      setView('exercise');
      setSlideDir(goNext ? 'in-right' : 'in-left');
      setTimeout(() => setSlideDir(null), 220);
    }, 150);
  };
  const updateSet = async (setIndex, patch) => {
    const current = sets.find((set) => set.setIndex === setIndex);
    const updatedSet = current ? { ...current, ...patch } : null;
    setSets((old) => old.map((set) => set.setIndex === setIndex ? { ...set, ...patch } : set));
    const preferencePatch = {};
    if (patch.reps !== undefined) preferencePatch.defaultReps = patch.reps;
    if (patch.weightKg !== undefined) preferencePatch.defaultWeightKg = patch.weightKg;
    if (Object.keys(preferencePatch).length) {
      await api(`/api/exercises/${exercise.id}/preferences`, { method: 'PUT', body: JSON.stringify({ userId, targetSets, weightMode, ...preferencePatch }) });
    }
    if (updatedSet?.done && updatedSet.id) {
      await api(`/api/logs/${updatedSet.id}`, { method: 'PATCH', body: JSON.stringify({ userId, weightKg: updatedSet.weightKg, weightUnit: currentWeightUnit(), reps: updatedSet.reps }) });
    }
  };
  const currentWeightUnit = () => weightMode === 'LB' || (weightMode === 'MANUAL' && defaultWeightUnit === 'lb') ? 'lb' : 'kg';
  const saveTargetSets = async (count) => {
    const nextCount = Math.max(1, Math.min(20, count));
    setTargetSets(nextCount);
    await api(`/api/exercises/${exercise.id}/preferences`, { method: 'PUT', body: JSON.stringify({ userId, targetSets: nextCount }) });
  };
  const refreshExerciseSets = async () => {
    const payload = await api(`/api/sessions/${workout.sessionId}/exercises/${exercise.id}/sets?userId=${userId}`);
    const target = payload.targetSets || targetSets || settings?.default_sets || 3;
    setPreviousSets(payload.previous || []);
    setNote(payload.note || '');
    setTargetSets(target);
    setDefaultReps(payload.defaultReps || settings?.default_reps || 12);
    setDefaultWeightKg(payload.defaultWeightKg ?? null);
    setWeightMode(payload.weightMode || 'KG');
    setManualWeight(payload.manualWeightKg == null ? '' : displayWeight(payload.manualWeightKg, defaultWeightUnit));
    const current = payload.current || [];
    const doneSets = current.map((row) => ({ id: row.id, setIndex: row.set_index, weightKg: row.weight_kg, reps: row.reps, done: true }));
    const total = Math.max(target, doneSets.length || 1);
    const lastDone = doneSets[doneSets.length - 1];
    const drafts = Array.from({ length: Math.max(0, total - doneSets.length) }, (_, offset) => ({
      setIndex: doneSets.length + offset + 1,
      weightKg: lastDone?.weightKg ?? payload.defaultWeightKg ?? 20,
      reps: payload.defaultReps ?? settings?.default_reps ?? 12,
      done: false
    }));
    setSets([...doneSets, ...drafts]);
    setData((currentData) => currentData ? {
      ...currentData,
      exercises: currentData.exercises.map((item) => (
        item.id === exercise.id ? { ...item, completedSets: doneSets.length } : item
      ))
    } : currentData);
  };
  const addSet = async () => {
    const lastSet = sets[sets.length - 1] || { weightKg: 20, reps: 8 };
    const nextCount = sets.length + 1;
    setSets((old) => [...old, { setIndex: nextCount, weightKg: lastSet.weightKg, reps: lastSet.reps, done: false }]);
    await saveTargetSets(nextCount);
  };
  const removeDraftSet = async (setIndex) => {
    const target = sets.find((set) => set.setIndex === setIndex);
    if (!target || target.done || sets.length <= 1) return;
    const nextSets = sets
      .filter((set) => set.setIndex !== setIndex)
      .map((set, index) => ({ ...set, setIndex: index + 1 }));
    setSets(nextSets);
    await saveTargetSets(nextSets.length);
  };
  const completeSet = async (set) => {
    // Untick: chỉ cho phép untick set done cuối cùng (ngược thứ tự)
    if (set.done) {
      const lastDone = [...sets].filter((s) => s.done).sort((a, b) => b.setIndex - a.setIndex)[0];
      if (!lastDone || lastDone.setIndex !== set.setIndex) return;
      // Không cho untick set đã lưu offline (chưa sync lên server)
      if (!set.id || String(set.id).startsWith('offline_')) return;
      // Optimistic update trước
      setSets((old) => old.map((s) => s.setIndex === set.setIndex ? { ...s, done: false, id: undefined } : s));
      try {
        await api(`/api/logs/${set.id}?userId=${userId}`, { method: 'DELETE' });
      } catch {
        // DELETE thất bại — revert về trạng thái từ DB
        await refreshExerciseSets().catch(() => {});
        return;
      }
      // DELETE thành công — đồng bộ lại từ DB
      await refreshExerciseSets().catch(() => {});
      return;
    }
    // Tick: bắt buộc theo thứ tự
    const prevUndone = sets.find((s) => !s.done && s.setIndex < set.setIndex);
    if (prevUndone) return;
    const weightUnit = currentWeightUnit();
    if (!isOnline) {
      // Offline: lưu queue, dùng temp ID
      const tempId = `offline_${Date.now()}`;
      addToOfflineQueue(userId, { type: 'log', sessionId: workout.sessionId, exerciseId: exercise.id, setIndex: set.setIndex, weightKg: set.weightKg, weightUnit, reps: set.reps });
      setSets((old) => old.map((item) => item.setIndex === set.setIndex ? { ...item, id: tempId, done: true } : item));
      setData((current) => current ? { ...current, exercises: current.exercises.map((item) => item.id === exercise.id ? { ...item, completedSets: Number(item.completedSets || 0) + 1 } : item) } : current);
      startTimer(Number(settings?.rest_seconds || 60));
      return;
    }
    let result;
    try {
      result = await api(`/api/sessions/${workout.sessionId}/logs`, { method: 'POST', body: JSON.stringify({ userId, exerciseId: exercise.id, weightKg: set.weightKg, weightUnit, reps: set.reps }) });
      await saveWeightPreference({ defaultReps: set.reps, defaultWeightKg: set.weightKg, weightMode });
    } catch (error) {
      if (await checkServerAvailable(1000)) throw error;
      const tempId = `offline_${Date.now()}`;
      addToOfflineQueue(userId, { type: 'log', sessionId: workout.sessionId, exerciseId: exercise.id, setIndex: set.setIndex, weightKg: set.weightKg, weightUnit, reps: set.reps });
      result = { id: tempId };
    }
    setSets((old) => old.map((item) => item.setIndex === set.setIndex ? { ...item, id: result.id, done: true } : item));
    setData((current) => current ? {
      ...current,
      exercises: current.exercises.map((item) => (
        item.id === exercise.id
          ? { ...item, completedSets: Number(item.completedSets || 0) + 1 }
          : item
      ))
    } : current);
    startTimer(Number(settings?.rest_seconds || 60));
  };
  const saveNote = async (value) => {
    setNote(value);
    await api(`/api/exercises/${exercise.id}/note`, { method: 'PUT', body: JSON.stringify({ userId, note: value }) });
  };
  const complete = async () => {
    const hasCompletedSet = data.exercises?.some((item) => {
      if (item.id === exercise.id) return sets.some((set) => set.done);
      return Number(item.completedSets || item.sets || 0) > 0;
    });
    if (!hasCompletedSet && !(await dialog.confirm(t('workout_confirm_end')))) return;
    // Offline: queue complete action
    if (!isOnline) {
      addToOfflineQueue(userId, { type: 'complete', sessionId: workout.sessionId });
      localStorage.removeItem(`familyGymWorkout:${userId}`);
      onClose();
      return;
    }
    // Flush offline queue trước khi complete để không mất set nào
    await flushOfflineQueue(userId).catch(() => {});
    try {
      await api(`/api/sessions/${workout.sessionId}/complete`, { method: 'POST', body: JSON.stringify({ userId }) });
    } catch (error) {
      if (await checkServerAvailable(1000)) throw error;
      addToOfflineQueue(userId, { type: 'complete', sessionId: workout.sessionId });
    }
    localStorage.removeItem(`familyGymWorkout:${userId}`);
    // Fetch detail cho summary card
    try {
      const detail = await api(`/api/sessions/${workout.sessionId}/detail?userId=${userId}`);
      setSummary({ detail, sessionName: data?.routine?.name || data?.group?.name || t('workout_session_title') });
    } catch {
      onClose();
    }
  };
  const saveWeightPreference = async (patch) => {
    await api(`/api/exercises/${exercise.id}/preferences`, { method: 'PUT', body: JSON.stringify({ userId, targetSets, ...patch }) });
  };
  const changeWeightMode = async (mode) => {
    setWeightMode(mode);
    if (mode === 'MANUAL' && manualWeight !== '' && Number.isFinite(Number(manualWeight))) {
      const manualKg = defaultWeightUnit === 'lb' ? lbToKg(manualWeight) : Number(manualWeight);
      setSets((old) => old.map((set) => set.done ? set : { ...set, weightKg: manualKg }));
    }
    await saveWeightPreference({ weightMode: mode });
  };
  const updateManualWeight = async (value) => {
    setManualWeight(value);
    const next = value === '' ? null : (defaultWeightUnit === 'lb' ? lbToKg(value) : Number(value));
    await saveWeightPreference({ weightMode: 'MANUAL', manualWeightKg: next });
  };
  const exitWorkout = async () => {
    const hasAnySet = data.exercises?.some((item) => {
      if (item.id === exercise.id) return sets.some((set) => set.done) || Number(item.completedSets || 0) > 0;
      return Number(item.completedSets || 0) > 0;
    });
    if (!hasAnySet) {
      await api(`/api/sessions/${workout.sessionId}`, { method: 'DELETE', body: JSON.stringify({ userId }) });
      localStorage.removeItem(`familyGymWorkout:${userId}`);
    }
    onClose();
  };
  const exerciseGroups = workoutExerciseGroups(data);

  // Hiển thị summary card sau khi hoàn thành
  if (summary) return <WorkoutSummary summary={summary} settings={settings} onClose={onClose} />;

  return (
    <section className="space-y-4 text-black">
      {!isOnline && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-800">
          <WifiOff size={15} /> {t('offline_badge')}
        </div>
      )}
      <div className="flex items-center gap-2">
        <button className="ghost-btn" onClick={view === 'exercise' ? () => setView('list') : exitWorkout}>
          {view === 'exercise' ? t('workout_nav_list') : t('workout_nav_exit')}
        </button>
        {view === 'exercise' && (
          <>
            <button
              className="ghost-btn px-3 py-3 text-lg font-bold"
              disabled={index === 0}
              onClick={() => openExercise(index - 1)}
              style={{opacity: index === 0 ? 0.3 : 1}}
            >‹</button>
            <span className="text-sm font-bold text-slate-600 min-w-[2.5rem] text-center whitespace-nowrap">
              {index + 1}/{data.exercises.length}
            </span>
            <button
              className="ghost-btn px-3 py-3 text-lg font-bold"
              disabled={index >= data.exercises.length - 1}
              onClick={() => openExercise(index + 1)}
              style={{opacity: index >= data.exercises.length - 1 ? 0.3 : 1}}
            >›</button>
          </>
        )}
      </div>

      {view === 'list' && (
        <div className="panel-green">
          <h1 className="text-2xl font-black">{t('workout_continue_heading')}</h1>
          <p className="mt-2 text-sm text-emerald-100">
            {t('workout_continue_desc', data.session?.started_at ? formatTime(data.session.started_at, settings) : null)}
          </p>
        </div>
      )}

      {view === 'list' ? (
        <div className="workout-card space-y-3">
          <h1 className="text-2xl font-black">{data.routine?.name || data.group?.name || t('workout_session_title')}</h1>
          <p className="text-sm text-slate-500">{t('workout_list_hint')}</p>
          <div className="space-y-4">
            {exerciseGroups.map((group) => (
              <div key={group.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 className="font-black text-slate-950">{group.name}</h2>
                  <span className="text-xs font-bold text-slate-500">{t('builder_exercises_count', group.exercises.length)}</span>
                </div>
                <div className="grid gap-2">
                  {group.exercises.map((item) => (
                    <button key={`${group.id}-${item.id}-${item.workoutIndex}`} className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left ${item.completedSets ? 'border-emerald-300 bg-emerald-50' : 'border-orange-200 bg-orange-50'}`} onClick={() => openExercise(item.workoutIndex)}>
                      {exerciseAutoMediaUrl(item) ? <img src={exerciseAutoMediaUrl(item)} className="h-14 w-14 rounded-md bg-slate-50 object-contain" /> : <span className="grid h-14 w-14 place-items-center rounded-md bg-white text-2xl">{item.customIcon || '🏋️'}</span>}
                      <div className="min-w-0 flex-1">
                        <p className="font-bold">{item.name}</p>
                        <p className={`text-sm font-semibold ${item.completedSets ? 'text-emerald-800' : 'text-orange-800'}`}>
                          {item.completedSets ? t('workout_set_done', item.completedSets) : t('workout_not_done')} · {item.target} · {item.equipment}
                        </p>
                      </div>
                      <span className={`rounded px-3 py-1 text-xs font-black ${item.completedSets ? 'bg-emerald-600 text-white' : 'bg-[#f05a28] text-white'}`}>
                        {item.completedSets ? t('workout_continue_btn') : t('workout_start_btn')}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <button className="primary" onClick={complete}>{t('workout_end_btn')}</button>
        </div>
      ) : (() => {
        const THRESHOLD = 80;
        const canPrev = index > 0;
        const canNext = index < data.exercises.length - 1;
        const progress = Math.min(1, Math.abs(swipeDx) / THRESHOLD);
        // Scale mũi tên: nhỏ → to theo lực kéo
        const arrowSize = 40 + progress * 40; // 40px → 80px
        const isLeft = swipeDx > 10;
        const isRight = swipeDx < -10;
        return (
        <div className="relative">
          {/* Hint thường trực - trái */}
          {canPrev && (
            <div className="pointer-events-none fixed left-3 z-[9998]"
              style={{ top: '50%', transform: 'translateY(-50%)', opacity: isLeft ? 0 : 0.10 }}>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800 text-xl font-black text-white">‹</div>
            </div>
          )}
          {/* Hint thường trực - phải */}
          {canNext && (
            <div className="pointer-events-none fixed right-3 z-[9998]"
              style={{ top: '50%', transform: 'translateY(-50%)', opacity: isRight ? 0 : 0.10 }}>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800 text-xl font-black text-white">›</div>
            </div>
          )}
          {/* Arrow trái - fixed giữa màn hình dọc, to dần theo lực kéo */}
          {canPrev && isLeft && (
            <div className="pointer-events-none fixed left-3 z-[9999]"
              style={{ top: '50%', transform: 'translateY(-50%)', transition: swipeDx === 0 ? 'all 0.2s ease' : 'none', opacity: progress }}>
              <div className="flex items-center justify-center rounded-full bg-slate-800 font-black text-white shadow-2xl"
                style={{ width: arrowSize, height: arrowSize, fontSize: arrowSize * 0.5 }}>‹</div>
            </div>
          )}
          {/* Arrow phải - fixed giữa màn hình dọc, to dần theo lực kéo */}
          {canNext && isRight && (
            <div className="pointer-events-none fixed right-3 z-[9999]"
              style={{ top: '50%', transform: 'translateY(-50%)', transition: swipeDx === 0 ? 'all 0.2s ease' : 'none', opacity: progress }}>
              <div className="flex items-center justify-center rounded-full bg-slate-800 font-black text-white shadow-2xl"
                style={{ width: arrowSize, height: arrowSize, fontSize: arrowSize * 0.5 }}>›</div>
            </div>
          )}
          <div
            ref={swipeContainerRef}
            className={`workout-card space-y-4 ${
              slideDir === 'out-left' ? 'slide-out-left' :
              slideDir === 'out-right' ? 'slide-out-right' :
              slideDir === 'in-right' ? 'slide-in-from-right' :
              slideDir === 'in-left' ? 'slide-in-from-left' : ''
            }`}
            onTouchStart={(e) => { setSwipeDx(0); swipeStartX.current = e.touches[0].clientX; }}
            onTouchMove={(e) => {
              const dx = e.touches[0].clientX - swipeStartX.current;
              if (!canPrev && dx > 0) return;
              if (!canNext && dx < 0) return;
              setSwipeDx(dx);
            }}
            onTouchEnd={() => {
              const dx = swipeDx;
              setSwipeDx(0);
              if (dx < -THRESHOLD && canNext) openExercise(index + 1);
              else if (dx > THRESHOLD && canPrev) openExercise(index - 1);
            }}
          >
          <div className="overflow-hidden rounded-xl bg-slate-50">
            {exerciseAutoMediaUrl(exercise) ? (
              <img
                src={paused || exercise.displayMedia === 'image' ? exerciseMediaUrl(exercise) : exerciseAutoMediaUrl(exercise)}
                alt={exercise.name}
                className="mx-auto h-[300px] max-h-[45vh] w-full max-w-xl object-contain md:h-[360px]"
                onError={(e) => {
                  const fallback = exercise.gifUrl && e.target.src !== exercise.gifUrl ? exercise.gifUrl
                    : (exercise.imageUrl && e.target.src !== exercise.imageUrl ? exercise.imageUrl : null);
                  if (fallback) e.target.src = fallback;
                  else e.target.style.display = 'none';
                }}
              />
            ) : (
              <div className="mx-auto grid h-[300px] max-h-[45vh] w-full max-w-xl place-items-center text-7xl md:h-[360px]">{exercise.customIcon || '🏋️'}</div>
            )}
          </div>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-black">{exerciseDisplayName(exercise, settings)}</h1>
              <p className="mt-1 text-sm text-slate-500">{t('workout_prev_lift')} {previousSets[0] ? `${previousSets[0].weight_kg} kg x ${previousSets[0].reps}` : t('workout_no_prev_lift')}</p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <div className="weight-mode-controls">
              <button className={`unit-btn ${weightMode === 'MANUAL' ? 'active' : ''}`} onClick={() => changeWeightMode('MANUAL')}>{t('workout_manual_label')} ({manualUnitLabel})</button>
                <button className={`unit-btn ${weightMode === 'LB' ? 'active' : ''}`} onClick={() => changeWeightMode('LB')}>lb</button>
                <button className={`unit-btn ${weightMode === 'KG' ? 'active' : ''}`} onClick={() => changeWeightMode('KG')}>kg</button>
              </div>
              <button className="icon-btn" onClick={() => setPaused((v) => !v)}>{paused ? <Play /> : <Pause />}</button>
            </div>
          </div>
          <ExerciseInstructions exercise={exercise} settings={settings} />

          <div className="set-table">
            <div className="set-table-header">
              <span>{t('detail_sets')}</span><span>{t('workout_prev_btn')}</span><span>{weightMode === 'LB' ? 'Lb' : 'Kg'}</span><span>{t('analytics_reps')}</span><span /><span />
            </div>
            <div className="space-y-2">
              {sets.map((set) => {
                const previous = previousSets[set.setIndex - 1];
                const prevUndone = sets.find((s) => !s.done && s.setIndex < set.setIndex);
                const lockedUndone = !set.done && Boolean(prevUndone);
                const lastDoneIndex = [...sets].filter((s) => s.done).sort((a, b) => b.setIndex - a.setIndex)[0]?.setIndex;
                const lockedDone = set.done && set.setIndex !== lastDoneIndex;
                const locked = lockedUndone || lockedDone;
                return (
                  <div key={set.setIndex} className={`set-table-row ${set.done ? 'done' : ''}`}>
                    <strong className="set-number">{set.setIndex}</strong>
                    <span className="set-previous">{previous ? `${previous.weight_kg}kg × ${previous.reps}` : '-'}</span>
                    {weightMode === 'MANUAL' ? (
                      <input
                        className="manual-weight-input"
                        type="number"
                        step="0.1"
                        disabled={set.done}
                        style={set.done ? { opacity: 0.45, pointerEvents: 'none' } : undefined}
                        value={defaultWeightUnit === 'lb' ? Number(kgToLb(set.weightKg).toFixed(1)) : set.weightKg ?? manualWeight}
                        onChange={(event) => {
                          const value = Number(event.target.value || 0);
                          updateSet(set.setIndex, { weightKg: defaultWeightUnit === 'lb' ? lbToKg(value) : value });
                        }}
                        onBlur={(event) => updateManualWeight(event.target.value)}
                      />
                    ) : weightMode === 'LB' ? (
                      <div style={set.done ? { opacity: 0.45, pointerEvents: 'none' } : undefined}>
                        <WheelPicker value={nearestOption(kgToLb(set.weightKg), weightStepsLbOptions)} options={weightStepsLbOptions} suffix="lb" onChange={(value) => updateSet(set.setIndex, { weightKg: lbToKg(value) })} />
                      </div>
                    ) : (
                      <div style={set.done ? { opacity: 0.45, pointerEvents: 'none' } : undefined}>
                        <WheelPicker value={nearestOption(set.weightKg, weightStepsKgOptions)} options={weightStepsKgOptions} suffix="kg" onChange={(value) => updateSet(set.setIndex, { weightKg: value })} />
                      </div>
                    )}
                    <div style={set.done ? { opacity: 0.45, pointerEvents: 'none' } : undefined}>
                      <WheelPicker value={set.reps} options={repOptions} onChange={(value) => updateSet(set.setIndex, { reps: value })} />
                    </div>
                    <button
                      className={`set-check ${set.done ? 'done' : ''}`}
                      style={locked ? { opacity: 0.3, cursor: 'not-allowed' } : undefined}
                      title={lockedUndone ? `Hoàn thành Set ${prevUndone.setIndex} trước` : lockedDone ? 'Bỏ Set sau trước' : undefined}
                      onClick={() => completeSet(set)}
                    >
                      {lockedUndone ? <Lock size={18} /> : <Check size={22} />}
                    </button>
                    <button
                      className="tiny-btn"
                      disabled={set.done || sets.length <= 1}
                      style={set.done ? { opacity: 0.22, cursor: 'not-allowed', filter: 'grayscale(1)' } : undefined}
                      onClick={() => removeDraftSet(set.setIndex)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                );
              })}
            </div>
            <button className="add-set-btn" onClick={addSet}>{t('workout_add_set')}</button>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <label className="label">{t('workout_note_label')}</label>
            <textarea className="input min-h-24" value={note} onChange={(e) => saveNote(e.target.value)} placeholder={t('workout_note_placeholder')} />
          </div>

          <button className="primary" onClick={complete}>{t('workout_end_btn')}</button>
          </div>
        </div>
        );
      })()}
      {timer > 0 && (
        <div className={`timer-pop ${settings?.countdown_3s && timer <= 3 ? 'urgent' : ''}`}>
          <div className="timer-pop-label">
            {settings?.countdown_3s && timer <= 3 ? t('workout_timer_prepare') : t('workout_timer_rest')}
          </div>
          <div className="timer-pop-time">
            {timer >= 60 ? `${Math.floor(timer / 60)}:${String(timer % 60).padStart(2, '0')}` : `${timer}s`}
          </div>
          <div className="timer-pop-actions">
            <button className="timer-pop-btn" onClick={() => startTimer(timer + 30)}>+30s</button>
            <button className="timer-pop-dismiss" onClick={() => { timerEndAt.current = 0; setTimer(0); }}>{t('workout_timer_off')}</button>
          </div>
        </div>
      )}
    </section>
  );
}

function WheelPicker({ value, options, suffix = '', onChange }) {
  const pickerOptions = useMemo(() => options.map((item) => ({
    value: String(item),
    label: (
      <span className="compact-wheel-label">
        <strong>{item}</strong>
        {suffix && <small>{suffix}</small>}
      </span>
    ),
    textValue: `${item}${suffix}`
  })), [options, suffix]);

  const currentValue = String(value ?? options[0]);

  const changeValue = (nextValue) => {
    const matched = options.find((item) => String(item) === String(nextValue));
    if (matched !== undefined) onChange(matched);
  };

  return (
    <WheelPickerWrapper className="compact-wheel-picker">
      <ReactWheelPicker
        value={currentValue}
        options={pickerOptions}
        onValueChange={changeValue}
        infinite={false}
        visibleCount={12}
        optionItemHeight={26}
        dragSensitivity={3}
        scrollSensitivity={5}
        classNames={{
          optionItem: 'compact-wheel-option',
          highlightWrapper: 'compact-wheel-highlight-wrapper',
          highlightItem: 'compact-wheel-highlight'
        }}
      />
    </WheelPickerWrapper>
  );
}

function LegacyWheelPicker({ value, options, suffix = '', onChange }) {
  const rootRef = React.useRef(null);
  const dragState = React.useRef(null);
  const wheelLock = React.useRef(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [settling, setSettling] = useState(false);
  const itemHeight = 34;
  const currentIndex = Math.max(0, options.findIndex((option) => Number(option) === Number(value)));

  useEffect(() => {
    if (!dragState.current) setDragOffset(0);
  }, [currentIndex]);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return undefined;
    const stopPageWheel = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (wheelLock.current) return;
      stepBy(event.deltaY > 0 ? 1 : -1);
    };
    node.addEventListener('wheel', stopPageWheel, { passive: false });
    return () => node.removeEventListener('wheel', stopPageWheel);
  }, [currentIndex, value, options]);

  const commitIndex = (nextIndex) => {
    const clampedIndex = Math.max(0, Math.min(options.length - 1, nextIndex));
    const next = options[clampedIndex];
    setSettling(true);
    setDragOffset(0);
    window.setTimeout(() => setSettling(false), 160);
    if (Number(next) !== Number(value)) onChange(next);
  };

  const stepBy = (direction) => {
    wheelLock.current = true;
    window.setTimeout(() => { wheelLock.current = false; }, 90);
    commitIndex(currentIndex + direction);
  };

  const startDrag = (clientY, pointerId, target) => {
    target.setPointerCapture?.(pointerId);
    dragState.current = { startY: clientY, lastY: clientY, lastTime: performance.now(), velocity: 0 };
    setSettling(false);
  };

  const moveDrag = (clientY) => {
    const drag = dragState.current;
    if (!drag) return;
    const now = performance.now();
    const distance = clientY - drag.startY;
    const deltaTime = Math.max(1, now - drag.lastTime);
    drag.velocity = (clientY - drag.lastY) / deltaTime;
    drag.lastY = clientY;
    drag.lastTime = now;
    setDragOffset(Math.max(-itemHeight * 2.5, Math.min(itemHeight * 2.5, distance)));
  };

  const endDrag = () => {
    const drag = dragState.current;
    if (!drag) return;
    dragState.current = null;
    const projected = dragOffset + drag.velocity * 90;
    const pickedDelta = Math.round(projected / itemHeight);
    commitIndex(currentIndex - pickedDelta);
  };

  return (
    <div
      ref={rootRef}
      className="wheel-column"
      role="listbox"
      tabIndex={0}
      onPointerDown={(event) => startDrag(event.clientY, event.pointerId, event.currentTarget)}
      onPointerMove={(event) => moveDrag(event.clientY)}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          commitIndex(currentIndex + 1);
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          commitIndex(currentIndex - 1);
        }
      }}
    >
      <div className="wheel-highlight" />
      <div
        className={`wheel-options ${settling ? 'settling' : ''}`}
        style={{ '--wheel-offset': `${dragOffset}px` }}
      >
        {options.map((item, index) => {
          const distance = index - currentIndex - dragOffset / itemHeight;
          const hidden = Math.abs(distance) > 4;
          const selected = Math.abs(distance) < 0.48;
          return (
            <button
              key={item}
              type="button"
              role="option"
              aria-selected={Number(item) === Number(value)}
              className={`wheel-option ${selected ? 'active' : ''}`}
              style={{
                '--wheel-y': `${distance * itemHeight}px`,
                '--wheel-rotate': `${distance * -18}deg`,
                '--wheel-scale': Math.max(0.78, 1 - Math.abs(distance) * 0.08),
                '--wheel-opacity': hidden ? 0 : Math.max(0.2, 1 - Math.abs(distance) * 0.22),
                visibility: hidden ? 'hidden' : 'visible'
              }}
              onClick={(event) => {
                event.stopPropagation();
                commitIndex(index);
              }}
            >
              {item}{suffix}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WeightHistoryPanel({ weightRows, t, settings }) {
  const [visibleCount, setVisibleCount] = useState(5);
  const reversed = [...weightRows].reverse();
  const visible = reversed.slice(0, visibleCount);
  const hasMore = visibleCount < weightRows.length;
  return (
    <div className="weight-history-panel">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-bold">{t('analytics_history_section')}</h3>
        <span className="text-xs font-bold text-[#8b84ad]">{t('analytics_weight_records', weightRows.length)}</span>
      </div>
      <div className="grid gap-3">
        {visible.map((row) => (
          <div key={row.id} className="weight-history-row">
            <div className="weight-history-dot" />
            <div className="min-w-0 flex-1">
              <strong>{row.day}</strong>
              <span>{row.time}{row.bmi ? ` · BMI ${row.bmi}` : ''}</span>
            </div>
            <div className="text-right">
              <strong>{row.weight}</strong>
              <span>{row.unit}</span>
            </div>
          </div>
        ))}
        {weightRows.length === 0 && <p className="text-sm text-[#8b84ad]">{t('analytics_weight_no_history')}</p>}
      </div>
      {hasMore && (
        <button className="ghost-btn w-full mt-3" onClick={() => setVisibleCount((v) => v + 5)}>
          {t('history_load_more')} ({visibleCount}/{weightRows.length})
        </button>
      )}
    </div>
  );
}

function Analytics({ userId, settings }) {
  const t = useLang();
  const rangeOptions = getRangeOptions(t);
  const [analytics, setAnalytics] = useState({ exercises: [], exerciseRows: [], routines: [], sessionRows: [] });
  const [weights, setWeights] = useState([]);
  const [chartMode, setChartMode] = useState('exercise');
  const [rangeKey, setRangeKey] = useState('7d');
  const [selectedExerciseId, setSelectedExerciseId] = useState('');
  const [selectedRoutineName, setSelectedRoutineName] = useState('');

  useEffect(() => {
    api(`/api/analytics?userId=${userId}`).then((data) => {
      setAnalytics(data);
      setSelectedExerciseId((current) => current || data.exercises?.[0]?.id || '');
      setSelectedRoutineName((current) => current || data.routines?.[0]?.name || '');
    });
    api(`/api/body-weight?userId=${userId}`).then(setWeights);
  }, [userId]);

  // Khi đổi exercise, tự tìm range có data nếu range hiện tại trống
  useEffect(() => {
    if (!selectedExerciseId || !analytics.exerciseRows?.length) return;
    const hasDataInRange = filterByRange(analytics.exerciseRows, 'day', rangeKey)
      .some((row) => row.exercise_id === selectedExerciseId);
    if (!hasDataInRange) {
      const hasAnyData = analytics.exerciseRows.some((row) => row.exercise_id === selectedExerciseId);
      if (hasAnyData) setRangeKey('all'); // mở rộng ra toàn bộ
    }
  }, [selectedExerciseId, analytics.exerciseRows]);

  const weightRows = weights.map((row) => ({
    ...row,
    ts: parseServerDate(row.logged_at)?.getTime(),
    day: formatDate(row.logged_at, settings),
    time: formatTime(row.logged_at, settings),
    label: formatDateTime(row.logged_at, settings, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
    bmi: settings.height_cm ? Number((Number(row.weight) / ((Number(settings.height_cm) / 100) ** 2)).toFixed(1)) : null
  }));
  const chartDomain = chartRangeDomain(rangeKey);
  const rangedWeightRows = filterByRange(weightRows, 'logged_at', rangeKey);
  const latestWeight = weightRows[weightRows.length - 1];
  const previousWeight = weightRows[weightRows.length - 2];
  const weightDelta = latestWeight && previousWeight ? Number(latestWeight.weight) - Number(previousWeight.weight) : 0;
  const latestBmi = latestWeight?.bmi;
  const bmiInfo = bmiFeedback(latestBmi, t);
  const selectedExerciseRawRows = filterByRange(analytics.exerciseRows, 'day', rangeKey)
    .filter((row) => row.exercise_id === selectedExerciseId);
  const selectedExerciseUnits = new Set(
    selectedExerciseRawRows.flatMap((row) => String(row.weight_units || 'kg').split(',').map((unit) => unit.trim()).filter(Boolean))
  );
  const exerciseChartUnit = selectedExerciseUnits.size === 1
    ? Array.from(selectedExerciseUnits)[0]
    : (settings.default_weight_unit || 'kg');
  const exerciseChartRows = selectedExerciseRawRows
    .map((row) => ({
      ...row,
      ts: parseServerDate(row.day)?.getTime(),
      label: formatDate(row.day, settings, { day: '2-digit', month: '2-digit' }),
      display_weight: displayWeight(row.max_weight, exerciseChartUnit)
    }));
  const sessionChartRows = filterByRange(analytics.sessionRows, 'completed_at', rangeKey)
    .filter((row) => !selectedRoutineName || row.name === selectedRoutineName)
    .map((row) => ({ ...row, ts: parseServerDate(row.completed_at)?.getTime(), label: formatDateTime(row.completed_at, settings, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) }));
  const selectedExercise = analytics.exercises.find((exercise) => exercise.id === selectedExerciseId);

  return (
    <section className="space-y-4">
      <h2 className="section-title">{t('analytics_title')}</h2>
      <div className="range-bar">
        {rangeOptions.map(([key, label]) => (
          <button key={key} className={rangeKey === key ? 'active' : ''} onClick={() => setRangeKey(key)}>{label}</button>
        ))}
      </div>
      <div className="weight-hero-card">
        <div>
          <p className="text-sm font-bold text-white/75">{t('analytics_weight_current')}</p>
          <div className="mt-1 flex items-end gap-2">
            <strong className="text-4xl">{latestWeight ? latestWeight.weight : '--'}</strong>
            <span className="pb-1 text-sm font-bold text-white/75">{latestWeight?.unit || 'kg'}</span>
          </div>
          <p className="mt-2 text-sm font-bold text-white/80">
            {previousWeight ? t('analytics_weight_delta', Number(weightDelta.toFixed(1)), latestWeight.unit) : t('analytics_no_prev')}
          </p>
        </div>
        <div className="bmi-badge">
          <span>BMI</span>
          <strong>{latestBmi || '--'}</strong>
          <small>{bmiInfo.label}</small>
        </div>
      </div>
      <div className={`bmi-feedback ${bmiInfo.tone}`}>
        <strong>{bmiInfo.label}</strong>
        <span>{bmiInfo.text}</span>
      </div>
      <div className="weight-chart-panel">
        <h3 className="mb-3 font-bold">{t('analytics_weight_chart')}</h3>
        {rangedWeightRows.length ? (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={rangedWeightRows} margin={{ top: 16, right: 18, bottom: 28, left: 8 }}>
              <defs>
                <linearGradient id="weightFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2563eb" stopOpacity={0.28} />
                  <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="ts"
                type="number"
                domain={chartDomain}
                stroke="#6b668a"
                tickFormatter={(value) => formatDate(value, settings, { day: '2-digit', month: '2-digit' })}
                tickMargin={14}
                minTickGap={22}
              />
              <YAxis stroke="#6b668a" tickMargin={10} />
              <Tooltip labelFormatter={(value) => formatDateTime(value, settings, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} />
              <Area type="monotone" dataKey="weight" name={t('analytics_weight_label')} stroke="#2563eb" strokeWidth={3} fill="url(#weightFill)" dot />
            </AreaChart>
          </ResponsiveContainer>
        ) : <p className="text-slate-600">{t('analytics_no_weight_chart')}</p>}
      </div>
      <div className="weight-chart-panel">
        <h3 className="mb-3 font-bold">{t('analytics_bmi_chart')}</h3>
        {rangedWeightRows.some((row) => row.bmi) ? (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={rangedWeightRows.filter((row) => row.bmi)} margin={{ top: 16, right: 18, bottom: 28, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="ts"
                type="number"
                domain={chartDomain}
                stroke="#6b668a"
                tickFormatter={(value) => formatDate(value, settings, { day: '2-digit', month: '2-digit' })}
                tickMargin={14}
                minTickGap={22}
              />
              <YAxis stroke="#6b668a" tickMargin={10} domain={['dataMin - 1', 'dataMax + 1']} />
              <Tooltip labelFormatter={(value) => formatDateTime(value, settings, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} />
              <Line type="monotone" dataKey="bmi" name="BMI" stroke="#f97316" strokeWidth={3} dot />
            </LineChart>
          </ResponsiveContainer>
        ) : <p className="text-slate-600">{t('analytics_no_bmi_chart')}</p>}
      </div>
      <div className="panel">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold">{t('analytics_progress_section')}</h3>
          <div className="flex gap-2">
            <Chip active={chartMode === 'exercise'} onClick={() => setChartMode('exercise')}>{t('analytics_by_exercise')}</Chip>
            <Chip active={chartMode === 'session'} onClick={() => setChartMode('session')}>{t('analytics_by_session')}</Chip>
          </div>
        </div>
        {chartMode === 'exercise' ? (
          <div>
            <ExerciseProgressPicker exercises={analytics.exercises} value={selectedExerciseId} onChange={setSelectedExerciseId} />
            {exerciseChartRows.length ? (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={exerciseChartRows}>
                  <XAxis
                    dataKey="ts"
                    type="number"
                    domain={chartDomain}
                    stroke="#334155"
                    tickFormatter={(value) => formatDate(value, settings, { day: '2-digit', month: '2-digit' })}
                  />
                  <YAxis stroke="#334155" label={{ value: exerciseChartUnit.toUpperCase(), angle: -90, position: 'insideLeft' }} />
                  <Tooltip labelFormatter={(value) => formatDate(value, settings, { day: '2-digit', month: '2-digit' })} />
                  <Line type="monotone" dataKey="display_weight" name={exerciseChartUnit.toUpperCase()} stroke="#2563eb" strokeWidth={3} dot />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="mt-4">
                <p className="text-slate-600">{selectedExercise ? t('analytics_no_exercise_data') : t('analytics_no_exercises')}</p>
                {selectedExercise && rangeKey !== 'all' && (
                  <button className="small-action mt-2" onClick={() => setRangeKey('all')}>{t('analytics_show_all')}</button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div>
            <select className="input mb-3 py-2 text-sm" value={selectedRoutineName} onChange={(event) => setSelectedRoutineName(event.target.value)}>
              {analytics.routines.map((routine) => <option key={routine.id || routine.name} value={routine.name}>{routine.name}</option>)}
            </select>
            {sessionChartRows.length ? (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={sessionChartRows}>
                  <XAxis
                    dataKey="ts"
                    type="number"
                    domain={chartDomain}
                    stroke="#334155"
                    tickFormatter={(value) => formatDate(value, settings, { day: '2-digit', month: '2-digit' })}
                  />
                  <YAxis stroke="#334155" />
                  <Tooltip labelFormatter={(value) => formatDateTime(value, settings, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} />
                  <Line type="monotone" dataKey="max_weight" name="KG" stroke="#2563eb" strokeWidth={3} dot />
                  <Line type="monotone" dataKey="sets" name="Set" stroke="#0f766e" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : <p className="text-slate-600 mt-4">{t('analytics_no_session_data')}</p>}
          </div>
        )}
      </div>
      <WeightHistoryPanel weightRows={weightRows} t={t} settings={settings} />
    </section>
  );
}

function ExerciseProgressPicker({ exercises, value, onChange }) {
  const t = useLang();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = exercises.find((exercise) => exercise.id === value);
  const filtered = search.trim()
    ? exercises.filter((e) => e.name.toLowerCase().includes(search.trim().toLowerCase()))
    : exercises;
  return (
    <div className="exercise-picker">
      <button type="button" className="exercise-picker-button" onClick={() => { setOpen((v) => !v); setSearch(''); }}>
        {exerciseAutoMediaUrl(selected) && <img src={exerciseAutoMediaUrl(selected)} alt="" />}
        <span>{selected?.name || t('analytics_select_exercise')}</span>
      </button>
      {open && (
        <div className="exercise-picker-menu">
          <input
            className="input mb-2 py-2 text-sm"
            placeholder="Search..."
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {filtered.map((exercise) => (
            <button
              type="button"
              key={exercise.id}
              className={`exercise-picker-option ${exercise.id === value ? 'active' : ''}`}
              onClick={() => {
                onChange(exercise.id);
                setOpen(false);
                setSearch('');
              }}
            >
              {exerciseAutoMediaUrl(exercise) && <img src={exerciseAutoMediaUrl(exercise)} alt="" />}
              <span>{exercise.name}</span>
            </button>
          ))}
          {filtered.length === 0 && <p className="p-2 text-sm text-slate-400">No results</p>}
        </div>
      )}
    </div>
  );
}

function SettingsPage({ userId, boot, onChanged }) {
  const t = useLang();
  const dialog = useAppDialog();
  const settings = boot.settings || {};
  const [name, setName] = useState(boot.activeUser.name);
  const [password, setPassword] = useState('');
  const [passwordAgain, setPasswordAgain] = useState('');
  const [timezone, setTimezone] = useState(boot.settings.timezone || fallbackDisplay.timezone);
  const [locale, setLocale] = useState(boot.settings.locale || fallbackDisplay.locale);
  const [heightCm, setHeightCm] = useState(boot.settings.height_cm || '');
  const [defaultWeightUnit, setDefaultWeightUnit] = useState(boot.settings.default_weight_unit || 'kg');
  const [avatarPreview, setAvatarPreview] = useState(boot.activeUser.avatar || '');
  const [gender, setGender] = useState(settings.gender || '');
  const [birthDate, setBirthDate] = useState(settings.birth_date || '');
  const [heightUnit, setHeightUnit] = useState(settings.height_unit || 'cm');
  const initialFtIn = cmToFeetInches(boot.settings.height_cm);
  const [heightFeet, setHeightFeet] = useState(initialFtIn.feet);
  const [heightInches, setHeightInches] = useState(initialFtIn.inches);
  const [clockFormat, setClockFormat] = useState(settings.clock_format || '24h');
  const [restSeconds, setRestSeconds] = useState(settings.rest_seconds || 60);
  const [defaultSets, setDefaultSets] = useState(settings.default_sets || 3);
  const [defaultReps, setDefaultReps] = useState(settings.default_reps || 12);
  const [weightStepsKg, setWeightStepsKg] = useState(() => parseWeightSteps(settings.weight_steps_kg, defaultKgOptions, 'kg'));
  const [weightStepsLb, setWeightStepsLb] = useState(() => parseWeightSteps(settings.weight_steps_lb, defaultLbOptions, 'lb'));
  const [newWeightKg, setNewWeightKg] = useState('');
  const [newWeightLb, setNewWeightLb] = useState('');
  const [progressiveOverload, setProgressiveOverload] = useState(Boolean(settings.progressive_overload));
  const [soundRestDone, setSoundRestDone] = useState(Boolean(settings.sound_rest_done));
  const [vibrateRestDone, setVibrateRestDone] = useState(Boolean(settings.vibrate_rest_done));
  const [countdown3s, setCountdown3s] = useState(Boolean(settings.countdown_3s));
  const [autoNextSet, setAutoNextSet] = useState(Boolean(settings.auto_next_set));
  const [notifyWorkout, setNotifyWorkout] = useState(Boolean(settings.notify_workout));
  const [notifyWorkoutTime, setNotifyWorkoutTime] = useState(settings.notify_workout_time || '18:30');
  const [notifyMissedWorkout, setNotifyMissedWorkout] = useState(Boolean(settings.notify_missed_workout));
  const [notifyMissedWorkoutTime, setNotifyMissedWorkoutTime] = useState(settings.notify_missed_workout_time || '21:00');
  const [notifyUnfinishedWorkout, setNotifyUnfinishedWorkout] = useState(Boolean(settings.notify_recovery));
  const [notifyUnfinishedAfterMinutes, setNotifyUnfinishedAfterMinutes] = useState(settings.notify_unfinished_after_minutes || 180);
  const [notifyWeighFrequency, setNotifyWeighFrequency] = useState(settings.notify_weigh_frequency || 'off');
  const [notifyWeighTime, setNotifyWeighTime] = useState(settings.notify_weigh_time || '07:00');
  const [notifyProgressPhotoFrequency, setNotifyProgressPhotoFrequency] = useState(settings.notify_progress_photo_frequency || 'off');
  const [settingsError, setSettingsError] = useState('');
  const [lockedWeightSteps, setLockedWeightSteps] = useState({ kg: [], lb: [] });

  useEffect(() => {
    let cancelled = false;
    async function loadLockedWeightSteps() {
      try {
        const active = await api(`/api/sessions/active?userId=${userId}`);
        const sessions = active?.sessions || (active?.session ? [active] : []);
        const kg = [];
        const lb = [];
        await Promise.all(sessions.flatMap((sessionItem) => {
          const sessionId = sessionItem.session?.id;
          if (!sessionId) return [];
          return (sessionItem.exercises || [])
            .filter((exercise) => Number(exercise.completedSets || 0) > 0)
            .map((exercise) => api(`/api/sessions/${sessionId}/exercises/${exercise.id}/sets?userId=${userId}`)
              .then((payload) => {
                for (const row of payload.current || []) {
                  if (String(row.weight_unit || 'kg').toLowerCase() === 'lb') {
                    lb.push(nearestOption(displayWeight(row.weight_kg, 'lb'), weightStepsLb));
                  } else {
                    kg.push(nearestOption(Number(row.weight_kg || 0), weightStepsKg));
                  }
                }
              })
              .catch(() => {}));
        }));
        if (!cancelled) {
          setLockedWeightSteps({
            kg: normalizeWeightSteps(kg, [], 'kg'),
            lb: normalizeWeightSteps(lb, [], 'lb')
          });
        }
      } catch {
        if (!cancelled) setLockedWeightSteps({ kg: [], lb: [] });
      }
    }
    loadLockedWeightSteps();
    return () => { cancelled = true; };
  }, [userId, weightStepsKg, weightStepsLb]);

  // Đếm số settings chưa save
  const initialRef = React.useRef({
    name: boot.activeUser.name, timezone: boot.settings.timezone || fallbackDisplay.timezone,
    locale: boot.settings.locale || fallbackDisplay.locale, heightCm: boot.settings.height_cm || '',
    defaultWeightUnit: boot.settings.default_weight_unit || 'kg', gender: settings.gender || '',
    birthDate: settings.birth_date || '', clockFormat: settings.clock_format || '24h',
    restSeconds: settings.rest_seconds || 60, defaultSets: settings.default_sets || 3,
    defaultReps: settings.default_reps || 12, progressiveOverload: Boolean(settings.progressive_overload),
    weightStepsKg: parseWeightSteps(settings.weight_steps_kg, defaultKgOptions, 'kg'),
    weightStepsLb: parseWeightSteps(settings.weight_steps_lb, defaultLbOptions, 'lb'),
    soundRestDone: Boolean(settings.sound_rest_done), vibrateRestDone: Boolean(settings.vibrate_rest_done),
    countdown3s: Boolean(settings.countdown_3s), autoNextSet: Boolean(settings.auto_next_set),
  });
  const dirtyCount = useMemo(() => {
    const init = initialRef.current;
    return [
      name !== init.name, password.trim() !== '', timezone !== init.timezone,
      locale !== init.locale, String(heightCm) !== String(init.heightCm),
      defaultWeightUnit !== init.defaultWeightUnit, gender !== init.gender,
      birthDate !== init.birthDate, clockFormat !== init.clockFormat,
      restSeconds !== init.restSeconds, defaultSets !== init.defaultSets,
      defaultReps !== init.defaultReps, progressiveOverload !== init.progressiveOverload,
      JSON.stringify(weightStepsKg) !== JSON.stringify(init.weightStepsKg),
      JSON.stringify(weightStepsLb) !== JSON.stringify(init.weightStepsLb),
      soundRestDone !== init.soundRestDone, vibrateRestDone !== init.vibrateRestDone,
      countdown3s !== init.countdown3s, autoNextSet !== init.autoNextSet,
      avatarPreview !== (boot.activeUser.avatar || ''),
    ].filter(Boolean).length;
  }, [name, password, timezone, locale, heightCm, defaultWeightUnit, gender, birthDate,
      clockFormat, restSeconds, defaultSets, defaultReps, progressiveOverload, soundRestDone,
      vibrateRestDone, countdown3s, autoNextSet, avatarPreview, weightStepsKg, weightStepsLb]);
  const timezoneChoices = useMemo(timezoneSelectOptions, []);
  const addUser = async () => {
    const name = await dialog.prompt(t('settings_name'));
    if (!name) return;
    const username = await dialog.prompt(t('settings_username'));
    if (!username) return;
    const password = await dialog.prompt(t('settings_password'), { type: 'password' });
    if (!password) return;
    await api('/api/users', { method: 'POST', body: JSON.stringify({ userId, name, username, password }) });
    location.reload();
  };
  const saveAll = async () => {
    setSettingsError('');
    try {
      if (password.trim() || passwordAgain.trim()) {
        if (password !== passwordAgain) {
          setSettingsError(t('settings_password_mismatch'));
          return;
        }
      }
      const body = { userId };
      if (name.trim()) body.name = name.trim();
      if (password.trim()) body.password = password.trim();
      if (avatarPreview !== boot.activeUser.avatar) body.avatar = avatarPreview;
      const hasUserChanges = body.name !== boot.activeUser.name || Boolean(body.password) || body.avatar !== undefined;
      const updated = hasUserChanges
        ? await api(`/api/users/${userId}`, { method: 'PATCH', body: JSON.stringify(body) })
        : boot.activeUser;
      await api('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          userId,
          timezone,
          locale,
          heightCm: heightUnit === 'ft-in' ? feetInchesToCm(heightFeet, heightInches) || null : heightCm || null,
          defaultWeightUnit,
          gender,
          birthDate,
          heightUnit,
          clockFormat,
          restSeconds,
          defaultSets,
          defaultReps,
          weightStepsKg,
          weightStepsLb,
          progressiveOverload,
          soundRestDone,
          vibrateRestDone,
          countdown3s,
          autoNextSet,
          notifyWorkout,
          notifyWorkoutTime,
          notifyMissedWorkout,
          notifyMissedWorkoutTime,
          notifyRecovery: notifyUnfinishedWorkout,
          notifyUnfinishedAfterMinutes,
          notifyWeigh: notifyWeighFrequency !== 'off',
          notifyWeighFrequency,
          notifyWeighTime,
          notifyProgressPhoto: notifyProgressPhotoFrequency !== 'off',
          notifyProgressPhotoFrequency
        })
      });
      localStorage.setItem('familyGymUser', JSON.stringify(updated));
      location.reload();
    } catch (error) {
      setSettingsError(error.message || 'Không lưu được cài đặt');
    }
  };
  const pickAvatar = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setAvatarPreview(String(reader.result));
    reader.readAsDataURL(file);
  };
  const importBackup = async (file, scope = 'user') => {
    if (!file) return;
    const backup = JSON.parse(await file.text());
    const message = scope === 'admin' ? t('settings_admin_import_confirm') : t('settings_import_confirm');
    if (!(await dialog.confirm(message))) return;
    await api('/api/backup/import', {
      method: 'POST',
      body: JSON.stringify({ userId, scope, backup })
    });
    await dialog.alert(t('settings_import_done'));
    location.reload();
  };
  return (
    <section className="space-y-4">
      <SettingsGroup title={t('settings_profile')}>
        <div className="mb-4 flex items-center gap-3">
          <div className="avatar-preview">{avatarContent(avatarPreview)}</div>
          <label className="small-action cursor-pointer">
            {t('settings_avatar_pick')}
            <input className="hidden" type="file" accept="image/*" onChange={(event) => pickAvatar(event.target.files?.[0])} />
          </label>
          <button className="small-danger" onClick={() => setAvatarPreview(name.trim().slice(0, 2).toUpperCase())}>{t('settings_avatar_remove')}</button>
        </div>
        <label className="label">{t('settings_name')}</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="label mt-3">{t('settings_password')}</label>
        <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('password_placeholder')} />
        <label className="label mt-3">{t('settings_password_again')}</label>
        <input className="input" type="password" value={passwordAgain} onChange={(e) => setPasswordAgain(e.target.value)} placeholder={t('settings_password_again')} />
        <label className="label mt-3">{t('settings_gender')}</label>
        <select className="input" value={gender} onChange={(event) => setGender(event.target.value)}>
          <option value="">-</option>
          <option value="male">{t('settings_gender_m')}</option>
          <option value="female">{t('settings_gender_f')}</option>
          <option value="other">{t('settings_gender_other')}</option>
        </select>
        <label className="label mt-3">{t('settings_birthdate')}</label>
        <input className="input date-input" type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} />
        <label className="label mt-3">{t('settings_height')}</label>
        {heightUnit === 'ft-in' ? (
          <div className="grid grid-cols-2 gap-2">
            <input className="input" type="number" min="1" max="8" value={heightFeet} onChange={(event) => setHeightFeet(event.target.value)} placeholder="feet" />
            <input className="input" type="number" min="0" max="11" value={heightInches} onChange={(event) => setHeightInches(event.target.value)} placeholder="inch" />
          </div>
        ) : (
          <input className="input" type="number" min="50" max="260" step="0.5" value={heightCm} onChange={(event) => setHeightCm(event.target.value)} placeholder={t('height_placeholder')} />
        )}
      </SettingsGroup>

      <SettingsGroup title={t('settings_body')}>
        <SettingsToggle label={t('settings_weight_unit_label')} value={defaultWeightUnit} onChange={setDefaultWeightUnit} options={[['kg', 'Kg'], ['lb', 'Lb']]} />
        <SettingsToggle label={t('settings_height_unit_label')} value={heightUnit} onChange={setHeightUnit} options={[['cm', 'cm'], ['ft-in', 'ft-in']]} />
        <SettingsToggle label={t('settings_clock_label')} value={clockFormat} onChange={setClockFormat} options={[['12h', '12h'], ['24h', '24h']]} />
      </SettingsGroup>

      <SettingsGroup title={t('settings_workout')}>
        <NumberSetting label={t('settings_rest_label')} value={restSeconds} onChange={setRestSeconds} min={10} max={600} />
        <NumberSetting label={t('settings_default_sets_label')} value={defaultSets} onChange={setDefaultSets} min={1} max={20} />
        <NumberSetting label={t('settings_default_reps_label')} value={defaultReps} onChange={setDefaultReps} min={1} max={100} />
        <WeightStepsSettings
          t={t}
          kg={{
            values: weightStepsKg,
            draft: newWeightKg,
            onDraft: setNewWeightKg,
            onChange: setWeightStepsKg,
            lockedValues: lockedWeightSteps.kg
          }}
          lb={{
            values: weightStepsLb,
            draft: newWeightLb,
            onDraft: setNewWeightLb,
            onChange: setWeightStepsLb,
            lockedValues: lockedWeightSteps.lb
          }}
          onConfirm={dialog.confirm}
        />
        <SwitchSetting label={t('settings_progressive_label')} checked={progressiveOverload} onChange={setProgressiveOverload} />
      </SettingsGroup>

      <SettingsGroup title={t('settings_timer_section')}>
        <p className="mb-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">{t('settings_timer_note_combined')}</p>
        <SwitchSetting label={t('settings_sound_rest_label')} desc={t('settings_sound_rest_label')} checked={soundRestDone} onChange={setSoundRestDone} />
        <SwitchSetting label={t('settings_vibrate_rest_label')} checked={vibrateRestDone} onChange={setVibrateRestDone} />
        <SwitchSetting label={t('settings_countdown_label')} checked={countdown3s} onChange={setCountdown3s} />
        <SwitchSetting label={t('settings_auto_next_label')} checked={autoNextSet} onChange={setAutoNextSet} />
      </SettingsGroup>

      <SettingsGroup title={t('settings_notify_section')}>
        {/* Master toggle */}
        <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 p-3">
          <div>
            <p className="font-semibold">{t('settings_notify_master_label')}</p>
            <p className="text-xs text-slate-500 mt-0.5">{t('settings_notify_master_desc')}</p>
          </div>
          <input type="checkbox" className="h-5 w-5 accent-orange-500" checked={notifyWorkout || notifyMissedWorkout || notifyUnfinishedWorkout || notifyWeighFrequency !== 'off' || notifyProgressPhotoFrequency !== 'off'}
            onChange={async (e) => {
              const value = e.target.checked;
              if (value && 'Notification' in window && Notification.permission === 'default') {
                await Notification.requestPermission();
              }
              setNotifyWorkout(value);
              setNotifyMissedWorkout(value);
              setNotifyUnfinishedWorkout(value);
              if (!value) { setNotifyWeighFrequency('off'); setNotifyProgressPhotoFrequency('off'); }
            }}
          />
        </div>

        {/* Children — disabled when all notifications off */}
        {(() => {
          const anyOn = notifyWorkout || notifyMissedWorkout || notifyUnfinishedWorkout || notifyWeighFrequency !== 'off' || notifyProgressPhotoFrequency !== 'off';
          return (
            <div className={`mt-3 space-y-3 rounded-lg border border-slate-200 p-3 transition-opacity ${anyOn ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>

              {/* Nhắc tập */}
              <div className="rounded-md bg-slate-50 p-3">
                <SwitchSetting
                  label={t('settings_notify_workout_label')}
                  checked={notifyWorkout}
                  onChange={async (value) => {
                    if (value && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
                    setNotifyWorkout(value);
                  }}
                />
                <div className="mt-2 pl-2">
                  <TimeSetting label={t('settings_notify_workout_time_label')} value={notifyWorkoutTime} onChange={setNotifyWorkoutTime} disabled={!notifyWorkout} />
                </div>
              </div>

              {/* Nhắc bỏ lỡ */}
              <div className="rounded-md bg-slate-50 p-3">
                <SwitchSetting label={t('settings_notify_missed_label')} checked={notifyMissedWorkout} onChange={setNotifyMissedWorkout} />
                <div className="mt-2 pl-2">
                  <TimeSetting label={t('settings_notify_missed_time_label')} value={notifyMissedWorkoutTime} onChange={setNotifyMissedWorkoutTime} disabled={!notifyMissedWorkout} />
                </div>
              </div>

              {/* Nhắc chưa hoàn thành */}
              <div className="rounded-md bg-slate-50 p-3">
                <SwitchSetting label={t('settings_notify_unfinished_label')} checked={notifyUnfinishedWorkout} onChange={setNotifyUnfinishedWorkout} />
                <div className="mt-2 pl-2">
                  <NumberSetting label={t('settings_notify_unfinished_after_label')} value={notifyUnfinishedAfterMinutes} onChange={setNotifyUnfinishedAfterMinutes} min={15} max={720} disabled={!notifyUnfinishedWorkout} />
                </div>
              </div>

              {/* Nhắc cân */}
              <div className="rounded-md bg-slate-50 p-3">
                <SettingsToggle label={t('settings_notify_weigh_label')} value={notifyWeighFrequency} onChange={setNotifyWeighFrequency} options={[['off', t('settings_notify_off')], ['daily', t('settings_notify_daily')], ['weekly', t('settings_notify_weekly')]]} />
                <div className="mt-2 pl-2">
                  <TimeSetting label={t('settings_notify_weigh_time_label')} value={notifyWeighTime} onChange={setNotifyWeighTime} disabled={notifyWeighFrequency === 'off'} />
                </div>
              </div>

              {/* Nhắc ảnh tiến độ */}
              <div className="rounded-md bg-slate-50 p-3">
                <SettingsToggle label={t('settings_notify_progress_photo_label')} value={notifyProgressPhotoFrequency} onChange={setNotifyProgressPhotoFrequency} options={[['off', t('settings_notify_off')], ['weekly', t('settings_notify_weekly')], ['monthly', t('settings_notify_monthly')]]} />
              </div>

            </div>
          );
        })()}
      </SettingsGroup>

      <SettingsGroup title={t('settings_ui')}>
        <label className="label mt-3">{t('settings_language')} — Language</label>
        <select className="input" value={locale} onChange={(event) => setLocale(event.target.value)}>
          {localeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <label className="label mt-3">{t('settings_timezone')}</label>
        <select className="input" value={timezone} onChange={(event) => setTimezone(event.target.value)}>
          {timezoneChoices.map((item) => <option key={item.name} value={item.name}>{item.label}</option>)}
        </select>
        <p className="mt-2 text-sm text-slate-600">{t('settings_preview')} {formatDateTime(new Date(), { timezone, locale, clock_format: clockFormat }, { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
      </SettingsGroup>

      <SettingsGroup title={t('settings_admin')}>
        <a className="primary text-center block" href={`/api/export/excel?userId=${userId}`} download>{t('settings_export_excel')}</a>
        <div className="flex flex-wrap gap-2">
          {(() => {
            const scope = boot.activeUser.role === 'ADMIN' ? 'admin' : 'user';
            const exportUrl = `/api/backup?userId=${userId}${scope === 'admin' ? '&scope=admin' : ''}`;
            return (
              <a className="ghost-btn flex-1 text-center" href={exportUrl} download>{t('settings_export_data')}</a>
            );
          })()}
          <label className={`flex-1 cursor-pointer text-center ${boot.activeUser.role === 'ADMIN' ? 'danger-btn' : 'ghost-btn'}`}>
            {t('settings_import_data')}
            <input className="hidden" type="file" accept="application/json,.json" onChange={(event) => {
              const scope = boot.activeUser.role === 'ADMIN' ? 'admin' : 'user';
              importBackup(event.target.files?.[0], scope);
            }} />
          </label>
        </div>
        <p className="mt-2 text-sm text-slate-600">{t('settings_data_note')}</p>
      </SettingsGroup>

      {settingsError && <p className="rounded-md bg-red-50 p-3 text-sm font-bold text-red-700">{settingsError}</p>}
      <div className="h-20" />{/* spacer cho floating button */}

      {/* Floating Save button */}
      <button
        onClick={saveAll}
        className="fixed right-4 z-50 flex items-center gap-2 rounded-full px-5 py-3 font-bold text-white shadow-xl transition-all"
        style={{
          bottom: 'calc(5rem + env(safe-area-inset-bottom))',
          background: dirtyCount > 0 ? 'linear-gradient(135deg,#2563eb,#7c3aed)' : '#94a3b8',
          boxShadow: dirtyCount > 0 ? '0 4px 20px rgba(124,58,237,0.5)' : 'none',
        }}
      >
        {t('settings_save')}
        {dirtyCount > 0 && (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs font-black text-indigo-600">
            {dirtyCount}
          </span>
        )}
      </button>
      {boot.activeUser.role === 'ADMIN' && <div className="panel">
        <h2 className="section-title">{t('settings_users')}</h2>
        <button className="primary" onClick={addUser}>{t('settings_add_user')}</button>
        <AdminUsers users={boot.users} adminId={userId} />
      </div>}
      <p className="pb-4 text-center text-xs text-slate-400">Gym App {`v${__APP_VERSION__}`}</p>
    </section>
  );
}

function SettingsGroup({ title, children }) {
  return (
    <div className="panel">
      <h2 className="section-title">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function SettingsToggle({ label, value, onChange, options }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="settings-unit-toggle">
        {options.map(([optionValue, text]) => (
          <button key={optionValue} className={`unit-btn ${value === optionValue ? 'active' : ''}`} onClick={() => onChange(optionValue)}>{text}</button>
        ))}
      </div>
    </div>
  );
}

function NumberSetting({ label, value, onChange, min, max, disabled = false }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className="input" type="number" min={min} max={max} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function WeightStepsSettings({ t, kg, lb, onConfirm }) {
  const resetKg = async () => {
    if (!(await onConfirm(t('settings_weight_steps_reset_kg_confirm')))) return;
    kg.onChange(normalizeWeightSteps([...defaultKgOptions, ...(kg.lockedValues || [])], defaultKgOptions, 'kg'));
  };
  const resetLb = async () => {
    if (!(await onConfirm(t('settings_weight_steps_reset_lb_confirm')))) return;
    lb.onChange(normalizeWeightSteps([...defaultLbOptions, ...(lb.lockedValues || [])], defaultLbOptions, 'lb'));
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-black text-slate-950">{t('settings_weight_steps_title')}</h3>
          <p className="text-xs font-semibold text-slate-500">{t('settings_weight_steps_desc')}</p>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <WeightStepsEditor
          title="KG"
          unit="kg"
          values={kg.values}
          draft={kg.draft}
          onDraft={kg.onDraft}
          onChange={kg.onChange}
          fallback={defaultKgOptions}
          lockedValues={kg.lockedValues}
          onReset={resetKg}
          t={t}
        />
        <WeightStepsEditor
          title="LBS"
          unit="lb"
          values={lb.values}
          draft={lb.draft}
          onDraft={lb.onDraft}
          onChange={lb.onChange}
          fallback={defaultLbOptions}
          lockedValues={lb.lockedValues}
          onReset={resetLb}
          t={t}
        />
      </div>
    </div>
  );
}

function WeightStepsEditor({ title, unit, values, draft, onDraft, onChange, fallback, lockedValues = [], onReset, t }) {
  const lockedKeys = useMemo(() => new Set(lockedValues.map((value) => String(Number(value)))), [lockedValues]);
  const isLocked = (value) => lockedKeys.has(String(Number(value)));
  const [selectedValue, setSelectedValue] = useState(() => values[0] ?? 0);
  useEffect(() => {
    if (!values.some((value) => Number(value) === Number(selectedValue))) {
      setSelectedValue(values[0] ?? 0);
    }
  }, [values, selectedValue]);
  const addValue = () => {
    const value = Number(draft);
    if (!Number.isFinite(value) || value < 0) return;
    const next = normalizeWeightSteps([...values, value], fallback, unit);
    onChange(next);
    setSelectedValue(value);
    onDraft('');
  };
  const removeValue = (value) => {
    if (isLocked(value)) return;
    const next = values.filter((item) => Number(item) !== Number(value));
    const normalized = next.length ? next : [0];
    onChange(normalized);
    setSelectedValue(normalized[0] ?? 0);
  };
  const selectedLocked = isLocked(selectedValue);
  const removeDisabled = selectedLocked || values.length <= 1;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <label className="label mb-0">{title}</label>
        <button type="button" className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-black text-slate-700 shadow-sm hover:bg-slate-100" onClick={onReset}>
          {t('settings_weight_steps_reset')}
        </button>
      </div>
      {lockedValues.length > 0 && (
        <p className="mb-2 rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
          {t('settings_weight_steps_locked_note')}
        </p>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md bg-white p-2">
        <WheelPicker
          value={nearestOption(selectedValue, values)}
          options={values}
          suffix={unit}
          onChange={setSelectedValue}
        />
        <button
          type="button"
          className={`grid h-12 w-12 place-items-center rounded-xl border text-2xl font-black ${removeDisabled ? 'border-slate-200 bg-slate-100 text-slate-300 opacity-45' : 'border-red-200 bg-red-50 text-red-700'}`}
          disabled={removeDisabled}
          onClick={() => removeValue(selectedValue)}
          title={selectedLocked ? t('settings_weight_steps_locked_title', selectedValue, unit) : values.length <= 1 ? t('settings_weight_steps_keep_one') : t('settings_weight_steps_delete_title', selectedValue, unit)}
        >
          {selectedLocked ? <Lock size={18} /> : '-'}
        </button>
      </div>
      <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
        <input
          className="input"
          type="number"
          min="0"
          step={unit === 'lb' ? '0.5' : '0.25'}
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addValue(); } }}
          placeholder={t('settings_weight_steps_add_placeholder', unit)}
        />
        <button type="button" className="small-action" onClick={addValue}>{t('settings_weight_steps_add')}</button>
      </div>
    </div>
  );
}

function TimeSetting({ label, value, onChange, disabled = false }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className="input" type="time" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function SwitchSetting({ label, checked, onChange }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md bg-slate-50 p-3 font-semibold">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function AdminUsers({ users, adminId }) {
  const t = useLang();
  const dialog = useAppDialog();
  const [drafts, setDrafts] = useState(() => Object.fromEntries(users.map((user) => [user.id, { name: user.name, password: '' }])));

  const save = async (targetId) => {
    const draft = drafts[targetId];
    const body = { userId: adminId, name: draft.name };
    if (draft.password.trim()) body.password = draft.password.trim();
    await api(`/api/users/${targetId}`, { method: 'PATCH', body: JSON.stringify(body) });
    location.reload();
  };
  const remove = async (targetId) => {
    if (!(await dialog.confirm(t('settings_confirm_delete_user')))) return;
    await api(`/api/users/${targetId}`, { method: 'DELETE', body: JSON.stringify({ userId: adminId }) });
    location.reload();
  };

  return (
    <div className="mt-4 space-y-3">
      {users.map((user) => (
        <div key={user.id} className="rounded-lg bg-slate-50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <strong>{user.username}</strong>
            <span className="rounded-full bg-teal-100 px-2 py-1 text-xs text-teal-950">{user.role}</span>
          </div>
          <input
            className="input"
            value={drafts[user.id]?.name || ''}
            onChange={(event) => setDrafts((old) => ({ ...old, [user.id]: { ...(old[user.id] || {}), name: event.target.value } }))}
          />
          <input
            className="input mt-2"
            type="password"
            placeholder={t('settings_new_password_placeholder')}
            value={drafts[user.id]?.password || ''}
            onChange={(event) => setDrafts((old) => ({ ...old, [user.id]: { ...(old[user.id] || {}), password: event.target.value } }))}
          />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button className="primary" onClick={() => save(user.id)}>{t('settings_save_user')}</button>
            <button className="danger-btn" disabled={user.id === adminId} onClick={() => remove(user.id)}>{t('delete')}</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Chip({ active, children, onClick }) {
  return <button onClick={onClick} className={`chip ${active ? 'active' : ''}`}>{children}</button>;
}

createRoot(document.getElementById('root')).render(
  <ServerStatusProvider>
    <DialogProvider>
      <App />
    </DialogProvider>
  </ServerStatusProvider>
);










