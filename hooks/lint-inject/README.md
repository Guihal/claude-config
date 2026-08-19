# lint-inject for Claude Code

После `Edit`, `Write` и `NotebookEdit` запускает линтеры для реально изменённых
файлов и возвращает диагностику как `PostToolBatch.additionalContext`.

Это адаптация Pi `lint-inject` под процессную модель Claude Code. Pi держит
сессию и TypeScript watch daemon, а Claude запускает отдельный command hook на
каждый батч. Поэтому здесь используются ограниченные cold-запуски без фоновых
процессов.

## Entry point

В `.claude/settings.json` зарегистрирован:

```text
/home/penis/.bun/bin/bun /home/penis/.claude/hooks/lint-inject-posttoolbatch.mjs
```

Wrapper принимает JSON `PostToolBatch`, дедуплицирует абсолютные пути из
`Edit`/`Write`/`NotebookEdit`, пропускает generated/vendor-каталоги и запускает
engine в worker thread. Ошибки линта advisory: wrapper всегда fail-open и не
блокирует Claude.

## Project hook и watchdog

В корне проекта можно создать `lint-inject.config.ts`:

```ts
export function hook(fileAbs: string, plan: ResolvedPlan): ResolvedPlan | null | void {
  return plan; // null отменяет lint для файла, void оставляет default plan
}
```

Загрузка модуля и вызов функции делят один общий дедлайн 1000 мс. Async timeout
возвращает fallback plan и секцию `[lint-inject] hook: ...`. Wrapper ждёт
`plans-resolved` 1250 мс: дополнительные 250 мс нужны для worker scheduling.
Синхронно зависший import/hook принудительно завершается внешним watchdog.
После `plans-resolved` worker получает полный lint budget и завершается после
единственного terminal `report`/`error` сообщения.

## Авто-конфиги

Если бинарь найден, но обязательного project config нет, временно создаются Pi
defaults:

- `eslint.config.mjs` для ESLint;
- `tsconfig.json` для `tsc`/`vue-tsc`;
- `stylelint.config.mjs` для Stylelint;
- `.markdownlintrc` для Markdownlint.

Пользовательский конфиг, найденный walk-up до home, всегда приоритетнее. Файл
создаётся через exclusive create и содержит `AUTO-GENERATED-BY-LINT-INJECT` в
первых 500 символах. Unmarked-файлы никогда не перезаписываются и не удаляются.

Параллельные hook-процессы координируются physical-root lock и PID/token leases
в `/tmp/claude-lint-inject`. Symlink aliases используют один physical root.
Конфиг удаляет только последний живой owner; dead owners подчищаются при
следующем acquire. Cleanup выполняется в `finally` после success, diagnostics,
parse failure, timeout или abort.

На время запуска созданный файл скрывается точным owned-блоком в Git exclude.
Поддерживаются обычный `.git` каталог, `.git` pointer file, linked worktree
`commondir` и submodule gitdir. Cleanup удаляет только свой marker/path block и
сохраняет остальные байты.

## TypeScript

Pi daemon intent адаптируется к одному bounded cold invocation. Из аргументов
удаляются `--watch` и `--preserveWatchOutput`, добавляются `--noEmit` и
`--pretty false`. Существующий ближайший `tsconfig.json` определяет cwd;
root-default не создаётся поверх nested project config.

## Языки

Реестр сохраняет 17 Pi definitions: TypeScript, JavaScript, Vue, CSS, SCSS,
Python, shell, Markdown, JSON, PHP, Rust, Go, YAML, HTML, SQL, TOML и Dockerfile.
Локальный `node_modules/.bin` имеет приоритет; PATH fallback разрешён по правилам
линтера и project boundary.

## Проверка

```bash
node --test /home/penis/.claude/hooks/lint-inject/tests/*.test.mjs

find /home/penis/.claude/hooks/lint-inject -type f -name '*.ts' -print0 |
  xargs -0 /home/penis/projects/forestResident/node_modules/.bin/tsc \
    --noEmit --target es2022 --module esnext --moduleResolution bundler \
    --allowImportingTsExtensions --skipLibCheck --strict --types node \
    --typeRoots /home/penis/.pi/agent/extensions/node_modules/@types
```

Проверять продукт нужно через настоящий Bun wrapper с `PostToolBatch` payload,
а не только импортом engine: так покрываются Claude JSON-контракт, worker
handshake, watchdog, output truncation и fail-open exit code.
