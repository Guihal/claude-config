// _task-gap.mjs — state-aware нудж по списку задач.
//
// Нативная напоминалка Claude Code про список задач — КОНСТАНТА на каждом ходу → баннерная
// слепота (агент её проскроллил весь сеанс). Этот хелпер бьёт РЕЗКОЙ строкой ТОЛЬКО когда разрыв
// реален, и молчит при соответствии — сигнал пропорционален разрыву, а не фон.
//
// Три разрыва:
//   1) 0 задач в списке при >= K тул-коллах (монотонный счётчик nTotal);
//   2) задачи есть, но ни одной in_progress (и не все закрыты);
//   3) in_progress висит >= STALE_MIN минут без апдейта (mtime файла задачи), рейт-лимит на окно.
//
// Ветка 1 бьёт ВСЕГДА при count===0 и nTotal>=K — даже если список раньше вёлся и всё закрыто:
// агент может забыть завести список посреди сессии. Рейт-лимит Z: не чаще раза в Z вызовов
// по шкале nTotal (монотонный счётчик, НЕ сбрасывается user-сообщением).
//
// Каждая ветка → массив вариантов текста (pickVariant из core.mjs), чтобы не сливаться в кучу
// при повторных срабатываниях.
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
import { pickVariant } from "../mcp/injection-rules/core.mjs";

export const TASKS_DIR =
  process.env.IR_TASKS_DIR || "/home/penis/.claude/tasks";
export const CTR_DIR =
  process.env.IR_TASK_GAP_CTR_DIR ||
  "/home/penis/.claude/hooks/.task-gap-state";

const K = 3; // порог тул-коллов без списка
const STALE_MIN = 10; // in_progress висит дольше → напоминание, не чаще раза в окно
// Рейт-лимит ветки «0 задач»: не чаще раза в Z вызовов по шкале nTotal.
// Без Z строка идёт на КАЖДОМ тул-колле (наблюдаемо: счётчик 3,4,5,6,… в одном ходу)
// и превращается в тот самый фон, против которого нудж и сделан.
const Z = 8;

function sid8(sessionId) {
  return String(sessionId || "").slice(0, 8);
}

// {count, inProgress, allDone, staleInProgressMin}
// Стор хранит только активные задачи (completed прунятся), поэтому count===0 может значить
// «списка не было» ИЛИ «всё закрыто». Оба случая → бить: агент может забыть завести список
// посреди сессии, а может закрыть пачку и не начать следующую.
function readTaskState(sessionId) {
  const dir = `${TASKS_DIR}/session-${sid8(sessionId)}`;
  if (!existsSync(dir))
    return { count: 0, inProgress: 0, allDone: false, staleInProgressMin: 0 };
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return { count: 0, inProgress: 0, allDone: false, staleInProgressMin: 0 };
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
  };
}

// Стейт на сессию: {n, nTotal, lastStaleMs, lastZeroN, lastVariant}.
// n — падающий (сбрасывается user-сообщением) для K-порога.
// nTotal — монотонный (НЕ сбрасывается) для рейт-лимита Z.
// lastZeroN — последний nTotal, при котором ветка «0 задач» сработала.
function readCtr(sessionId) {
  const p = `${CTR_DIR}/${sid8(sessionId)}.json`;
  try {
    return { p, ...JSON.parse(readFileSync(p, "utf8")) };
  } catch {
    return { p, n: 0, nTotal: 0, lastStaleMs: 0, lastZeroN: 0, lastVariant: {} };
  }
}

function writeCtr(st) {
  try {
    mkdirSync(CTR_DIR, { recursive: true });
    writeFileSync(
      st.p,
      JSON.stringify({
        n: st.n,
        nTotal: st.nTotal,
        lastStaleMs: st.lastStaleMs,
        lastZeroN: st.lastZeroN,
        lastVariant: st.lastVariant,
      }),
    );
  } catch {
    // счётчик эфемерный — потеря записи не критична
  }
}

