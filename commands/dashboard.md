---
description: Пересобрать Dashboard.md в вальте. Считает задачи, средние итерации, список беклога и последние дни.
allowed-tools: Bash, Read, Write
---

Пересобрать сводку RLM-вальта в `Dashboard.md`.

## Шаги

### 1. Подготовка

```bash
VAULT_ROOT="${VAULT_PATH:-$HOME/vault}/RLM"
DASHBOARD="$VAULT_ROOT/Dashboard.md"
BACKLOG="$VAULT_ROOT/Backlog.md"
DAILY_DIR="$VAULT_ROOT/Daily"
mkdir -p "$DAILY_DIR"
TODAY="$(date +%Y-%m-%d)"
NOW="$(date '+%Y-%m-%d %H:%M')"
```

### 2. Собрать статистику

**Всего решено задач** (блок задачи в daily начинается с `## HH:MM — `):
```bash
TOTAL=$(grep -h -E '^## [0-9]{2}:[0-9]{2} — ' "$DAILY_DIR"/*.md 2>/dev/null | wc -l)
```

**Сегодня:**
```bash
TODAY_FILE="$DAILY_DIR/$TODAY.md"
if [ -f "$TODAY_FILE" ]; then
  TODAY_COUNT=$(grep -c -E '^## [0-9]{2}:[0-9]{2} — ' "$TODAY_FILE")
else
  TODAY_COUNT=0
fi
```

**Средние итерации.** Парсить `**Iterations:** N | **Mode:** ...` во всех daily. Собрать N, среднее с 1 знаком после точки:
```bash
# если файлов нет или данных нет → AVG_ITER = 0.0
AVG_ITER=$(grep -h -oE '\*\*Iterations:\*\* [0-9]+' "$DAILY_DIR"/*.md 2>/dev/null \
  | awk '{print $2}' \
  | awk 'BEGIN{s=0;n=0} {s+=$1; n+=1} END { if(n==0) print "0.0"; else printf "%.1f", s/n }')
```

### 3. Собрать беклог

Первые 5 открытых (матч `^- \[ \] `) из `$BACKLOG`. Нет файла → пусто.

```bash
if [ -f "$BACKLOG" ]; then
  BACKLOG_OPEN=$(grep -E '^- \[ \] ' "$BACKLOG" | head -5)
else
  BACKLOG_OPEN=""
fi
```

### 4. Собрать последние дни

Последние 5 daily по имени (имя = дата, сорт убыв.):

```bash
# для каждого файла получить имя без .md и количество задач в нём
LAST_DAYS=$(ls "$DAILY_DIR"/*.md 2>/dev/null | sort -r | head -5)
```

Каждый файл → задачи отдельным grep: `grep -c -E '^## [0-9]{2}:[0-9]{2} — ' <file>`.

### 5. Собрать и записать Dashboard.md

Сконструировать (Write по `$DASHBOARD`, полная перезапись):

```
# RLM Dashboard

Обновлено: <NOW>

## Стата
- Всего решено задач: <TOTAL>
- Сегодня: <TODAY_COUNT>
- Средние итерации: <AVG_ITER>

## Беклог (открытые)
<если BACKLOG_OPEN пустой — написать "- _(пусто)_", иначе вставить первые 5 строк ровно как есть, без изменений>

## Последние дни
- [[Daily/<date1>]] — <count1> tasks
- [[Daily/<date2>]] — <count2> tasks
...

<если daily-файлов нет — написать "- _(ещё нет)_" вместо списка>
```

Формат строки «Последние дни»: имя без `.md` и пути, т.е. `YYYY-MM-DD`.

### 6. Ответить пользователю

```
📊 Dashboard обновлён: <DASHBOARD>

Всего: <TOTAL> | Сегодня: <TODAY_COUNT> | Ср. итераций: <AVG_ITER>
```

`AVG_ITER > 2.0` → добавить:
```
⚠️  Средние итерации > 2 — возможно критик слишком строгий, стоит пересмотреть промпт.
```