---
description: "Управление беклогом RLM. Usage: /backlog add <текст> | /backlog list | /backlog done <номер>"
argument-hint: add <текст> | list | done <номер>
allowed-tools: Bash, Read, Edit, Write
---

Управляешь файлом беклога в RLM-вальте.

**ARGUMENTS:** $ARGUMENTS

## Подготовка

1. Определи путь:
   ```bash
   VAULT_ROOT="${VAULT_PATH:-$HOME/vault}/RLM"
   BACKLOG="$VAULT_ROOT/Backlog.md"
   mkdir -p "$VAULT_ROOT"
   if [ ! -f "$BACKLOG" ]; then
     printf '# Backlog\n\n' > "$BACKLOG"
   fi
   ```

2. Распарсь `$ARGUMENTS`:
   - Первое слово = subcommand: `add` | `list` | `done`
   - Остаток = payload (`add` → текст задачи, `done` → число)

subcommand не распознан или `$ARGUMENTS` пусто → ответь:
```
Usage: /backlog add <текст> | /backlog list | /backlog done <номер>
```
и стоп.

## Subcommand: add

1. `TEXT` = остаток аргументов (после слова `add`).
2. `TEXT` пуст → `Error: /backlog add требует текст задачи`.
3. `TIMESTAMP` = `$(date '+%Y-%m-%d %H:%M')`.
4. Read `$BACKLOG`, append:
   ```
   - [ ] <TIMESTAMP> — <TEXT>
   ```
5. Write `$BACKLOG`.
6. Ответ юзеру:
   ```
   ✅ Добавлено: <TEXT>
   ```

## Subcommand: list

1. Read `$BACKLOG`.
2. Извлечь **только** строки матчащие regex `^- \[ \] ` (пробел внутри скобок = незакрытые).
3. Пронумеровать с 1. Показать в чате:
   ```
   Открытые задачи (<N>):
   1. <текст задачи без префикса "- [ ] YYYY-MM-DD HH:MM — ">
   2. ...
   ```
4. Пусто → `Беклог пуст. Добавь задачу: /backlog add <текст>`.

Текст задачи для отображения = всё после первого ` — ` (тире с пробелами).

## Subcommand: done

1. `N` = первый токен после `done`. Не число или ≤ 0 → `Error: /backlog done требует положительный номер`.
2. Read `$BACKLOG`, разбить на строки.
3. Найти N-ю строку матчащую `^- \[ \] ` (только незакрытые).
4. Нет такой строки → `Error: нет открытой задачи с номером <N>. Беклог: <count> открытых.`.
5. Заменить `- [ ] ` → `- [x] ` (timestamp + текст оставить как есть).
6. Write `$BACKLOG`.
7. Ответ юзеру:
   ```
   ✅ Закрыто: <текст задачи>
   ```

## Гарды

- Не ломай строки не совпадающие с паттерном (`# Backlog`, пустые, `[x]`) — оставить как есть.
- `list` + `done` нумеруют по порядку **только незакрытых** пунктов → консистентно между командами.