// Варианты текста для каждой ветки. Ядро-процедура неизменна, варьируется обёртка.
const VARIANTS_ZERO_TASKS = [
  `⚠ [task-gap] ${"{n}"} тул-коллов, задач в списке 0. Заведи следующий шаг (TaskCreate) ИЛИ подтверди, что пачка закрыта — поставь последней задаче completed.`,
  `⚠ [task-gap] ${"{n}"} тул-коллов — список пуст. Следующий шаг через TaskCreate; пачка закрыта → закрой последнюю задачу через TaskUpdate.`,
  `⚠ [task-gap] ${"{n}"} тул-коллов без списка задач. Нужен TaskCreate для следующего шага — или заверши пачку (completed на последней задаче).`,
];

const VARIANTS_NO_IN_PROGRESS = [
  `⚠ [task-gap] в списке нет ни одной in_progress — отметь текущий шаг: TaskUpdate.`,
  `⚠ [task-gap] ни одна задача не in_progress. Пометь текущий 작업 TaskUpdate'ом.`,
  `⚠ [task-gap] все задачи в покое — ни одна не in_progress. Отметь текущий: TaskUpdate.`,
];

const VARIANTS_STALE = [
  `⚠ [task-gap] in_progress висит ${"{min}"} мин без апдейта — не проебал ли список, батенька? Шаг закрыт → completed + следующий in_progress; ещё в работе → так и оставь.`,
  `⚠ [task-gap] in_progress ${"{min}"} мин без обновления. Закрыл → completed; ещё делаешь → обнови статус через TaskUpdate.`,
  `⚠ [task-gap] ${"{min}"} мин тишины по in_progress. Заверши (completed) или подтверди (TaskUpdate), иначе нудж будет долбить.`,
];

// Единственный экспорт: строка-алярм ЛИБО "" (молчит при соответствии).
export function taskGapNudge(sessionId, source) {
  if (!sessionId) return "";
  const st = readCtr(sessionId);
  // n — падающий (сбрасывается user), для K-порога
  st.n = source === "user" ? 0 : (st.n || 0) + 1;
  // nTotal — монотонный (НЕ сбрасывается), для рейт-лимита Z
  st.nTotal = (st.nTotal || 0) + 1;

  const { count, inProgress, allDone, staleInProgressMin } =
    readTaskState(sessionId);
  let out = "";

  if (count === 0 && st.n >= K) {
    // Ветка 1: 0 задач — бьёт ВСЕГДА (даже если список раньше вёлся и всё закрыто).
    // Агент может забыть завести список посреди сессии ИЛИ закрыть пачку и не начать следующую.
    // Рейт-лимит Z: не чаще раза в Z вызовов по шкале nTotal.
    if ((st.nTotal || 0) - (st.lastZeroN || 0) >= Z) {
      const { text, index } = pickVariant(
        VARIANTS_ZERO_TASKS,
        st.lastVariant?.zeroTasks,
      );
      out = text.replace("{n}", String(st.n));
      if (!st.lastVariant) st.lastVariant = {};
      st.lastVariant.zeroTasks = index;
      st.lastZeroN = st.nTotal;
    }
  } else if (count > 0 && inProgress === 0 && !allDone) {
    // Ветка 2: задачи есть, ни одна не in_progress, не все закрыты
    const { text, index } = pickVariant(
      VARIANTS_NO_IN_PROGRESS,
      st.lastVariant?.noInProgress,
    );
    out = text;
    if (!st.lastVariant) st.lastVariant = {};
    st.lastVariant.noInProgress = index;
  } else if (
    staleInProgressMin >= STALE_MIN &&
    Date.now() - (st.lastStaleMs || 0) >= STALE_MIN * 60000
  ) {
    // Ветка 3: in_progress висит дольше STALE_MIN, рейт-лимит на окно
    const { text, index } = pickVariant(
      VARIANTS_STALE,
      st.lastVariant?.stale,
    );
    out = text.replace("{min}", String(staleInProgressMin));
    if (!st.lastVariant) st.lastVariant = {};
    st.lastVariant.stale = index;
    st.lastStaleMs = Date.now();
  }

  writeCtr(st);
  return out;
}
