---
name: github_two_accounts
description: Два GitHub-аккаунта — Guihal (личный, по умолчанию) и WebAppLabPlatform через отдельный ключ и хост-алиас
metadata:
  type: reference
---

На машине два GitHub-аккаунта:
- **Guihal** — личный, ключ по умолчанию, обычный `git@github.com:…`. Сюда смотрит
  `~/.claude` (`git@github.com:Guihal/claude-config.git`, репозиторий приватный).
- **WebAppLabPlatform** — рабочий. Отдельный ключ `~/.ssh/id_ed25519_webapplab` и хост-алиас
  `github.com-webapplab` в `~/.ssh/config`; клонировать и пушить его репозитории нужно через
  алиас, иначе GitHub аутентифицирует как личный аккаунт и отдаёт 403 на чужой репозиторий.

Отдельный ключ заведён именно потому, что один ключ нельзя привязать к двум аккаунтам GitHub —
это ограничение GitHub, а не прихоть конфигурации.

Самопроверка: `ssh -T git@github.com` и `ssh -T git@github.com-webapplab` называют разные
аккаунты. Ключи не читать и не выводить — только использовать.
