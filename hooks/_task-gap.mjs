// _task-gap.mjs — state-aware нудж по списку задач.
//
// Нативная напоминалка Claude Code про список задач — КОНСТАНТА на каждом ходу → баннерная
// слепота (агент её проскроллил весь сеанс). Этот хелпер бьёт РЕЗКОЙ строкой ТОЛЬКО когда разрыв
// реален, и молчит при соответствии — сигнал пропорционален разрыву, а не фон.
//
// Три разрыва:
//   1) 0 задач в списке при >= K тул-коллах с последнего сообщения юзера;
//   2) задачи есть, но ни одной in_progress (и не все закрыты);
//   3) in_progress висит >= STALE_MIN минут без апдейта (mtime файла задачи), рейт-лимит на окно.
//
// Стор задач — нативный: ~/.claude/tasks/session-<первые8 session_id>/<id>.json, поле status.
// Таймстемпа в json нет → свежесть берём из mtime файла (TaskUpdate перезаписывает файл).
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  mkdirSync,
} from "node:fs";

const TASKS_DIR = "/home/penis/.claude/tasks";
const CTR_DIR = "/home/penis/.claude/hooks/.task-gap-state";
const K = 3; // порог тул-коллов без списка
const STALE_MIN = 10; // in_progress висит дольше → напоминание, не чаще раза в окно

function sid8(sessionId) {
  return String(sessionId || "").slice(0, 8);
}

// {count, inProgress, allDone, staleInProgressMin, everHadTasks}
// everHadTasks: сессия хоть раз заводила список. Стор хранит только активные задачи (completed
// прунятся), поэтому count===0 не отличает «списка не было» от «всё закрыто». Различает
// .highwatermark — монотонный счётчик созданных id: >0 значит список уже вёлся.
function readTaskState(sessionId) {
  const dir = `${TASKS_DIR}/session-${sid8(sessionId)}`;
  if (!existsSync(dir))
    return { count: 0, inProgress: 0, allDone: false, staleInProgressMin: 0, everHadTasks: false };
  let everHadTasks = false;
  try {
    everHadTasks = (parseInt(readFileSync(`${dir}/.highwatermark`, "utf8"), 10) || 0) > 0;
  } catch {
    // нет highwatermark — считаем, что список не заводился
  }
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return { count: 0, inProgress: 0, allDone: false, staleInProgressMin: 0, everHadTasks };
  }
  let inProgress = 0;
  let done = 0;
  let oldestInProgMtime = Infinity;
  for (const f of files) {
    try {
      const p = `${dir}/${f}`;
      const s = JSON.parse(readFileSync(p, "utf8")).status;
      if (s === "in_progress") {
        inProgress += 1;
        oldestInProgMtime = Math.min(oldestInProgMtime, statSync(p).mtimeMs);
      }
      if (s === "completed" || s === "deleted") done += 1;
    } catch {
      // битый файл задачи не должен ронять нудж
    }
  }
  const staleInProgressMin =
    inProgress > 0 ? Math.floor((Date.now() - oldestInProgMtime) / 60000) : 0;
  return {
    count: files.length,
    inProgress,
    allDone: files.length > 0 && done === files.length,
    staleInProgressMin,
    everHadTasks,
  };
}

// Стейт на сессию: {n, lastStaleMs}. source:"user" сбрасывает счётчик тул-коллов.
function readCtr(sessionId) {
  const p = `${CTR_DIR}/${sid8(sessionId)}.json`;
  try {
    return { p, ...JSON.parse(readFileSync(p, "utf8")) };
  } catch {
    return { p, n: 0, lastStaleMs: 0 };
  }
}

function writeCtr(st) {
  try {
    mkdirSync(CTR_DIR, { recursive: true });
    writeFileSync(st.p, JSON.stringify({ n: st.n, lastStaleMs: st.lastStaleMs }));
  } catch {
    // счётчик эфемерный — потеря записи не критична
  }
}

// Единственный экспорт: строка-алярм ЛИБО "" (молчит при соответствии).
export function taskGapNudge(sessionId, source) {
  if (!sessionId) return "";
  const st = readCtr(sessionId);
  st.n = source === "user" ? 0 : (st.n || 0) + 1;
  const { count, inProgress, allDone, staleInProgressMin, everHadTasks } =
    readTaskState(sessionId);
  let out = "";
  if (count === 0 && st.n >= K && !everHadTasks) {
    // Бьём только если список НИ РАЗУ не заводился. Заводился и опустел (всё закрыто) — молчим:
    // цель ветки — поймать сессию, вообще не тронувшую список, а не финиш пачки.
    out = `⚠ [task-gap] ${st.n} тул-коллов, задач в списке 0. Поставь список ДО следующего шага: TaskCreate (50-task-list). Тривиальная разовая операция — игнорируй.`;
  } else if (count > 0 && inProgress === 0 && !allDone) {
    out = `⚠ [task-gap] в списке нет ни одной in_progress — отметь текущий шаг: TaskUpdate.`;
  } else if (
    staleInProgressMin >= STALE_MIN &&
    Date.now() - (st.lastStaleMs || 0) >= STALE_MIN * 60000
  ) {
    // рейт-лимит: не чаще раза в окно, иначе строка на каждый тул-колл = та же слепота
    out = `⚠ [task-gap] in_progress висит ${staleInProgressMin} мин без апдейта — не проебал ли список, батенька? Шаг закрыт → completed + следующий in_progress; ещё в работе → так и оставь.`;
    st.lastStaleMs = Date.now();
  }
  writeCtr(st);
  return out;
}
