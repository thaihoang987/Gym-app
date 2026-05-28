import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
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
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import './styles.css';

const dayLabels = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const modeLabels = { FREE: 'Tự do', FIXED: 'Cố định', ROLLING: 'Cuốn chiếu' };
const iconChoices = ['💪', '🏋️', '🔥', '🦵', '🫀', '⚡', '🎯', '🧱', '✅', '🏆', '🥇', '📈', '🧘', '🤸', '🚴', '🏃', '🦾', '🔩', '⚖️', '⏱️'];
const kgOptions = Array.from({ length: 121 }, (_, index) => index * 2.5);
const repOptions = Array.from({ length: 100 }, (_, index) => index + 1);

const fallbackDisplay = { locale: 'vi-VN', timezone: 'Asia/Ho_Chi_Minh' };
const timezoneOptions = [
  ['Asia/Ho_Chi_Minh', 'Viet Nam'],
  ['Asia/Bangkok', 'Thailand'],
  ['Asia/Tokyo', 'Japan'],
  ['Asia/Singapore', 'Singapore'],
  ['UTC', 'UTC']
];
const localeOptions = [
  ['vi-VN', 'Tieng Viet - Viet Nam'],
  ['en-US', 'English - United States'],
  ['th-TH', 'Thai - Thailand'],
  ['ja-JP', 'Japanese - Japan']
];
const rangeOptions = [
  ['1d', '1 ngày', 1],
  ['7d', '7 ngày', 7],
  ['14d', '2 tuần', 14],
  ['1m', '1 tháng', 30],
  ['6m', '6 tháng', 183],
  ['1y', '1 năm', 365],
  ['2y', '2 năm', 730],
  ['3y', '3 năm', 1095],
  ['5y', '5 năm', 1825]
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

function bmiFeedback(bmi) {
  if (!bmi) return { label: 'Chưa đủ dữ liệu', tone: 'neutral', text: 'Nhập chiều cao và cân nặng để app tính BMI cho bạn.' };
  if (bmi < 16) return { label: 'Rất thấp', tone: 'danger', text: 'BMI đang quá thấp, nên ưu tiên phục hồi dinh dưỡng và theo dõi sức khoẻ sát hơn.' };
  if (bmi < 18.5) return { label: 'Thấp', tone: 'warning', text: 'Bạn đang hơi thiếu cân, tăng cơ chậm rãi cùng ăn đủ protein sẽ hợp lý hơn.' };
  if (bmi < 23) return { label: 'Rất tốt', tone: 'good', text: 'BMI nằm trong vùng rất tốt, tiếp tục giữ nhịp tập và cân nặng ổn định.' };
  if (bmi < 25) return { label: 'Tốt', tone: 'ok', text: 'BMI vẫn ổn, nếu mục tiêu là nét hơn thì giảm mỡ nhẹ và giữ sức mạnh là hướng đẹp.' };
  if (bmi < 30) return { label: 'Cần cải thiện', tone: 'warning', text: 'BMI hơi cao, nên theo dõi vòng eo, volume tập và giảm cân từ từ để bền hơn.' };
  return { label: 'Rủi ro cao', tone: 'danger', text: 'BMI đang cao, nên ưu tiên thói quen ăn uống, vận động đều và cân nhắc tư vấn chuyên môn.' };
}

function filterByRange(rows, field, rangeKey) {
  const option = rangeOptions.find(([key]) => key === rangeKey);
  if (!option) return rows;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - option[2]);
  return rows.filter((row) => {
    const date = parseServerDate(row[field]);
    return date && date >= cutoff;
  });
}

function displayPrefs(settings = {}) {
  return {
    locale: settings.locale || fallbackDisplay.locale,
    timeZone: settings.timezone || fallbackDisplay.timezone
  };
}

function parseServerDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const text = String(value);
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text.replace(' ', 'T')}Z`);
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
  return date.toLocaleTimeString(prefs.locale, { timeZone: prefs.timeZone, hour: '2-digit', minute: '2-digit', ...options });
}

function formatDateTime(value, settings, options = {}) {
  const date = parseServerDate(value);
  if (!date || Number.isNaN(date.getTime())) return '';
  const prefs = displayPrefs(settings);
  return date.toLocaleString(prefs.locale, { timeZone: prefs.timeZone, ...options });
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
      return (
        <div className="panel">
          <h2 className="section-title">Có lỗi hiển thị</h2>
          <p className="text-sm text-slate-700">{this.state.error.message}</p>
          <button className="primary mt-3" onClick={() => this.setState({ error: null })}>Thử lại</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const savedUser = JSON.parse(localStorage.getItem('familyGymUser') || 'null');
  const [user, setUser] = useState(savedUser);
  const [tab, setTab] = useState('home');
  const [boot, setBoot] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const [workout, setWorkout] = useState(null);

  useEffect(() => {
    if (!user) return;
    api(`/api/bootstrap?userId=${user.id}`).then(setBoot).catch(() => {
      localStorage.removeItem('familyGymUser');
      setUser(null);
    });
  }, [user, refresh]);

  if (!user) return <Login onLogin={setUser} />;
  if (!boot) return <div className="min-h-screen bg-app grid place-items-center text-slate-950">Đang tải...</div>;

  const nav = [
    ['home', Home, 'Home'],
    ['start', Play, 'Tiếp tục tập'],
    ['library', Library, 'Bài tập'],
    ['builder', Dumbbell, 'Lịch tập'],
    ['analytics', BarChart3, 'Thống kê'],
    ['settings', Settings, 'Cài đặt']
  ];

  return (
    <div className="min-h-screen bg-app text-slate-950">
      <main className="mx-auto min-h-screen w-full max-w-md bg-[#f4f6f1] px-4 pb-40 pt-5 text-slate-950 md:max-w-6xl md:px-8">
        {workout ? (
          <WorkoutLogger userId={user.id} workout={workout} onClose={() => { setWorkout(null); setRefresh((v) => v + 1); }} />
        ) : (
          <ErrorBoundary key={tab}>
            <Header user={user} boot={boot} onLogout={() => { localStorage.removeItem('familyGymUser'); setUser(null); }} />
            {tab === 'home' && <Dashboard userId={user.id} onStart={setWorkout} refresh={refresh} settings={boot.settings} onChanged={() => setRefresh((v) => v + 1)} />}
            {tab === 'start' && <StartWorkoutPage userId={user.id} onStart={setWorkout} refresh={refresh} settings={boot.settings} />}
            {tab === 'library' && <ExerciseLibrary userId={user.id} />}
            {tab === 'builder' && <Builder userId={user.id} boot={boot} onStart={setWorkout} onChanged={() => setRefresh((v) => v + 1)} />}
            {tab === 'analytics' && <Analytics userId={user.id} settings={boot.settings} />}
            {tab === 'settings' && <SettingsPage userId={user.id} boot={boot} onChanged={() => setRefresh((v) => v + 1)} />}
          </ErrorBoundary>
        )}
      </main>
      {!workout && (
        <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-md border-t border-slate-200 bg-white/95 px-3 pb-3 pt-2 backdrop-blur md:max-w-6xl">
          <div className="grid grid-cols-6 gap-1">
            {nav.map(([id, Icon, label]) => (
              <button key={id} onClick={() => setTab(id)} className={`nav-btn ${tab === id ? 'active' : ''}`}>
                <Icon size={20} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}

function Login({ onLogin }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    try {
      const result = await api('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      localStorage.setItem('familyGymUser', JSON.stringify(result.user));
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
            <p className="text-sm text-teal-950">Đăng nhập thành viên</p>
          </div>
        </div>
        <label className="label">Tên đăng nhập</label>
        <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} />
        <label className="label mt-4">Mật khẩu</label>
        <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <button className="primary mt-5">Đăng nhập</button>
        <p className="mt-4 text-xs text-teal-950">Mặc định lần đầu: admin / admin123</p>
      </form>
    </div>
  );
}

function Header({ user, boot, onLogout }) {
  const now = new Date();
  const [open, setOpen] = useState(false);
  return (
    <header className="mb-5 flex items-center justify-between">
      <div>
        <p className="text-sm text-teal-950">{formatDate(now, boot.settings, { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}</p>
        <h1 className="text-2xl font-bold">{user.name}</h1>
        <p className="text-sm text-teal-950">{modeLabels[boot.settings.schedule_mode]} · {boot.exerciseCount} bài tập</p>
      </div>
      <div className="relative">
        <button onClick={() => setOpen((current) => !current)} className="grid h-12 w-12 place-items-center overflow-hidden rounded-full bg-emerald-500 text-green-950 font-bold">
          {avatarContent(user.avatar)}
        </button>
        {open && (
          <div className="avatar-menu">
            <button onClick={onLogout}><LogOut size={17} /> Sign out</button>
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

  const startRoutine = async (routine) => {
    const session = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ userId, routineId: routine.id, scheduleMode: 'FREE' }) });
    onStart({ sessionId: session.id });
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
  const [weight, setWeight] = useState('');
  const [unit, setUnit] = useState('kg');
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
          <label className="label">Cân nặng</label>
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
          <span>Ngày tháng</span>
          <span>Cân nặng</span>
        </div>
        {history.length === 0 && <p className="py-2 text-sm text-slate-600">Chưa có lịch sử.</p>}
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
  const summaryByExercise = new Map(todaySummary.map((row) => [row.exercise_id, row]));
  const routine = suggestion?.routine;
  const doneCount = routine?.exercises.filter((exercise) => summaryByExercise.has(exercise.id)).length || 0;

  return (
    <div className="panel-green">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-emerald-200">{formatTime(clock, settings)}</p>
          <h2 className="mt-1 text-2xl font-bold">{suggestion?.title || 'Buổi tập hôm nay'}</h2>
          <p className="mt-2 text-sm text-emerald-200">
            {routine ? `${routine.name} · ${routine.groups.length} Group Bài tập · ${routine.exercises.length} bài` : 'Chưa có Group Buổi tập theo lịch hôm nay.'}
          </p>
        </div>
        <CalendarDays size={34} />
      </div>

      {routine ? (
        <div className="mt-5 space-y-4">
          <div className="rounded-lg bg-white/8 p-3">
            <p className="text-sm text-emerald-200">Tiến độ hôm nay</p>
            <p className="mt-1 text-xl font-bold">{doneCount}/{routine.exercises.length} bài đã có log</p>
            <p className="mt-1 text-sm text-emerald-200">
              {todaySummary.length ? `${todaySummary.reduce((sum, row) => sum + Number(row.sets || 0), 0)} set · ${todaySummary.reduce((sum, row) => sum + Number(row.total_reps || 0), 0)} reps` : 'Chưa có kết quả hôm nay.'}
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {routine.groups.map((group) => (
              <div key={group.id} className="rounded-lg border border-white/10 bg-white/6 p-3">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{group.icon || '💪'}</span>
                  <strong>{group.name}</strong>
                </div>
                <div className="mt-3 grid gap-2">
                  {group.exercises.slice(0, 5).map((exercise) => {
                    const summary = summaryByExercise.get(exercise.id);
                    return (
                      <div key={exercise.id} className="flex items-center gap-3 rounded-md bg-black/15 p-2">
                        <img src={exercise.imageUrl} className="h-12 w-12 rounded bg-white object-contain" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold">{exercise.name}</p>
                          <p className="text-xs text-emerald-200">
                            {summary ? `Xong ${summary.sets} set · max ${summary.max_weight} kg · trước: ${summary.previous_best || 'chưa có'}` : 'Chưa tập hôm nay'}
                          </p>
                        </div>
                        <span className={`rounded-full px-2 py-1 text-xs font-bold ${summary ? 'bg-lime-300 text-green-950' : 'bg-white/10 text-emerald-200'}`}>
                          {summary ? 'Xong' : 'Chờ'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <button className="primary-light" onClick={() => onStartRoutine(routine)}>Bắt đầu Group Buổi tập</button>
        </div>
      ) : (
        <p className="mt-5 rounded-lg bg-white/8 p-3 text-sm text-emerald-100">Vào Lịch tập để gán Group Buổi tập cho lịch cố định hoặc cuốn chiếu.</p>
      )}
    </div>
  );
}

function FreeTraining({ routines, groups, onStartRoutine, onStartGroup }) {
  const routineItems = routines;
  const groupItems = groups;
  return (
    <div className="panel">
      <h2 className="section-title">Tập tự do</h2>
      <div className="space-y-4">
        <FreeTrainingSection title="Group Buổi tập" items={routineItems} empty="Chưa có Group Buổi tập." onStart={onStartRoutine} />
        <FreeTrainingSection title="Group Bài tập" items={groupItems} empty="Chưa có Group Bài tập." onStart={onStartGroup} />
      </div>
    </div>
  );
}

function FreeTrainingSection({ title, items, empty, onStart }) {
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
                  <p className="text-sm text-teal-950">{item.exercises.length} bài tập</p>
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
  const [groups, setGroups] = useState([]);
  const [routineData, setRoutineData] = useState({ routines: [] });
  const [activeSession, setActiveSession] = useState(null);

  useEffect(() => {
    api(`/api/groups?userId=${userId}`).then(setGroups);
    api(`/api/routines?userId=${userId}`).then(setRoutineData);
    api(`/api/sessions/active?userId=${userId}`).then(setActiveSession);
  }, [userId, refresh]);

  const startRoutine = async (routine) => {
    const session = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ userId, routineId: routine.id, scheduleMode: 'FREE' }) });
    onStart({ sessionId: session.id });
  };
  const startGroup = async (group) => {
    const session = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ userId, groupId: group.id, scheduleMode: 'FREE' }) });
    onStart({ sessionId: session.id });
  };

  return (
    <section className="space-y-5">
      <div className="panel-green">
        <h1 className="text-2xl font-black">{activeSession ? 'Tiếp tục tập' : 'Bắt đầu tập'}</h1>
        <p className="mt-2 text-sm text-emerald-100">{activeSession ? 'Tiếp tục buổi tập đang dang dở hôm nay.' : 'Chưa có buổi đang tập. Chọn Group Buổi tập hoặc Group Bài tập để bắt đầu.'}</p>
      </div>
      {activeSession ? (
        <div className="workout-card">
          <h2 className="text-xl font-black">{activeSession.routine?.name || 'Buổi tập đang tập'}</h2>
          <p className="mt-1 text-sm text-slate-500">{activeSession.exercises.length} bài · bắt đầu {formatTime(activeSession.session.started_at, settings)}</p>
          <div className="mt-4 grid gap-2">
            {activeSession.exercises.slice(0, 6).map((exercise) => (
              <div key={exercise.id} className="flex items-center gap-3 rounded-lg bg-slate-50 p-2">
                <img src={exercise.imageUrl} className="h-12 w-12 rounded bg-white object-contain" />
                <span className="min-w-0 flex-1 truncate font-semibold">{exercise.name}</span>
              </div>
            ))}
          </div>
          <button className="primary mt-4" onClick={() => onStart({ sessionId: activeSession.session.id })}>Tiếp tục vào bài tập</button>
        </div>
      ) : (
        <FreeTraining routines={routineData.routines} groups={groups} onStartRoutine={startRoutine} onStartGroup={startGroup} />
      )}
    </section>
  );
}

function CurrentWeekPlan({ suggestion, history, routines, rules }) {
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const monday = new Date(today);
  const offset = today.getDay() === 0 ? -6 : 1 - today.getDay();
  monday.setDate(today.getDate() + offset);
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

  return (
    <div className="panel">
      <h2 className="section-title">{suggestion?.mode === 'ROLLING' ? 'Lịch cuốn chiếu 3 ngày tới' : 'Lịch tập tuần này'}</h2>
      <div className="grid grid-cols-7 gap-2">
        {dayLabels.map((label, index) => {
          const date = new Date(monday);
          date.setDate(monday.getDate() + index);
          const isToday = date.toDateString() === today.toDateString();
          const isPast = date < new Date(today.toDateString());
          const dayHistory = historyByDay.get(localIsoDate(date)) || [];
          const done = doneDays.has(localIsoDate(date));
          const mainDone = dayHistory[0];
          const fixedRoutine = fixedByDay.get(index);
          const rollingOffset = Math.round((date - startOfToday) / 86400000);
          const rollingRule = rollingOffset >= 0 && rollingOffset < 3 && rollingRules.length
            ? rollingRules[(Math.max(0, (suggestion?.rollingIndex || 1) - 1) + rollingOffset) % rollingRules.length]
            : null;
          const rollingRoutine = rollingRule ? routineById.get(rollingRule.routine_id) : null;
          const routine = suggestion?.mode === 'FIXED' ? fixedRoutine : suggestion?.mode === 'ROLLING' ? rollingRoutine : null;
          return (
            <div key={label} className={`week-day-card ${isToday ? 'today' : ''} ${isPast && !done ? 'past' : ''} ${done ? 'done' : ''}`}>
              <p className="text-sm font-bold">{label}</p>
              <p className="text-2xl font-black">{date.getDate()}</p>
              {routine?.exercises?.[0] && !done && <img src={routine.exercises[0].imageUrl} className="mx-auto mt-1 h-8 w-8 rounded bg-white object-contain" />}
              <p className="mt-1 min-h-8 text-xs font-bold leading-tight">{done ? (mainDone.routine_name || mainDone.group_name || 'Buổi tập tự do') : routine?.name || ''}</p>
              {done && (
                <div className="mt-1 rounded-md bg-white/70 px-1.5 py-1 text-[10px] font-bold leading-tight text-slate-700">
                  <p>{mainDone.sets || 0} set · {mainDone.duration_minutes} phút</p>
                  {dayHistory.length > 1 && <p>+{dayHistory.length - 1} buổi khác</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActivityCalendar({ calendar, history, settings }) {
  const [tip, setTip] = useState(null);
  const byDay = new Map(calendar.map((row) => [row.day, row]));
  const cells = [];
  const today = new Date();
  const start = new Date(today);
  const offset = today.getDay() === 0 ? -27 : 1 - today.getDay() - 21;
  start.setDate(today.getDate() + offset);
  for (let i = 0; i < 28; i += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const iso = localIsoDate(date);
    cells.push({ iso, date, data: byDay.get(iso) });
  }
  const total = calendar.reduce((sum, row) => sum + Number(row.total || 0), 0);
  const bars = history.slice(0, 3);

  return (
    <div className="panel">
      <div className="grid grid-cols-[120px_1fr] gap-4 md:grid-cols-[150px_240px_1fr]">
        <div>
          <p className="text-sm font-bold">4 tuần gần nhất</p>
          <p className="mt-4 text-6xl font-black">{total}</p>
          <p className="mt-2 text-sm text-slate-600">Tổng hoạt động</p>
        </div>
        <div>
          <div className="grid grid-cols-7 text-center text-sm font-bold">
            {dayLabels.map((d) => <span key={d}>{d}</span>)}
          </div>
          <div className="mt-3 grid grid-cols-7 gap-y-3 text-center">
            {cells.map((cell) => (
              <div
                key={cell.iso}
                onMouseEnter={(event) => setTip({ x: event.clientX, y: event.clientY, text: `${formatDate(cell.date, settings)} · ${cell.data?.total || 0} hoạt động` })}
                onMouseMove={(event) => setTip((old) => old ? { ...old, x: event.clientX, y: event.clientY } : old)}
                onMouseLeave={() => setTip(null)}
                onClick={() => setTip({ x: window.innerWidth / 2, y: 180, text: `${formatDate(cell.date, settings)} · ${cell.data?.total || 0} hoạt động` })}
                className="grid cursor-pointer place-items-center"
              >
                {cell.data ? <Dumbbell size={15} className="text-teal-950" /> : <span className="h-1 w-1 rounded-full bg-teal-200" />}
              </div>
            ))}
          </div>
        </div>
        <div className="col-span-2 space-y-3 md:col-span-1">
          {bars.length === 0 && <p className="text-sm text-slate-600">Chưa có dữ liệu lịch sử.</p>}
          {bars.map((row) => (
            <div key={row.id} className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-emerald-400 ring-1 ring-emerald-300" />
              <div className="h-5 bg-emerald-100 ring-1 ring-emerald-200" style={{ width: `${Math.min(220, 60 + row.duration_minutes * 2)}px` }} />
              <span className="text-sm font-bold">{row.duration_minutes} phút</span>
            </div>
          ))}
        </div>
      </div>
      {tip && <div className="calendar-tip" style={{ left: tip.x + 10, top: tip.y + 10 }}>{tip.text}</div>}
    </div>
  );
}

function HistoryList({ userId, history, onDeleted, settings }) {
  const [openSessionId, setOpenSessionId] = useState(null);
  const [detail, setDetail] = useState(null);
  const removeSession = async (sessionId) => {
    if (!confirm('Xoá buổi tập này? Set/log trong buổi này cũng sẽ bị xoá khỏi thống kê.')) return;
    await api(`/api/sessions/${sessionId}`, { method: 'DELETE', body: JSON.stringify({ userId }) });
    if (openSessionId === sessionId) {
      setOpenSessionId(null);
      setDetail(null);
    }
    onDeleted(sessionId);
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
      <h2 className="section-title">Lịch sử gần đây</h2>
      <div className="space-y-2">
        {history.map((row) => (
          <div key={row.id} className="panel">
            <div className="flex items-center justify-between gap-3">
              <button className="min-w-0 flex-1 text-left" onClick={() => toggleDetail(row.id)}>
                <p className="font-bold">{row.routine_name || row.group_name || 'Buổi tập tự do'}</p>
                <p className="text-sm text-teal-900">
                  {formatDateTime(row.completed_at, settings)} · {row.sets} set · {row.duration_minutes} phút
                </p>
              </button>
              <div className="flex items-center gap-2">
                <Dumbbell className="text-teal-900" />
                <button className="small-danger" onClick={() => removeSession(row.id)}><Trash2 size={16} /> Xoá</button>
              </div>
            </div>
            {openSessionId === row.id && <SessionDetail detail={detail} settings={settings} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function SessionDetail({ detail, settings }) {
  if (!detail) return <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm text-slate-600">Đang tải chi tiết...</div>;
  const statusText = detail.summary.effectiveness >= 60
    ? 'Hiệu quả tốt'
    : detail.summary.effectiveness >= 30
      ? 'Có tiến bộ nhẹ'
      : 'Buổi duy trì';
  return (
    <div className="mt-3 space-y-3 rounded-lg border border-stone-200 bg-white p-3">
      <div className="rounded-md bg-slate-50 p-2 text-sm text-slate-700">
        <strong>Thời gian:</strong> {formatTime(detail.session.started_at, settings)} - {formatTime(detail.session.completed_at, settings)} · {detail.session.duration_minutes} phút
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md bg-slate-50 p-2"><p className="text-xs text-slate-500">Bài</p><strong>{detail.summary.exerciseCount}</strong></div>
        <div className="rounded-md bg-slate-50 p-2"><p className="text-xs text-slate-500">Set</p><strong>{detail.summary.totalSets}</strong></div>
        <div className="rounded-md bg-slate-50 p-2"><p className="text-xs text-slate-500">Volume</p><strong>{Math.round(detail.summary.totalVolume)}</strong></div>
      </div>
      <p className="rounded-md bg-orange-50 p-2 text-sm font-bold text-orange-900">{statusText} · {detail.summary.improvedCount}/{detail.summary.exerciseCount} bài tốt hơn lần trước</p>
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
                    So với lần trước: volume {volumeDiff >= 0 ? '+' : ''}{Math.round(volumeDiff)}, max {weightDiff >= 0 ? '+' : ''}{weightDiff} kg
                  </p>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1 text-xs">
                {exercise.sets.map((set) => <span key={set.id} className="rounded bg-white px-2 py-1">Set {set.setIndex}: {set.weightKg}kg x {set.reps}</span>)}
              </div>
              <div className="mt-2 rounded-md border border-dashed border-slate-200 bg-white p-2">
                <p className="mb-1 text-xs font-bold text-slate-500">
                  Lần trước {exercise.previousCompletedAt ? `(${formatDateTime(exercise.previousCompletedAt, settings)})` : ''}
                </p>
                {exercise.previous.length ? (
                  <div className="grid grid-cols-3 gap-1 text-xs">
                    {exercise.previous.map((set) => <span key={set.id} className="rounded bg-slate-50 px-2 py-1">Set {set.setIndex}: {set.weightKg}kg x {set.reps}</span>)}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">Chưa có lần tập trước cho bài này.</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ExerciseLibrary({ userId }) {
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({ targets: [] });
  const [q, setQ] = useState('');
  const [target, setTarget] = useState('');
  const [groups, setGroups] = useState([]);
  const [selectedExercise, setSelectedExercise] = useState(null);
  const [visibleCount, setVisibleCount] = useState(60);
  const [previewGifId, setPreviewGifId] = useState(null);
  const [pinnedGifId, setPinnedGifId] = useState(null);

  useEffect(() => { api('/api/exercises/meta').then(setMeta); api(`/api/groups?userId=${userId}`).then(setGroups); }, [userId]);
  useEffect(() => {
    setVisibleCount(60);
    setSelectedExercise(null);
    setPreviewGifId(null);
    setPinnedGifId(null);
    api(`/api/exercises?q=${encodeURIComponent(q)}&target=${encodeURIComponent(target)}`).then(setItems);
  }, [q, target]);

  const addToGroup = async (groupId, exerciseId) => {
    await api(`/api/groups/${groupId}/exercises`, { method: 'POST', body: JSON.stringify({ exerciseId }) });
    api(`/api/groups?userId=${userId}`).then(setGroups);
  };
  const playSmallGif = (exercise) => {
    if (exercise.gifUrl) {
      const image = new Image();
      image.src = exercise.gifUrl;
    }
    setPreviewGifId(exercise.id);
  };
  const pinSmallGif = (exercise) => {
    playSmallGif(exercise);
    setPinnedGifId(exercise.id);
  };

  if (selectedExercise) {
    return (
      <section className="space-y-4">
        <button className="ghost-btn" onClick={() => setSelectedExercise(null)}>Trở về danh mục thư viện</button>
        <article className="panel">
          <img src={selectedExercise.gifUrl || selectedExercise.imageUrl} alt={selectedExercise.name} className="mx-auto h-[300px] max-h-[45vh] w-full max-w-xl rounded-lg bg-white object-contain md:h-[360px]" />
          <h2 className="mt-4 text-2xl font-black">{selectedExercise.name}</h2>
          <p className="mt-2 text-sm font-semibold text-teal-950">
            Nhóm chính: {selectedExercise.target || 'Không rõ'} · Vùng: {selectedExercise.bodyPart || 'Không rõ'} · Dụng cụ: {selectedExercise.equipment || 'Không rõ'}
          </p>
          {selectedExercise.secondaryMuscles?.length > 0 && (
            <p className="mt-1 text-sm text-slate-600">Nhóm phụ: {selectedExercise.secondaryMuscles.join(', ')}</p>
          )}
          <ExerciseInstructions exercise={selectedExercise} />
          <select onChange={(e) => e.target.value && addToGroup(e.target.value, selectedExercise.id)} className="input mt-4 py-2 text-sm">
            <option value="">Thêm vào group</option>
            {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
          </select>
        </article>
      </section>
    );
  }

  const visibleItems = items.slice(0, visibleCount);
  return (
    <section className="space-y-4">
      <div className="sticky top-0 z-10 bg-[#f4f6f1]/95 py-2 backdrop-blur">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm bài tập..." className="input" />
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          <Chip active={!target} onClick={() => setTarget('')}>Tất cả</Chip>
          {meta.targets.slice(0, 18).map((value) => <Chip key={value} active={target === value} onClick={() => setTarget(value)}>{value}</Chip>)}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {visibleItems.map((exercise) => {
          const isPlayingGif = previewGifId === exercise.id || pinnedGifId === exercise.id;
          return (
          <article
            key={exercise.id}
            className="panel cursor-pointer"
            onClick={() => setSelectedExercise(exercise)}
            onMouseLeave={() => {
              if (pinnedGifId !== exercise.id) setPreviewGifId((id) => id === exercise.id ? null : id);
            }}
          >
            <div className="flex gap-3">
              <img
                src={isPlayingGif ? exercise.gifUrl || exercise.imageUrl : exercise.imageUrl}
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
              <div className="min-w-0 flex-1">
                <h3 className="font-bold leading-tight">{exercise.name}</h3>
                <p className="mt-1 text-sm text-teal-900">{exercise.target} · {exercise.equipment}</p>
                <select onClick={(event) => event.stopPropagation()} onChange={(e) => e.target.value && addToGroup(e.target.value, exercise.id)} className="input mt-3 py-2 text-sm">
                  <option value="">Thêm vào group</option>
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
          Xem thêm {Math.min(60, items.length - visibleCount)} bài ({visibleCount}/{items.length})
        </button>
      )}
    </section>
  );
}

function ExerciseInstructions({ exercise, compact = false }) {
  const rawSteps = exercise.steps?.length
    ? exercise.steps
    : exercise.instructions
      ? String(exercise.instructions).split(/\n+/)
      : [];
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
      <summary className="cursor-pointer text-sm font-bold text-slate-900">Hướng dẫn tập</summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-slate-700">
        {steps.map((step, index) => <li key={`${exercise.id}-step-${index}`}>{step}</li>)}
      </ol>
    </details>
  );
}

function Builder({ userId, boot, onStart, onChanged }) {
  const [groups, setGroups] = useState([]);
  const [routineData, setRoutineData] = useState({ routines: [], rules: [] });
  const [groupName, setGroupName] = useState('');
  const [groupIcon, setGroupIcon] = useState('💪');
  const [routineName, setRoutineName] = useState('');
  const [selectedGroups, setSelectedGroups] = useState([]);
  const [draggingExercise, setDraggingExercise] = useState(null);
  const [dragOverExercise, setDragOverExercise] = useState(null);
  const [draggingRoutineGroup, setDraggingRoutineGroup] = useState(null);
  const [dragOverRoutineGroup, setDragOverRoutineGroup] = useState(null);

  const load = () => {
    api(`/api/groups?userId=${userId}`).then(setGroups);
    api(`/api/routines?userId=${userId}`).then(setRoutineData);
  };
  useEffect(load, [userId]);

  const createGroup = async () => {
    if (!groupName.trim()) return;
    await api('/api/groups', { method: 'POST', body: JSON.stringify({ userId, name: groupName, icon: groupIcon }) });
    setGroupName('');
    load();
  };
  const updateGroupIcon = async (group, icon) => {
    await api(`/api/groups/${group.id}`, { method: 'PATCH', body: JSON.stringify({ userId, name: group.name, icon }) });
    load();
  };
  const updateExerciseIcon = async (groupId, exerciseId, icon) => {
    await api(`/api/groups/${groupId}/exercises/${exerciseId}`, { method: 'PATCH', body: JSON.stringify({ icon }) });
    load();
  };
  const moveExercise = async (groupId, exerciseId, direction) => {
    await api(`/api/groups/${groupId}/exercises/${exerciseId}`, { method: 'PATCH', body: JSON.stringify({ direction }) });
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
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setGroups((old) => old.map((item) => item.id === groupId ? { ...item, exercises: next } : item));
    await api(`/api/groups/${groupId}/exercises-order`, { method: 'PATCH', body: JSON.stringify({ userId, exerciseIds: next.map((exercise) => exercise.id) }) });
    load();
  };
  const removeExercise = async (groupId, exerciseId) => {
    await api(`/api/groups/${groupId}/exercises/${exerciseId}`, { method: 'DELETE' });
    load();
  };
  const deleteGroup = async (groupId) => {
    if (!confirm('Xoa Group Bai tap nay? Cac Group Buoi tap lien quan se duoc cap nhat.')) return;
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
    if (!confirm('Xoa Group Buoi tap nay? Lich gan voi no cung se bi xoa.')) return;
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
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setRoutineData((old) => ({
      ...old,
      routines: old.routines.map((item) => item.id === routineId ? { ...item, groups: next } : item)
    }));
    await api(`/api/routines/${routineId}/groups-order`, { method: 'PATCH', body: JSON.stringify({ userId, groupIds: next.map((group) => group.id) }) });
    load();
    onChanged();
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
        <h2 className="section-title">Chế độ tập</h2>
        <p className="mb-2 text-sm text-teal-900">Chỉ chọn nếu muốn dùng lịch thông minh. Tập tự do luôn có ở Home.</p>
        <div className="grid gap-2">
          {['FIXED', 'ROLLING'].map((mode) => (
            <label key={mode} className={`mode-btn flex items-center gap-3 ${boot.settings.schedule_mode === mode ? 'active' : ''}`}>
              <input
                type="radio"
                name="scheduleMode"
                checked={boot.settings.schedule_mode === mode}
                onChange={() => setMode(mode)}
              />
              <span>{modeLabels[mode]}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="builder-section">
        <h2 className="section-title">1. Tạo Group Bài tập</h2>
        <div className="flex gap-2">
          <select className="input w-24" value={groupIcon} onChange={(e) => setGroupIcon(e.target.value)}>
            {iconChoices.map((icon) => <option key={icon} value={icon}>{icon}</option>)}
          </select>
          <input className="input" value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Ví dụ: Ngực, Xô, Chân" />
          <button className="icon-btn" onClick={createGroup}><Plus /></button>
        </div>
      </div>

      <div className="builder-section">
        <h2 className="section-title">Group Bài tập hiện có</h2>
        {groups.map((group) => (
          <div key={group.id} className="panel">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-bold">{group.icon || '💪'} {group.name} · {group.exercises.length} bài</div>
              <div className="flex flex-wrap gap-2">
                <button className="small-action" onClick={() => startGroup(group)}><Play size={16} /> Vao tap</button>
                <button className="small-danger" onClick={() => deleteGroup(group.id)}><Trash2 size={16} /> Xoa group</button>
              </div>
            </div>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-bold text-teal-950">Danh sách bài tập</summary>
              <div className="mt-3 flex items-center gap-2">
                <span className="text-sm text-teal-900">Icon group</span>
                <select className="input w-24 py-2" value={group.icon || '💪'} onChange={(e) => updateGroupIcon(group, e.target.value)}>
                  {iconChoices.map((icon) => <option key={icon} value={icon}>{icon}</option>)}
                </select>
              </div>
              <div className="mt-3 space-y-2">
                {group.exercises.length === 0 && <p className="text-sm text-slate-600">Vào Bài tập để thêm bài vào group này.</p>}
                {group.exercises.map((exercise) => (
                  <div
                    key={exercise.id}
                    draggable
                    onDragStart={(event) => {
                      setDraggingExercise({ groupId: group.id, exerciseId: exercise.id });
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragOver={(event) => {
                      if (draggingExercise?.groupId === group.id) event.preventDefault();
                    }}
                    onDragEnter={() => {
                      if (draggingExercise?.groupId === group.id) setDragOverExercise(exercise.id);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      reorderGroupExercises(group.id, draggingExercise?.exerciseId, exercise.id);
                      setDraggingExercise(null);
                      setDragOverExercise(null);
                    }}
                    onDragEnd={() => { setDraggingExercise(null); setDragOverExercise(null); }}
                    className={`exercise-drag-row ${draggingExercise?.exerciseId === exercise.id ? 'dragging' : ''} ${dragOverExercise === exercise.id && draggingExercise?.exerciseId !== exercise.id ? 'drop-target' : ''}`}
                  >
                    <span className="drag-handle" title="Kéo để đổi vị trí"><GripVertical size={18} /></span>
                    <select className="w-14 rounded-md border border-slate-200 bg-white p-2" value={exercise.icon || '🏋️'} onChange={(e) => updateExerciseIcon(group.id, exercise.id, e.target.value)}>
                      {iconChoices.map((icon) => <option key={icon} value={icon}>{icon}</option>)}
                    </select>
                    <img src={exercise.imageUrl} className="h-12 w-12 rounded bg-white object-contain" />
                    <span className="min-w-0 flex-1 text-sm font-semibold">{exercise.name}</span>
                    <button className="small-danger shrink-0" onClick={() => removeExercise(group.id, exercise.id)}><Trash2 size={16} /> Xoa</button>
                  </div>
                ))}
              </div>
            </details>
          </div>
        ))}
      </div>

      <div className="builder-section">
        <h2 className="section-title">2. Tạo Group Buổi tập từ nhiều Group Bài tập</h2>
        <input className="input" value={routineName} onChange={(e) => setRoutineName(e.target.value)} placeholder="Ví dụ: Push day, Pull day" />
        <div className="mt-3 grid gap-2">
          {groups.map((group) => (
            <label key={group.id} className="flex items-center gap-3 rounded-md bg-slate-50 p-3">
              <input type="checkbox" checked={selectedGroups.includes(group.id)} onChange={(e) => setSelectedGroups((prev) => e.target.checked ? [...prev, group.id] : prev.filter((id) => id !== group.id))} />
              <span className="text-xl">{group.icon || '💪'}</span>
              <span className="min-w-0 flex-1">{group.name} <small className="text-teal-950">({group.exercises.length} bài)</small></span>
              <div className="flex -space-x-2">
                {group.exercises.slice(0, 4).map((exercise) => (
                  <img key={exercise.id} src={exercise.imageUrl} title={exercise.name} className="h-8 w-8 rounded-full border-2 border-white bg-white object-contain" />
                ))}
              </div>
            </label>
          ))}
        </div>
        <button className="primary mt-3" onClick={createRoutine}>Tạo Group Buổi tập</button>
      </div>

      <div className="builder-section">
        <h2 className="section-title">3. Chọn kiểu lịch và gán Group Buổi tập</h2>
        <div className="mb-4 grid gap-3">
          {routineData.routines.length === 0 && <p className="text-sm text-slate-600">Chua co Group Buoi tap.</p>}
          {routineData.routines.map((routine) => {
            const availableGroups = groups.filter((group) => !routine.groups.some((item) => item.id === group.id));
            return (
              <article key={routine.id} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-start gap-3">
                  <img src={routine.exercises[0]?.imageUrl} className="h-12 w-12 rounded-md bg-slate-50 object-contain ring-1 ring-slate-200" />
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold">{routine.name}</h3>
                    <p className="text-sm text-slate-500">{routine.groups.length} group · {routine.exercises.length} bai tap</p>
                  </div>
                  <button className="small-action" onClick={() => startRoutine(routine)}><Play size={16} /> Vao tap</button>
                  <button className="small-danger" onClick={() => deleteRoutine(routine.id)}><Trash2 size={16} /> Xoa</button>
                </div>
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-bold text-teal-950">Danh sách Group Bài tập trong buổi</summary>
                  <div className="mt-3 grid gap-2">
                  {routine.groups.map((group) => (
                    <div
                      key={group.id}
                      draggable
                      onDragStart={(event) => {
                        setDraggingRoutineGroup({ routineId: routine.id, groupId: group.id });
                        event.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragOver={(event) => {
                        if (draggingRoutineGroup?.routineId === routine.id) event.preventDefault();
                      }}
                      onDragEnter={() => {
                        if (draggingRoutineGroup?.routineId === routine.id) setDragOverRoutineGroup(group.id);
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        reorderRoutineGroups(routine.id, draggingRoutineGroup?.groupId, group.id);
                        setDraggingRoutineGroup(null);
                        setDragOverRoutineGroup(null);
                      }}
                      onDragEnd={() => { setDraggingRoutineGroup(null); setDragOverRoutineGroup(null); }}
                      className={`exercise-drag-row ${draggingRoutineGroup?.groupId === group.id ? 'dragging' : ''} ${dragOverRoutineGroup === group.id && draggingRoutineGroup?.groupId !== group.id ? 'drop-target' : ''}`}
                    >
                      <span className="drag-handle" title="Kéo để đổi vị trí"><GripVertical size={18} /></span>
                      <span className="text-xl">{group.icon || '💪'}</span>
                      <span className="min-w-0 flex-1 text-sm font-semibold">{group.name}</span>
                      <button className="small-danger" onClick={() => removeRoutineGroup(routine.id, group.id)}><Trash2 size={16} /> Xoa khoi buoi</button>
                    </div>
                  ))}
                  </div>
                </details>
                <select className="input mt-3 py-2 text-sm" value="" onChange={(event) => addRoutineGroup(routine.id, event.target.value)}>
                  <option value="">Them Group Bai tap vao buoi</option>
                  {availableGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
              </article>
            );
          })}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <ScheduleAssignPanel
            title="Lịch cố định theo thứ"
            description="Mỗi thứ trong tuần trỏ tới một Group Buổi tập."
            mode="FIXED"
            routines={routineData.routines}
            rules={routineData.rules.filter((rule) => rule.mode === 'FIXED')}
            onAssign={assignRule}
            onDelete={deleteRule}
            onStart={startRoutine}
          />
          <ScheduleAssignPanel
            title="Lịch cuốn chiếu"
            description="Sắp theo Buổi 1, Buổi 2... Chỉ nhảy khi kết thúc buổi tập."
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
                <p className="text-xs text-slate-500">{routine.exercises.length} bài · {routine.groups.map((g) => g.name).join(' + ')}</p>
              </div>
              <button className="small-action" onClick={() => onStart(routine)}><Play size={16} /> Vao tap</button>
            </div>
            <select className="input mt-3" onChange={(e) => e.target.value && onAssign(routine.id, mode, e.target.value)}>
              <option value="">{mode === 'FIXED' ? 'Gán vào thứ' : 'Gán vào thứ tự chu kỳ'}</option>
              {mode === 'FIXED'
                ? dayLabels.map((d, i) => <option key={d} value={i}>{d}</option>)
                : [1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>Buổi {n}</option>)}
            </select>
          </article>
        ))}
      </div>
      <ScheduleRules rules={rules} onDelete={onDelete} />
    </div>
  );
}

function ScheduleRules({ rules, onDelete }) {
  if (!rules.length) return <p className="text-sm text-slate-600">Chưa gán lịch routine.</p>;
  return (
    <div className="panel">
      <h3 className="mb-2 font-bold">Lịch đang dùng</h3>
      {rules.map((rule) => (
        <div key={rule.id} className="flex items-center justify-between gap-3 border-t border-slate-200 py-2 first:border-t-0">
          <p className="text-sm text-slate-700">
            {rule.mode === 'FIXED' ? dayLabels[rule.day_of_week] : `Buổi ${rule.order_index}`} · {rule.routine_name}
          </p>
          <button className="tiny-btn" onClick={() => onDelete(rule.id)}><Trash2 size={16} /></button>
        </div>
      ))}
    </div>
  );
}

function WorkoutLogger({ userId, workout, onClose }) {
  const [data, setData] = useState(null);
  const [index, setIndex] = useState(0);
  const [view, setView] = useState('list');
  const [paused, setPaused] = useState(false);
  const [sets, setSets] = useState([]);
  const [previousSets, setPreviousSets] = useState([]);
  const [note, setNote] = useState('');
  const [targetSets, setTargetSets] = useState(3);
  const [unit, setUnit] = useState('kg');
  const [timer, setTimer] = useState(0);

  useEffect(() => { api(`/api/sessions/${workout.sessionId}?userId=${userId}`).then(setData); }, [workout.sessionId, userId]);
  const exercise = data?.exercises?.[index];
  useEffect(() => {
    if (!exercise) return;
    api(`/api/sessions/${workout.sessionId}/exercises/${exercise.id}/sets?userId=${userId}`).then((payload) => {
      setPreviousSets(payload.previous || []);
      setNote(payload.note || '');
      const target = Math.max(1, Number(payload.targetSets || 3));
      setTargetSets(target);
      const current = payload.current || [];
      const buildDraftSet = (setIndex) => {
        const previous = payload.previous?.[setIndex - 1];
        const lastCurrent = current[current.length - 1];
        return {
          setIndex,
          weightKg: previous?.weight_kg ?? lastCurrent?.weight_kg ?? 20,
          reps: previous?.reps ?? lastCurrent?.reps ?? 8,
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

  if (!data || !exercise) return <div className="panel">Routine này chưa có bài tập.</div>;

  const openExercise = (nextIndex) => {
    setIndex(nextIndex);
    setView('exercise');
  };
  const updateSet = async (setIndex, patch) => {
    const current = sets.find((set) => set.setIndex === setIndex);
    const updatedSet = current ? { ...current, ...patch } : null;
    setSets((old) => old.map((set) => set.setIndex === setIndex ? { ...set, ...patch } : set));
    if (updatedSet?.done && updatedSet.id) {
      await api(`/api/logs/${updatedSet.id}`, { method: 'PATCH', body: JSON.stringify({ userId, weightKg: updatedSet.weightKg, reps: updatedSet.reps }) });
    }
  };
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
    const result = await api(`/api/sessions/${workout.sessionId}/logs`, { method: 'POST', body: JSON.stringify({ userId, exerciseId: exercise.id, weightKg: set.weightKg, reps: set.reps }) });
    setSets((old) => old.map((item) => item.setIndex === set.setIndex ? { ...item, id: result.id, done: true } : item));
    setTimer(60);
  };
  const saveNote = async (value) => {
    setNote(value);
    await api(`/api/exercises/${exercise.id}/note`, { method: 'PUT', body: JSON.stringify({ userId, note: value }) });
  };
  const complete = async () => {
    await api(`/api/sessions/${workout.sessionId}/complete`, { method: 'POST', body: JSON.stringify({ userId }) });
    onClose();
  };

  return (
    <section className="space-y-4 text-black">
      <div className="flex items-center justify-between">
        <button className="ghost-btn" onClick={view === 'exercise' ? () => setView('list') : onClose}>{view === 'exercise' ? 'Danh sách' : 'Thoát'}</button>
        <span className="text-sm text-slate-600">{index + 1}/{data.exercises.length}</span>
      </div>

      {view === 'list' ? (
        <div className="workout-card space-y-3">
          <h1 className="text-2xl font-black">{data.routine?.name || 'Buổi tập'}</h1>
          <p className="text-sm text-slate-500">Chọn bài để vào màn hình đang tập.</p>
          {data.exercises.map((item, itemIndex) => (
            <button key={`${item.id}-${itemIndex}`} className="flex w-full items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 text-left" onClick={() => openExercise(itemIndex)}>
              <img src={item.imageUrl || item.gifUrl} className="h-14 w-14 rounded-md bg-slate-50 object-contain" />
              <div className="min-w-0 flex-1">
                <p className="font-bold">{item.name}</p>
                <p className="text-sm text-slate-500">{item.groupName || item.target} · {item.equipment}</p>
              </div>
              <span className="rounded-full bg-teal-100 px-3 py-1 text-xs font-bold text-teal-950">Tập bài này</span>
            </button>
          ))}
          <button className="primary" onClick={complete}>Kết thúc buổi tập</button>
        </div>
      ) : (
        <div className="workout-card space-y-4">
          <div className="overflow-hidden rounded-xl bg-slate-50">
            <img src={paused ? exercise.imageUrl : exercise.gifUrl} alt={exercise.name} className="mx-auto h-[300px] max-h-[45vh] w-full max-w-xl object-contain md:h-[360px]" />
          </div>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-black">{exercise.name}</h1>
              <p className="mt-1 text-sm text-slate-500">Lần nâng trước: {previousSets[0] ? `${previousSets[0].weight_kg} kg x ${previousSets[0].reps}` : 'chưa có dữ liệu'}</p>
            </div>
            <div className="flex gap-2">
              <button className={`unit-btn ${unit === 'kg' ? 'active' : ''}`} onClick={() => setUnit('kg')}>kg</button>
              <button className={`unit-btn ${unit === 'lb' ? 'active' : ''}`} onClick={() => setUnit('lb')}>lb</button>
              <button className="icon-btn" onClick={() => setPaused((v) => !v)}>{paused ? <Play /> : <Pause />}</button>
            </div>
          </div>
          <ExerciseInstructions exercise={exercise} />

          <div className="rounded-xl border border-slate-200 bg-white p-2">
            <div className="grid grid-cols-[52px_1fr_76px_76px_48px_48px] items-center gap-2 px-2 py-2 text-xs font-bold uppercase text-slate-400">
              <span>Set</span><span>Previous</span><span>Kg</span><span>Reps</span><span /><span />
            </div>
            <div className="space-y-2">
              {sets.map((set) => {
                const previous = previousSets[set.setIndex - 1];
                return (
                  <div key={set.setIndex} className={`grid grid-cols-[52px_1fr_76px_76px_48px_48px] items-center gap-2 rounded-lg p-2 ${set.done ? 'bg-lime-200' : 'bg-slate-50'}`}>
                    <strong className="text-xl">{set.setIndex}</strong>
                    <span className="text-sm text-slate-500">{previous ? `${previous.weight_kg}kg × ${previous.reps}` : '-'}</span>
                    <WheelPicker value={set.weightKg} options={kgOptions} suffix={unit} onChange={(value) => updateSet(set.setIndex, { weightKg: value })} />
                    <WheelPicker value={set.reps} options={repOptions} onChange={(value) => updateSet(set.setIndex, { reps: value })} />
                    <button className={`set-check ${set.done ? 'done' : ''}`} onClick={() => completeSet(set)}><Check size={22} /></button>
                    <button className="tiny-btn" disabled={set.done || sets.length <= 1} onClick={() => removeDraftSet(set.setIndex)}><Trash2 size={15} /></button>
                  </div>
                );
              })}
            </div>
            <button className="add-set-btn" onClick={addSet}>+ Thêm set</button>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <label className="label">Ghi chú bài tập</label>
            <textarea className="input min-h-24" value={note} onChange={(e) => saveNote(e.target.value)} placeholder="Ghi cảm giác, form, mức tạ cần thử lần sau..." />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button className="ghost-btn" disabled={index === 0} onClick={() => openExercise(index - 1)}>Bài trước</button>
            <button className="ghost-btn" disabled={index >= data.exercises.length - 1} onClick={() => openExercise(index + 1)}>Bài tiếp</button>
          </div>
          <button className="primary" onClick={complete}>Kết thúc buổi tập</button>
        </div>
      )}
      {timer > 0 && <div className="timer-pop">Nghỉ {timer}s <button onClick={() => setTimer((v) => v + 30)}>+30s</button><button onClick={() => setTimer(0)}>Tắt</button></div>}
    </section>
  );
}

function WheelPicker({ value, options, suffix = '', onChange }) {
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

function Analytics({ userId, settings }) {
  const [analytics, setAnalytics] = useState({ exercises: [], exerciseRows: [], routines: [], sessionRows: [] });
  const [weights, setWeights] = useState([]);
  const [chartMode, setChartMode] = useState('exercise');
  const [rangeKey, setRangeKey] = useState('1m');
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

  const weightRows = weights.map((row) => ({
    ...row,
    day: formatDate(row.logged_at, settings),
    time: formatTime(row.logged_at, settings),
    label: formatDateTime(row.logged_at, settings, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
    bmi: settings.height_cm ? Number((Number(row.weight) / ((Number(settings.height_cm) / 100) ** 2)).toFixed(1)) : null
  }));
  const rangedWeightRows = filterByRange(weightRows, 'logged_at', rangeKey);
  const latestWeight = weightRows[weightRows.length - 1];
  const previousWeight = weightRows[weightRows.length - 2];
  const weightDelta = latestWeight && previousWeight ? Number(latestWeight.weight) - Number(previousWeight.weight) : 0;
  const latestBmi = latestWeight?.bmi;
  const bmiInfo = bmiFeedback(latestBmi);
  const exerciseChartRows = filterByRange(analytics.exerciseRows, 'day', rangeKey)
    .filter((row) => row.exercise_id === selectedExerciseId)
    .map((row) => ({ ...row, label: formatDate(row.day, settings, { day: '2-digit', month: '2-digit' }) }));
  const sessionChartRows = filterByRange(analytics.sessionRows, 'completed_at', rangeKey)
    .filter((row) => !selectedRoutineName || row.name === selectedRoutineName)
    .map((row) => ({ ...row, label: formatDateTime(row.completed_at, settings, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) }));
  const selectedExercise = analytics.exercises.find((exercise) => exercise.id === selectedExerciseId);

  return (
    <section className="space-y-4">
      <h2 className="section-title">Thống kê</h2>
      <div className="range-bar">
        {rangeOptions.map(([key, label]) => (
          <button key={key} className={rangeKey === key ? 'active' : ''} onClick={() => setRangeKey(key)}>{label}</button>
        ))}
      </div>
      <div className="weight-hero-card">
        <div>
          <p className="text-sm font-bold text-white/75">Cân nặng hiện tại</p>
          <div className="mt-1 flex items-end gap-2">
            <strong className="text-4xl">{latestWeight ? latestWeight.weight : '--'}</strong>
            <span className="pb-1 text-sm font-bold text-white/75">{latestWeight?.unit || 'kg'}</span>
          </div>
          <p className="mt-2 text-sm font-bold text-white/80">
            {previousWeight ? `${weightDelta >= 0 ? '+' : ''}${weightDelta.toFixed(1)} ${latestWeight.unit} so với lần trước` : 'Chưa có lần trước'}
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
      <div className="weight-chart-panel h-96">
        <h3 className="mb-3 font-bold">Biểu đồ cân nặng</h3>
        {rangedWeightRows.length ? (
          <ResponsiveContainer width="100%" height="82%">
            <AreaChart data={rangedWeightRows} margin={{ top: 16, right: 18, bottom: 28, left: 8 }}>
              <defs>
                <linearGradient id="weightFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2563eb" stopOpacity={0.28} />
                  <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" stroke="#6b668a" tickMargin={14} minTickGap={22} />
              <YAxis stroke="#6b668a" tickMargin={10} />
              <Tooltip />
              <Area type="monotone" dataKey="weight" name="Cân nặng" stroke="#2563eb" strokeWidth={3} fill="url(#weightFill)" dot />
            </AreaChart>
          </ResponsiveContainer>
        ) : <p className="text-slate-600">Nhập cân nặng ở Home để vẽ biểu đồ.</p>}
      </div>
      <div className="weight-chart-panel h-80">
        <h3 className="mb-3 font-bold">Biểu đồ BMI</h3>
        {rangedWeightRows.some((row) => row.bmi) ? (
          <ResponsiveContainer width="100%" height="85%">
            <LineChart data={rangedWeightRows.filter((row) => row.bmi)} margin={{ top: 16, right: 18, bottom: 28, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" stroke="#6b668a" tickMargin={14} minTickGap={22} />
              <YAxis stroke="#6b668a" tickMargin={10} domain={['dataMin - 1', 'dataMax + 1']} />
              <Tooltip />
              <Line type="monotone" dataKey="bmi" name="BMI" stroke="#f97316" strokeWidth={3} dot />
            </LineChart>
          </ResponsiveContainer>
        ) : <p className="text-slate-600">Nhập chiều cao trong Cài đặt để app tính BMI.</p>}
      </div>
      <div className="weight-history-panel">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-bold">History</h3>
          <span className="text-xs font-bold text-[#8b84ad]">{weightRows.length} lần ghi nhận</span>
        </div>
        <div className="grid gap-3">
          {weightRows.slice(-10).reverse().map((row) => (
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
          {weightRows.length === 0 && <p className="text-sm text-[#8b84ad]">Chưa có lịch sử cân nặng.</p>}
        </div>
      </div>
      <div className="panel h-[360px]">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold">Tiến bộ tập luyện</h3>
          <div className="flex gap-2">
            <Chip active={chartMode === 'exercise'} onClick={() => setChartMode('exercise')}>Theo bài</Chip>
            <Chip active={chartMode === 'session'} onClick={() => setChartMode('session')}>Theo buổi</Chip>
          </div>
        </div>
        {chartMode === 'exercise' ? (
          <div className="h-[82%]">
            <ExerciseProgressPicker exercises={analytics.exercises} value={selectedExerciseId} onChange={setSelectedExerciseId} />
            {exerciseChartRows.length ? (
              <ResponsiveContainer width="100%" height="78%">
                <LineChart data={exerciseChartRows}>
                  <XAxis dataKey="label" stroke="#334155" />
                  <YAxis stroke="#334155" />
                  <Tooltip />
                  <Line type="monotone" dataKey="max_weight" name="Max kg" stroke="#2563eb" strokeWidth={3} dot />
                  <Line type="monotone" dataKey="volume" name="Volume" stroke="#16a34a" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : <p className="text-slate-600">{selectedExercise ? 'Chưa đủ dữ liệu cho bài này.' : 'Chưa có bài tập nào có log.'}</p>}
          </div>
        ) : (
          <div className="h-[82%]">
            <select className="input mb-3 py-2 text-sm" value={selectedRoutineName} onChange={(event) => setSelectedRoutineName(event.target.value)}>
              {analytics.routines.map((routine) => <option key={routine.id || routine.name} value={routine.name}>{routine.name}</option>)}
            </select>
            {sessionChartRows.length ? (
              <ResponsiveContainer width="100%" height="78%">
                <LineChart data={sessionChartRows}>
                  <XAxis dataKey="label" stroke="#334155" />
                  <YAxis stroke="#334155" />
                  <Tooltip />
                  <Line type="monotone" dataKey="volume" name="Volume" stroke="#f97316" strokeWidth={3} dot />
                  <Line type="monotone" dataKey="sets" name="Set" stroke="#0f766e" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : <p className="text-slate-600">Chưa có buổi tập đủ dữ liệu để vẽ.</p>}
          </div>
        )}
      </div>
    </section>
  );
}

function ExerciseProgressPicker({ exercises, value, onChange }) {
  const [open, setOpen] = useState(false);
  const selected = exercises.find((exercise) => exercise.id === value);
  return (
    <div className="exercise-picker">
      <button type="button" className="exercise-picker-button" onClick={() => setOpen((current) => !current)}>
        {selected?.imageUrl && <img src={selected.imageUrl} alt="" />}
        <span>{selected?.name || 'Chọn bài tập'}</span>
      </button>
      {open && (
        <div className="exercise-picker-menu">
          {exercises.map((exercise) => (
            <button
              type="button"
              key={exercise.id}
              className={`exercise-picker-option ${exercise.id === value ? 'active' : ''}`}
              onClick={() => {
                onChange(exercise.id);
                setOpen(false);
              }}
            >
              {exercise.imageUrl && <img src={exercise.imageUrl} alt="" />}
              <span>{exercise.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsPage({ userId, boot, onChanged }) {
  const [name, setName] = useState(boot.activeUser.name);
  const [password, setPassword] = useState('');
  const [timezone, setTimezone] = useState(boot.settings.timezone || fallbackDisplay.timezone);
  const [locale, setLocale] = useState(boot.settings.locale || fallbackDisplay.locale);
  const [heightCm, setHeightCm] = useState(boot.settings.height_cm || '');
  const [avatarPreview, setAvatarPreview] = useState(boot.activeUser.avatar || '');
  const timezoneChoices = useMemo(timezoneSelectOptions, []);
  const addUser = async () => {
    const name = prompt('Tên thành viên');
    const username = prompt('Tên đăng nhập');
    const password = prompt('Mật khẩu');
    if (!name || !username || !password) return;
    await api('/api/users', { method: 'POST', body: JSON.stringify({ userId, name, username, password }) });
    location.reload();
  };
  const saveProfile = async () => {
    const body = { userId };
    if (name.trim()) body.name = name.trim();
    if (password.trim()) body.password = password.trim();
    if (avatarPreview !== boot.activeUser.avatar) body.avatar = avatarPreview;
    const updated = await api(`/api/users/${userId}`, { method: 'PATCH', body: JSON.stringify(body) });
    localStorage.setItem('familyGymUser', JSON.stringify(updated));
    location.reload();
  };
  const saveDisplay = async () => {
    await api('/api/settings', { method: 'PATCH', body: JSON.stringify({ userId, timezone, locale, heightCm: heightCm || null }) });
    onChanged?.();
  };
  const pickAvatar = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setAvatarPreview(String(reader.result));
    reader.readAsDataURL(file);
  };
  return (
    <section className="space-y-4">
      <div className="panel">
        <h2 className="section-title">Hồ sơ của tôi</h2>
        <div className="mb-4 flex items-center gap-3">
          <div className="avatar-preview">{avatarContent(avatarPreview)}</div>
          <label className="small-action cursor-pointer">
            Chọn ảnh
            <input className="hidden" type="file" accept="image/*" onChange={(event) => pickAvatar(event.target.files?.[0])} />
          </label>
          <button className="small-danger" onClick={() => setAvatarPreview(name.trim().slice(0, 2).toUpperCase())}>Xoá ảnh</button>
        </div>
        <label className="label">Tên hiển thị</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="label mt-3">Mật khẩu mới</label>
        <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Để trống nếu không đổi" />
        <button className="primary mt-3" onClick={saveProfile}>Lưu thay đổi</button>
      </div>
      <div className="panel">
        <h2 className="section-title">Thời gian và ngôn ngữ</h2>
        <label className="label">Mốc thời gian</label>
        <select className="input" value={timezone} onChange={(event) => setTimezone(event.target.value)}>
          {timezoneChoices.map((item) => <option key={item.name} value={item.name}>{item.label}</option>)}
        </select>
        <label className="label mt-3">Ngôn ngữ / đất nước</label>
        <select className="input" value={locale} onChange={(event) => setLocale(event.target.value)}>
          {localeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <label className="label mt-3">Chiều cao để tính BMI</label>
        <input className="input" type="number" min="50" max="260" step="0.5" value={heightCm} onChange={(event) => setHeightCm(event.target.value)} placeholder="Ví dụ: 170" />
        <p className="mt-2 text-sm text-slate-600">Xem trước: {formatDateTime(new Date(), { timezone, locale }, { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
        <button className="primary mt-3" onClick={saveDisplay}>Lưu hiển thị</button>
      </div>
      <div className="panel">
        <h2 className="section-title">Dữ liệu</h2>
        <p className="text-sm text-teal-900">{boot.exerciseCount} bài tập từ hasaneyldrm</p>
        <button className="primary mt-3" onClick={() => window.open(`/api/export?userId=${userId}`, '_blank')}>Export JSON</button>
      </div>
      {boot.activeUser.role === 'ADMIN' && <div className="panel">
        <h2 className="section-title">Thành viên gia đình</h2>
        <button className="primary" onClick={addUser}>Thêm thành viên</button>
        <AdminUsers users={boot.users} adminId={userId} />
      </div>}
    </section>
  );
}

function AdminUsers({ users, adminId }) {
  const [drafts, setDrafts] = useState(() => Object.fromEntries(users.map((user) => [user.id, { name: user.name, password: '' }])));

  const save = async (targetId) => {
    const draft = drafts[targetId];
    const body = { userId: adminId, name: draft.name };
    if (draft.password.trim()) body.password = draft.password.trim();
    await api(`/api/users/${targetId}`, { method: 'PATCH', body: JSON.stringify(body) });
    location.reload();
  };
  const remove = async (targetId) => {
    if (!confirm('Xoá thành viên này? Dữ liệu tập của thành viên cũng sẽ bị xoá.')) return;
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
            placeholder="Mật khẩu mới"
            value={drafts[user.id]?.password || ''}
            onChange={(event) => setDrafts((old) => ({ ...old, [user.id]: { ...(old[user.id] || {}), password: event.target.value } }))}
          />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button className="primary" onClick={() => save(user.id)}>Lưu thành viên</button>
            <button className="danger-btn" disabled={user.id === adminId} onClick={() => remove(user.id)}>Xoá</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Chip({ active, children, onClick }) {
  return <button onClick={onClick} className={`chip ${active ? 'active' : ''}`}>{children}</button>;
}

createRoot(document.getElementById('root')).render(<App />);
