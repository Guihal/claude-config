---
name: projects_root
description: "Рабочие репозитории живут в /home/penis/projects; состав каталога перечисляется командой, project-local AGENTS.md приоритетнее глобальных инструкций"
metadata: 
  node_type: memory
  type: reference
  originSessionId: b1ce026b-2ed5-4c61-affb-b2aaaa63254f
  modified: 2026-08-22T14:36:36.892Z
---

Рабочие проекты и репозитории лежат в `/home/penis/projects`. Состав каталога быстро меняется,
поэтому список сюда не выписывается — он получается командой в момент вопроса:

```bash
ls -1 /home/penis/projects
for d in /home/penis/projects/*/; do [ -d "$d/.git" ] && basename "$d"; done   # только git-репозитории
```

Долгоживущие из них, встречающиеся в разговоре: `cosmic-comp` (Rust/Cargo, форк композитора
COSMIC), `eleishkina` (WordPress/PHP плюс node-тулинг, тема
`wordpress/wp-content/themes/eleshlenkina`), `forestResident` (node), `Auto-zelenyn`. Отсутствие
имени в этом перечне ничего не значит — проверяй `ls`.

**Project-local `AGENTS.md` / `CLAUDE.md` внутри репозитория старше глобальных инструкций** для
работы в его границах: сначала читается он, потом действуют общие правила.
