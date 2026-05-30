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
  LogOut,
  Pause,
  Play,
  Plus,
  Settings,
  Trash2,
  UserRound
} from 'lucide-react';
import { WheelPicker as ReactWheelPicker, WheelPickerWrapper } from '@ncdai/react-wheel-picker';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import '@ncdai/react-wheel-picker/style.css';
import './styles.css';
import { createT } from './i18n.js';

const getModeLabels = (t) => ({ FREE: t('mode_free'), FIXED: t('schedule_fixed_panel_title'), ROLLING: t('schedule_rolling_panel_title') });
const kgOptions = Array.from({ length: 121 }, (_, index) => index * 2.5);
const lbOptions = [0, 5, 10, 15, 20, 30, 40, 50, 65, 80, 95, 110, 125, 140, 155, 170, 185, 200, 220, 240];
const repOptions = Array.from({ length: 100 }, (_, index) => index + 1);
const customExerciseIcons = ['🏋️', '💪', '🔥', '⚡', '🦵', '❤️', '🎯', '⭐'];
const getCustomTargetOptions = (t) => t('custom_targets');
const customEquipmentOptions = ['body weight', 'dumbbell', 'barbell', 'machine', 'cable', 'band', 'kettlebell', 'other'];
const kgToLb = (kg) => Number(kg || 0) * 2.2046226218;
const lbToKg = (lb) => Number((Number(lb || 0) / 2.2046226218).toFixed(2));
const nearestOption = (value, options) => options.reduce((best, option) => Math.abs(option - value) < Math.abs(best - value) ? option : best, options[0]);
const displayWeight = (kg, unit) => unit === 'lb' ? Number(kgToLb(kg).toFixed(1)) : Number(kg || 0);
function languageKey(settings = {}) {
  const locale = settings?.locale || fallbackDisplay.locale;
  const map = { en: 'en-US', vi: 'vi-VN', zh: 'zh-CN', es: 'es-ES', pt: 'pt-BR', ja: 'ja-JP', ko: 'ko-KR', de: 'de-DE', fr: 'fr-FR', ru: 'ru-RU' };
  const prefix = locale.split('-')[0];
  return map[prefix] || 'vi-VN';
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

const fallbackDisplay = { locale: 'vi-VN', timezone: 'Asia/Ho_Chi_Minh' };
const timezoneOptions = [
  ['Asia/Ho_Chi_Minh', 'Viet Nam'],
  ['Asia/Bangkok', 'Thailand'],
  ['Asia/Tokyo', 'Japan'],
  ['Asia/Singapore', 'Singapore'],
  ['UTC', 'UTC']
];
const localeOptions = [
  ['en-US', 'English'],
  ['vi-VN', 'Tiếng Việt (Vietnamese)'],
  ['zh-CN', '简体中文 (Chinese Simplified)'],
  ['es-ES', 'Español (Spanish)'],
  ['pt-BR', 'Português Brasil (Portuguese)'],
  ['ja-JP', '日本語 (Japanese)'],
  ['ko-KR', '한국어 (Korean)'],
  ['de-DE', 'Deutsch (German)'],
  ['fr-FR', 'Français (French)'],
  ['ru-RU', 'Русский (Russian)'],
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

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  if (!response.ok) throw new Error((await response.json()).error || 'Lỗi API');
  return response.json();
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
    alert: (message, options = {}) => openDialog({ kind: 'alert', title: options.title || 'Thông báo', message, okText: options.okText || 'OK' }),
    confirm: (message, options = {}) => openDialog({ kind: 'confirm', title: options.title || 'Xác nhận', message, okText: options.okText || 'Có', cancelText: options.cancelText || 'Không' }),
    prompt: (message, options = {}) => openDialog({ kind: 'prompt', title: options.title || message, message: options.description || '', inputType: options.type || 'text', defaultValue: options.defaultValue || '', okText: options.okText || 'Tiếp tục', cancelText: options.cancelText || 'Huỷ' })
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

function App() {
  const savedUser = JSON.parse(localStorage.getItem('familyGymUser') || sessionStorage.getItem('familyGymUser') || 'null');
  const [user, setUser] = useState(savedUser);
  const [tab, setTab] = useState('home');
  const [boot, setBoot] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const [workout, setWorkout] = useState(null);

  useEffect(() => {
    if (!user) return;
    api(`/api/bootstrap?userId=${user.id}`).then(setBoot).catch(() => {
      localStorage.removeItem('familyGymUser');
      sessionStorage.removeItem('familyGymUser');
      setUser(null);
    });
  }, [user, refresh]);

  if (!user) return <Login onLogin={setUser} />;
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
    if (saved?.sessionId && saved.view === 'exercise') {
      const active = await api(`/api/sessions/active?userId=${user.id}`);
      const savedStillActive = (active?.sessions || []).some((item) => item.session.id === saved.sessionId);
      if (savedStillActive) {
        setTab('start');
        setWorkout({
          sessionId: saved.sessionId,
          initialIndex: saved.index || 0,
          initialView: 'exercise',
          returnTab: 'start'
        });
        return;
      }
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
  const savedLocale = (() => { try { const u = JSON.parse(localStorage.getItem('familyGymUser') || 'null'); return u?.locale || 'vi-VN'; } catch { return 'vi-VN'; } })();
  const t = createT(savedLocale);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    try {
      const result = await api('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      const storage = remember ? localStorage : sessionStorage;
      localStorage.removeItem('familyGymUser');
      sessionStorage.removeItem('familyGymUser');
      storage.setItem('familyGymUser', JSON.stringify(result.user));
      onLogin(result.user);
    } catch (err) {
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

  return (
    <header className="mb-5 flex items-center justify-between">
      <div>
        <p className="text-sm text-teal-950">{formatDateTime(now, boot.settings, { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p>
        <h1 className="text-2xl font-bold">{user.name}</h1>
        <p className="text-sm text-teal-950">{getModeLabels(t)[boot.settings.schedule_mode]} · {t('exercises_count', boot.exerciseCount)}</p>
      </div>
      <div className="relative" ref={menuRef}>
        <button onClick={() => setOpen((current) => !current)} className="grid h-12 w-12 place-items-center overflow-hidden rounded-full bg-emerald-500 text-green-950 font-bold">
          {avatarContent(user.avatar)}
        </button>
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
  const [data, setData] = useState(null);
  const [groups, setGroups] = useState([]);
  const [routineData, setRoutineData] = useState({ routines: [], rules: [] });
  const [clock, setClock] = useState(new Date());

  useEffect(() => {
    api(`/api/dashboard?userId=${userId}`).then(setData);
    api(`/api/groups?userId=${userId}`).then(setGroups);
    api(`/api/routines?userId=${userId}`).then(setRoutineData);
  }, [userId, refresh]);
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const startRoutine = async (routine, initialIndex = 0, initialView = 'list') => {
    const session = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ userId, routineId: routine.id, scheduleMode: 'FREE' }) });
    onStart({ sessionId: session.id, initialIndex, initialView });
  };
  const startGroup = async (group) => {
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
      <TodayWorkoutCard suggestion={suggestion} clock={clock} todaySummary={todaySummary} onStartRoutine={startRoutine} settings={settings} />
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

function TodayWorkoutCard({ suggestion, clock, todaySummary, onStartRoutine, settings }) {
  const t = useLang();
  const summaryByExercise = new Map(todaySummary.map((row) => [row.exercise_id, row]));
  const routine = suggestion?.routine;
  const doneCount = routine?.exercises.filter((exercise) => summaryByExercise.has(exercise.id)).length || 0;
  const exerciseIndexById = new Map((routine?.exercises || []).map((exercise, index) => [exercise.id, index]));

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
              <div key={group.id} className="rounded-lg border border-white/10 bg-white/6 p-3">
                <div className="flex items-center gap-2">
                  <strong>{group.name}</strong>
                </div>
                <div className="mt-3 grid gap-2">
                  {group.exercises.slice(0, 5).map((exercise) => {
                    const summary = summaryByExercise.get(exercise.id);
                    const done = Boolean(summary);
                    return (
                      <div key={exercise.id} className={`flex items-center gap-3 rounded-md border p-2 ${done ? 'border-lime-300/70 bg-lime-300/15' : 'border-orange-200/40 bg-black/20'}`}>
                        {exerciseMediaUrl(exercise) ? <img src={exerciseMediaUrl(exercise)} className="h-12 w-12 rounded bg-white object-contain" /> : <span className="grid h-12 w-12 place-items-center rounded bg-white text-2xl">{exercise.customIcon || '🏋️'}</span>}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold">{exercise.name}</p>
                          <p className={`text-xs font-semibold ${done ? 'text-lime-100' : 'text-orange-100'}`}>
                            {done ? `${t('sets_logged', summary.sets)} · max ${summary.max_weight} kg` : t('today_not_done')}
                          </p>
                        </div>
                        <span className={`rounded px-2 py-1 text-xs font-black ${done ? 'bg-lime-300 text-green-950' : 'bg-orange-100 text-orange-900'}`}>
                          {done ? t('today_done') : t('today_not_done')}
                        </span>
                        <button
                          className="grid h-9 w-9 shrink-0 place-items-center rounded bg-[#f05a28] text-white"
                          title="Vào bài tập"
                          onClick={() => onStartRoutine(routine, exerciseIndexById.get(exercise.id) || 0, 'exercise')}
                        >
                          <Play size={16} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <button className="primary-light" onClick={() => onStartRoutine(routine)}>{t('today_start')}</button>
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
                <img src={thumbs[0]?.imageUrl} className="h-14 w-14 rounded-md bg-slate-50 object-contain ring-1 ring-slate-200" />
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-slate-950">{item.name}</p>
                  <p className="text-sm text-teal-950">{t('exercises', item.exercises.length)}</p>
                </div>
                <div className="flex -space-x-2">
                  {thumbs.map((exercise) => <img key={exercise.id} src={exercise.imageUrl} className="h-9 w-9 rounded-full border-2 border-white bg-slate-50 object-contain" />)}
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
  const [groups, setGroups] = useState([]);
  const [routineData, setRoutineData] = useState({ routines: [] });
  const [activeSessions, setActiveSessions] = useState([]);

  useEffect(() => {
    api(`/api/groups?userId=${userId}`).then(setGroups);
    api(`/api/routines?userId=${userId}`).then(setRoutineData);
    api(`/api/sessions/active?userId=${userId}`).then((payload) => setActiveSessions(payload?.sessions || (payload?.session ? [payload] : [])));
  }, [userId, refresh]);

  const startRoutine = async (routine) => {
    const session = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ userId, routineId: routine.id, scheduleMode: 'FREE' }) });
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
        <h1 className="text-2xl font-black">{activeSessions.length ? t('start_continue') : t('start_begin')}</h1>
        <p className="mt-2 text-sm text-emerald-100">{activeSessions.length ? t('start_active', activeSessions.length) : t('start_no_active')}</p>
      </div>
      {activeSessions.length ? (
        <div className="grid gap-3">
          {activeSessions.map((active) => {
            const title = active.routine?.name || active.group?.name || t('session_free_label');
            const doneCount = active.exercises.filter((exercise) => Number(exercise.completedSets || 0) > 0).length;
            const totalSets = active.exercises.reduce((sum, exercise) => sum + Number(exercise.completedSets || 0), 0);
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
                <div className="mt-4 grid gap-2">
                  {active.exercises.map((exercise, exerciseIndex) => (
                    <button
                      key={`${active.session.id}-${exercise.id}-${exerciseIndex}`}
                      className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left ${exercise.completedSets ? 'border-emerald-300 bg-emerald-50' : 'border-orange-200 bg-orange-50'}`}
                      onClick={() => onStart({ sessionId: active.session.id, initialIndex: exerciseIndex, initialView: 'exercise' })}
                    >
                      {exerciseMediaUrl(exercise) ? <img src={exerciseMediaUrl(exercise)} className="h-12 w-12 rounded bg-white object-contain" /> : <span className="grid h-12 w-12 place-items-center rounded bg-white text-2xl">{exercise.customIcon || '🏋️'}</span>}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-bold">{exercise.name}</p>
                        <p className={`text-sm font-semibold ${exercise.completedSets ? 'text-emerald-800' : 'text-orange-800'}`}>
                          {exercise.completedSets ? t('exercise_set_done', exercise.completedSets) : t('exercise_not_done')} · {exercise.groupName || exercise.target} · {exercise.equipment}
                        </p>
                      </div>
                      <span className={`rounded px-3 py-1 text-xs font-black ${exercise.completedSets ? 'bg-emerald-600 text-white' : 'bg-[#f05a28] text-white'}`}>
                        {exercise.completedSets ? t('continue_exercise') : t('start_exercise')}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="mt-4 grid gap-2 md:grid-cols-2">
                  <button className="primary" onClick={() => completeActiveSession(active)}>{t('end_session')}</button>
                  <button className="danger-btn" onClick={() => deleteActiveSession(active)}>{t('delete_session')}</button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <FreeTraining routines={routineData.routines} groups={groups} onStartRoutine={startRoutine} onStartGroup={startGroup} />
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

  // Today-centered: -3 … today … +3 (7 days), shifted by offset
  const dayCount = isRolling ? 3 : 7;
  const centerOffset = isRolling ? 0 : -3; // today at index 3 for fixed/free

  const scheduleItems = Array.from({ length: dayCount }, (_, itemIndex) => {
    const date = new Date(startOfToday);
    date.setDate(startOfToday.getDate() + centerOffset + itemIndex + offset);
    const weekdayIndex = date.getDay() === 0 ? 6 : date.getDay() - 1;
    const key = localIsoDate(date);
    const dayHistory = historyByDay.get(key) || [];
    const done = doneDays.has(key);
    const mainDone = dayHistory[0];
    const fixedRoutine = fixedByDay.get(weekdayIndex);
    const rollingRule = isRolling && rollingRules.length
      ? rollingRules[(Math.max(0, (suggestion?.rollingIndex || 1) - 1) + itemIndex) % rollingRules.length]
      : null;
    const rollingRoutine = rollingRule ? routineById.get(rollingRule.routine_id) : null;
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
      imageUrl: done ? mainDone?.imageUrl : routine?.exercises?.[0]?.imageUrl,
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
        {!isRolling && (
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
        )}
      </div>
      <div className={`week-plan-grid ${isRolling ? 'rolling' : ''}`}>
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
                <img src={exercise.imageUrl} className="h-12 w-12 rounded bg-white object-contain" />
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
  const [groups, setGroups] = useState([]);
  const [selectedExercise, setSelectedExercise] = useState(null);
  const [editingExercise, setEditingExercise] = useState(null);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [visibleCount, setVisibleCount] = useState(60);
  const [previewGifId, setPreviewGifId] = useState(null);
  const [pinnedGifIds, setPinnedGifIds] = useState(() => new Set());

  const refreshLibrary = () => {
    setVisibleCount(60);
    setPreviewGifId(null);
    setPinnedGifIds(new Set());
    api(`/api/exercises?userId=${userId}&q=${encodeURIComponent(q)}&target=${encodeURIComponent(target)}`).then(setItems);
    api(`/api/exercises/meta?userId=${userId}`).then(setMeta);
  };

  useEffect(() => { api(`/api/exercises/meta?userId=${userId}`).then(setMeta); api(`/api/groups?userId=${userId}`).then(setGroups); }, [userId]);
  useEffect(() => {
    setSelectedExercise(null);
    refreshLibrary();
  }, [q, target, userId]);

  const addToGroup = async (groupId, exerciseId) => {
    await api(`/api/groups/${groupId}/exercises`, { method: 'POST', body: JSON.stringify({ exerciseId }) });
    api(`/api/groups?userId=${userId}`).then(setGroups);
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
          <select onChange={(e) => e.target.value && addToGroup(e.target.value, selectedExercise.id)} className="input mt-4 py-2 text-sm">
            <option value="">{t('lib_add_to_group_option')}</option>
            {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
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
                <img
                  src={isPlayingGif && exercise.displayMedia !== 'image' ? exercise.gifUrl || exerciseMediaUrl(exercise) : exerciseMediaUrl(exercise)}
                  alt={exercise.name}
                  className="h-24 w-24 rounded-md bg-white object-contain"
                  loading={isPlayingGif ? 'eager' : 'lazy'}
                  onPointerEnter={() => playSmallGif(exercise)}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    playSmallGif(exercise);
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    pinSmallGif(exercise);
                  }}
                />
              ) : (
                <div className="grid h-24 w-24 place-items-center rounded-md bg-white text-4xl ring-1 ring-slate-200">{exercise.customIcon || '🏋️'}</div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-bold leading-tight">{exerciseDisplayName(exercise, settings)}</h3>
                  {exercise.isCustom && <span className="rounded bg-orange-100 px-2 py-0.5 text-[11px] font-black text-orange-600">{t('lib_custom_badge')}</span>}
                </div>
                <p className="mt-1 text-sm text-slate-500">{exercise.target} · {exercise.equipment}</p>
                <select onClick={(event) => event.stopPropagation()} onChange={(e) => e.target.value && addToGroup(e.target.value, exercise.id)} className="input mt-3 py-2 text-sm">
                  <option value="">{t('lib_add_to_group_option')}</option>
                  {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
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
      <summary className="cursor-pointer text-sm font-bold text-slate-900">Instructions</summary>
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
      <img src={exercise.imageUrl} className="h-14 w-14 rounded bg-white object-contain" />
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
  const [groups, setGroups] = useState([]);
  const [routineData, setRoutineData] = useState({ routines: [], rules: [] });
  const [groupName, setGroupName] = useState('');
  const [routineName, setRoutineName] = useState('');
  const [selectedGroups, setSelectedGroups] = useState([]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const load = () => {
    api(`/api/groups?userId=${userId}`).then(setGroups);
    api(`/api/routines?userId=${userId}`).then(setRoutineData);
  };
  useEffect(load, [userId]);

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
    await api(`/api/groups/${groupId}/exercises/${exerciseId}`, { method: 'DELETE' });
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
              <div className="font-bold">{group.name} · {t('builder_exercises_count', group.exercises.length)}</div>
              <div className="flex flex-wrap gap-2">
                <button className="small-action" onClick={() => startGroup(group)}><Play size={16} /> {t('start_exercise')}</button>
                <button className="small-danger" onClick={() => deleteGroup(group.id)}><Trash2 size={16} /> {t('delete')}</button>
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
                  <img key={exercise.id} src={exercise.imageUrl} title={exercise.name} className="h-8 w-8 rounded-full border-2 border-white bg-white object-contain" />
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
                  <img src={routine.exercises[0]?.imageUrl} className="h-12 w-12 rounded-md bg-slate-50 object-contain ring-1 ring-slate-200" />
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold">{routine.name}</h3>
                    <p className="text-sm text-slate-500">{routine.groups.length} group · {t('builder_exercises_count', routine.exercises.length)}</p>
                  </div>
                  <button className="small-action" onClick={() => startRoutine(routine)}><Play size={16} /> {t('start_exercise')}</button>
                  <button className="small-danger" onClick={() => deleteRoutine(routine.id)}><Trash2 size={16} /> {t('delete')}</button>
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
              <img src={routine.exercises[0]?.imageUrl} className="h-11 w-11 rounded-md bg-slate-50 object-contain ring-1 ring-slate-200" />
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

function WorkoutLogger({ userId, workout, settings, onClose }) {
  const t = useLang();
  const dialog = useAppDialog();
  const [data, setData] = useState(null);
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
  const previousTimer = React.useRef(0);
  const wakeLock = React.useRef(null);
  const defaultWeightUnit = settings?.default_weight_unit || 'kg';
  const manualUnitLabel = defaultWeightUnit === 'lb' ? 'Lb' : 'Kg';

  useEffect(() => { api(`/api/sessions/${workout.sessionId}?userId=${userId}`).then(setData); }, [workout.sessionId, userId]);
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
  useEffect(() => {
    if (!timer) return;
    const id = setInterval(() => setTimer((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(id);
  }, [timer]);
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
  useEffect(() => {
    let cancelled = false;
    const requestWakeLock = async () => {
      if (!settings?.keep_screen_awake || !navigator.wakeLock) return;
      try {
        wakeLock.current = await navigator.wakeLock.request('screen');
      } catch {
        wakeLock.current = null;
      }
    };
    requestWakeLock();
    return () => {
      cancelled = true;
      if (!cancelled && wakeLock.current) wakeLock.current.release();
      else if (wakeLock.current) wakeLock.current.release();
      wakeLock.current = null;
    };
  }, [settings?.keep_screen_awake, workout.sessionId]);

  if (!data) return <div className="panel">{t('loading')}</div>;
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
    setIndex(nextIndex);
    setView('exercise');
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
    if (set.done) return;
    const result = await api(`/api/sessions/${workout.sessionId}/logs`, { method: 'POST', body: JSON.stringify({ userId, exerciseId: exercise.id, weightKg: set.weightKg, weightUnit: currentWeightUnit(), reps: set.reps }) });
    await saveWeightPreference({ defaultReps: set.reps, defaultWeightKg: set.weightKg, weightMode });
    setSets((old) => old.map((item) => item.setIndex === set.setIndex ? { ...item, id: result.id, done: true } : item));
    setData((current) => current ? {
      ...current,
      exercises: current.exercises.map((item) => (
        item.id === exercise.id
          ? { ...item, completedSets: Number(item.completedSets || 0) + 1 }
          : item
      ))
    } : current);
    setTimer(Number(settings?.rest_seconds || 60));
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
    const result = await api(`/api/sessions/${workout.sessionId}/complete`, { method: 'POST', body: JSON.stringify({ userId }) });
    localStorage.removeItem(`familyGymWorkout:${userId}`);
    onClose();
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

  return (
    <section className="space-y-4 text-black">
      <div className="flex items-center justify-between">
        <button className="ghost-btn" onClick={view === 'exercise' ? () => setView('list') : exitWorkout}>{view === 'exercise' ? t('workout_nav_list') : t('workout_nav_exit')}</button>
        <span className="text-sm text-slate-600">{index + 1}/{data.exercises.length}</span>
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
          <h1 className="text-2xl font-black">{data.routine?.name || t('workout_session_title')}</h1>
          <p className="text-sm text-slate-500">{t('workout_list_hint')}</p>
          {data.exercises.map((item, itemIndex) => (
            <button key={`${item.id}-${itemIndex}`} className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left ${item.completedSets ? 'border-emerald-300 bg-emerald-50' : 'border-orange-200 bg-orange-50'}`} onClick={() => openExercise(itemIndex)}>
              {exerciseMediaUrl(item) ? <img src={exerciseMediaUrl(item)} className="h-14 w-14 rounded-md bg-slate-50 object-contain" /> : <span className="grid h-14 w-14 place-items-center rounded-md bg-white text-2xl">{item.customIcon || '🏋️'}</span>}
              <div className="min-w-0 flex-1">
                <p className="font-bold">{item.name}</p>
                <p className={`text-sm font-semibold ${item.completedSets ? 'text-emerald-800' : 'text-orange-800'}`}>
                  {item.completedSets ? t('workout_set_done', item.completedSets) : t('workout_not_done')} · {item.groupName || item.target} · {item.equipment}
                </p>
              </div>
              <span className={`rounded px-3 py-1 text-xs font-black ${item.completedSets ? 'bg-emerald-600 text-white' : 'bg-[#f05a28] text-white'}`}>
                {item.completedSets ? t('workout_continue_btn') : t('workout_start_btn')}
              </span>
            </button>
          ))}
          <button className="primary" onClick={complete}>{t('workout_end_btn')}</button>
        </div>
      ) : (
        <div className="workout-card space-y-4">
          <div className="overflow-hidden rounded-xl bg-slate-50">
            {exerciseMediaUrl(exercise) ? (
              <img src={paused || exercise.displayMedia === 'image' ? exerciseMediaUrl(exercise) : exercise.gifUrl || exerciseMediaUrl(exercise)} alt={exercise.name} className="mx-auto h-[300px] max-h-[45vh] w-full max-w-xl object-contain md:h-[360px]" />
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
              <span>Set</span><span>Previous</span><span>{weightMode === 'LB' ? 'Lb' : 'Kg'}</span><span>Reps</span><span /><span />
            </div>
            <div className="space-y-2">
              {sets.map((set) => {
                const previous = previousSets[set.setIndex - 1];
                return (
                  <div key={set.setIndex} className={`set-table-row ${set.done ? 'done' : ''}`}>
                    <strong className="set-number">{set.setIndex}</strong>
                    <span className="set-previous">{previous ? `${previous.weight_kg}kg × ${previous.reps}` : '-'}</span>
                    {weightMode === 'MANUAL' ? (
                      <input
                        className="manual-weight-input"
                        type="number"
                        step="0.1"
                        value={defaultWeightUnit === 'lb' ? Number(kgToLb(set.weightKg).toFixed(1)) : set.weightKg ?? manualWeight}
                        onChange={(event) => {
                          const value = Number(event.target.value || 0);
                          updateSet(set.setIndex, { weightKg: defaultWeightUnit === 'lb' ? lbToKg(value) : value });
                        }}
                        onBlur={(event) => updateManualWeight(event.target.value)}
                      />
                    ) : weightMode === 'LB' ? (
                      <WheelPicker value={nearestOption(kgToLb(set.weightKg), lbOptions)} options={lbOptions} suffix="lb" onChange={(value) => updateSet(set.setIndex, { weightKg: lbToKg(value) })} />
                    ) : (
                      <WheelPicker value={nearestOption(set.weightKg, kgOptions)} options={kgOptions} suffix="kg" onChange={(value) => updateSet(set.setIndex, { weightKg: value })} />
                    )}
                    <WheelPicker value={set.reps} options={repOptions} onChange={(value) => updateSet(set.setIndex, { reps: value })} />
                    <button className={`set-check ${set.done ? 'done' : ''}`} onClick={() => completeSet(set)}><Check size={22} /></button>
                    <button className="tiny-btn" disabled={set.done || sets.length <= 1} onClick={() => removeDraftSet(set.setIndex)}><Trash2 size={15} /></button>
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

          <div className="grid grid-cols-2 gap-2">
            <button className="ghost-btn" disabled={index === 0} onClick={() => openExercise(index - 1)}>{t('workout_prev_btn')}</button>
            <button className="ghost-btn" disabled={index >= data.exercises.length - 1} onClick={() => openExercise(index + 1)}>{t('workout_next_btn')}</button>
          </div>
          <button className="primary" onClick={complete}>{t('workout_end_btn')}</button>
        </div>
      )}
      {timer > 0 && <div className={`timer-pop ${settings?.countdown_3s && timer <= 3 ? 'urgent' : ''}`}>{settings?.countdown_3s && timer <= 3 ? `${t('workout_timer_prepare')} ` : `${t('workout_timer_rest')} `}{timer}s <button onClick={() => setTimer((v) => v + 30)}>+30s</button><button onClick={() => setTimer(0)}>{t('workout_timer_off')}</button></div>}
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
                  <button className="small-action mt-2" onClick={() => setRangeKey('all')}>Xem toàn bộ lịch sử</button>
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
        {exerciseMediaUrl(selected) && <img src={exerciseMediaUrl(selected)} alt="" />}
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
              {exerciseMediaUrl(exercise) && <img src={exerciseMediaUrl(exercise)} alt="" />}
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
  const [progressiveOverload, setProgressiveOverload] = useState(Boolean(settings.progressive_overload));
  const [soundRestDone, setSoundRestDone] = useState(Boolean(settings.sound_rest_done));
  const [countdown3s, setCountdown3s] = useState(Boolean(settings.countdown_3s));
  const [autoNextSet, setAutoNextSet] = useState(Boolean(settings.auto_next_set));
  const [settingsError, setSettingsError] = useState('');
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
    const updated = await api(`/api/users/${userId}`, { method: 'PATCH', body: JSON.stringify(body) });
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
        progressiveOverload,
        soundRestDone,
        countdown3s,
        autoNextSet
      })
    });
    localStorage.setItem('familyGymUser', JSON.stringify(updated));
    location.reload();
  };
  const pickAvatar = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setAvatarPreview(String(reader.result));
    reader.readAsDataURL(file);
  };
  const importBackup = async (file) => {
    if (!file) return;
    const backup = JSON.parse(await file.text());
    if (!(await dialog.confirm(t('settings_import_confirm')))) return;
    await api('/api/backup/import', {
      method: 'POST',
      body: JSON.stringify({ userId, backup })
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
        <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Để trống nếu không đổi" />
        <label className="label mt-3">{t('settings_password_again')}</label>
        <input className="input" type="password" value={passwordAgain} onChange={(e) => setPasswordAgain(e.target.value)} placeholder="Nhập lại mật khẩu mới" />
        <label className="label mt-3">{t('settings_gender')}</label>
        <select className="input" value={gender} onChange={(event) => setGender(event.target.value)}>
          <option value="">-</option>
          <option value="male">{t('settings_gender_m')}</option>
          <option value="female">{t('settings_gender_f')}</option>
          <option value="other">{t('settings_gender_other')}</option>
        </select>
        <label className="label mt-3">{t('settings_birthdate')}</label>
        <input className="input" type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} />
        <label className="label mt-3">{t('settings_height')}</label>
        {heightUnit === 'ft-in' ? (
          <div className="grid grid-cols-2 gap-2">
            <input className="input" type="number" min="1" max="8" value={heightFeet} onChange={(event) => setHeightFeet(event.target.value)} placeholder="feet" />
            <input className="input" type="number" min="0" max="11" value={heightInches} onChange={(event) => setHeightInches(event.target.value)} placeholder="inch" />
          </div>
        ) : (
          <input className="input" type="number" min="50" max="260" step="0.5" value={heightCm} onChange={(event) => setHeightCm(event.target.value)} placeholder="Ví dụ: 170" />
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
        <SwitchSetting label={t('settings_progressive_label')} checked={progressiveOverload} onChange={setProgressiveOverload} />
      </SettingsGroup>

      <SettingsGroup title={t('settings_timer_section')}>
        <p className="mb-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">{t('settings_timer_note')}</p>
        <SwitchSetting label={t('settings_sound_rest_label')} checked={soundRestDone} onChange={setSoundRestDone} />
        <SwitchSetting label={t('settings_countdown_label')} checked={countdown3s} onChange={setCountdown3s} />
        <SwitchSetting label={t('settings_auto_next_label')} checked={autoNextSet} onChange={setAutoNextSet} />
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
        <button className="primary" onClick={() => window.open(`/api/export/excel?userId=${userId}`, '_blank')}>{t('settings_export_excel')}</button>
        <button className="ghost-btn" onClick={() => window.open(`/api/backup?userId=${userId}`, '_blank')}>{t('settings_export_json')}</button>
        <label className="ghost-btn cursor-pointer">
          {t('settings_import_data')}
          <input className="hidden" type="file" accept="application/json,.json" onChange={(event) => importBackup(event.target.files?.[0])} />
        </label>
        <p className="mt-2 text-sm text-slate-600">{t('settings_data_note')}</p>
      </SettingsGroup>

      {settingsError && <p className="rounded-md bg-red-50 p-3 text-sm font-bold text-red-700">{settingsError}</p>}
      <button
        onClick={saveAll}
        className="flex w-full items-center justify-center gap-2 rounded-md px-4 py-3 font-bold text-white"
        style={{background:'linear-gradient(135deg,#2563eb,#7c3aed)', boxShadow:'0 4px 14px rgba(124,58,237,0.4)'}}
      >
        {t('settings_save')} · Save changes
      </button>
      {boot.activeUser.role === 'ADMIN' && <div className="panel">
        <h2 className="section-title">{t('settings_users')}</h2>
        <button className="primary" onClick={addUser}>{t('settings_add_user')}</button>
        <AdminUsers users={boot.users} adminId={userId} />
      </div>}
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

function NumberSetting({ label, value, onChange, min, max }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className="input" type="number" min={min} max={max} value={value} onChange={(event) => onChange(event.target.value)} />
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

createRoot(document.getElementById('root')).render(<DialogProvider><App /></DialogProvider>);









