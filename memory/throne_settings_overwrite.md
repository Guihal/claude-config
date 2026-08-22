---
name: throne-settings-overwrite
description: Throne перезаписывает таблицу settings из памяти при выходе — правки применяются только при закрытом приложении
metadata: 
  node_type: memory
  type: project
  originSessionId: c5fa36f2-cec7-476a-a256-ad8a53c5d2f5
  modified: 2026-08-17T16:34:39.777Z
---

Throne (`~/.config/Throne/config/throne.db`) держит таблицу `settings` в памяти и **перезаписывает её при выходе**. Правка на живую молча теряется: `utlsFingerprint`, `tls_tricks_default_on`, `fragment_default_on` откатились к прежним значениям после перезапуска приложения. Таблица `profiles` (`outbound_json`) так себя не ведёт — правки в ней уцелели.

**Why:** потратил лишний раунд, применив настройки при работающем Throne и решив по факту записи, что они легли.

**How to apply:** `settings` править только при закрытом Throne. Удобный приём без дёрганья юзера — фоновый сторож `until ! pgrep -x Throne; do sleep 1; done; sleep 3; <патч>`: ловит окно между закрытием и стартом, юзер просто перезапускает приложение как обычно. Клиентские anti-DPI параметры (`utls`, `alpn`) лучше класть **в профиль**, а не в глобальные настройки — профиль переживает перезапуск, и `utls: chrome` из профиля работает без глобального `utlsFingerprint`. Проверять результат замером ClientHello на сервере, а не чтением базы. Связано с [[vpn-server-ssh-via-tunnel]].
