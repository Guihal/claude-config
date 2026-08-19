---
name: obsidian
description: Use when writing/reading/creating files in RLM vault at ~/vault/RLM/. Defines paths, filename conventions, markdown formats для Daily notes, Backlog, Dashboard. Consult before vault file ops.
---

# Obsidian (RLM vault) conventions

## Пути

- `VAULT_ROOT` = `$HOME/vault/RLM` (override через env `VAULT_PATH` → `VAULT_ROOT` = `$VAULT_PATH/RLM`)
- Daily notes → `$VAULT_ROOT/Daily/YYYY-MM-DD.md`
- Backlog → `$VAULT_ROOT/Backlog.md`
- Dashboard → `$VAULT_ROOT/Dashboard.md`

## Первичная инициализация

Перед любой записью **всегда**:
```bash
VAULT_ROOT="${VAULT_PATH:-$HOME/vault}/RLM"
mkdir -p "$VAULT_ROOT/Daily"
```

`Backlog.md` или `Dashboard.md` нет → создать с заголовком (форматы ниже) при первой записи.

## Формат Daily-note

Путь: `$VAULT_ROOT/Daily/<date +%Y-%m-%d>.md`.

Файл отсутствует → создать с первой строкой:
```
# YYYY-MM-DD
```

Каждый `/task` **append** блок к концу файла:

```
## HH:MM — <task-excerpt ≤ 80 символов>
**Iterations:** N | **Mode:** draft|mvp|final

### Финальное решение
<полный текст финального решения>

### История фидбэка
1. (critic) <feedback-строка от первой итерации>
2. (critic) <feedback-строка от второй итерации>

---
```

Правила:
- `HH:MM` — локальное время, `date +%H:%M`
- `<task-excerpt>` — первые 80 символов задачи, без переносов, без маркдаун-спецсимволов
- `N` = число итераций (0 если критик сразу принял); = кол-во фидбэков ПЕРЕД финальным решением. Итерация 0 = с первого раза ок.
- `Mode` — из последнего ответа критика (`draft`/`mvp`/`final`), либо `parse_error` если JSON не распарсился, либо `maxDepth` при потолке без ok
- `### История фидбэка` **опустить** если `N == 0`
- Завершающий `---` обязателен — отделяет задачи

## Формат Backlog.md

Первая строка:
```
# Backlog
```

Пустая строка + список:
```
- [ ] YYYY-MM-DD HH:MM — текст задачи
- [x] YYYY-MM-DD HH:MM — закрытая задача
```

Правила:
- Новые задачи → в конец (не начало)
- `done <N>` → N-й **незакрытый** пункт (считать только `- [ ]`) → `- [x]`, timestamp **не** менять
- `list` → пронумерованный список только незакрытых: `1. <текст>`, `2. <текст>`

## Формат Dashboard.md

```
# RLM Dashboard

Обновлено: YYYY-MM-DD HH:MM

## Стата
- Всего решено задач: <int>
- Сегодня: <int>
- Средние итерации: <float с 1 знаком после точки>

## Беклог (открытые)
- [ ] <первый открытый>
- [ ] <второй>
... (максимум 5)

## Последние дни
- [[Daily/YYYY-MM-DD]] — <int> tasks
... (максимум 5, новые сверху)
```

Правила:
- «Всего решено задач» = строки matching regex `^## \d{2}:\d{2} —` во всех `Daily/*.md`
- «Сегодня» = тот же счёт только в `Daily/$(date +%Y-%m-%d).md`
- «Средние итерации» = среднее `**Iterations:** N` по всем daily-блокам; задач 0 → `0.0`
- «Последние дни» — сортировка по имени файла (= дата) по убыванию

## Реализация (для главной сессии)

Все операции — bash + Write/Edit. Сторонние инструменты не нужны. Пример append к daily-note:

```bash
VAULT_ROOT="${VAULT_PATH:-$HOME/vault}/RLM"
DAILY="$VAULT_ROOT/Daily/$(date +%Y-%m-%d).md"
mkdir -p "$VAULT_ROOT/Daily"
if [ ! -f "$DAILY" ]; then
  printf '# %s\n' "$(date +%Y-%m-%d)" > "$DAILY"
fi
# затем Write/Edit с append-ом блока
```

Edit-режим → `Read` для текущего содержимого, затем `Write` с новым = старое + новый блок.