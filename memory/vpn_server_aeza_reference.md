---
name: vpn_server_aeza_reference
description: "VPN-сервер Aeza 62.60.157.45 — топология HAProxy/Caddy/sing-box, anti-detection инварианты, операционные грабли и блок самопроверки (дословно)"
metadata: 
  node_type: memory
  type: reference
  originSessionId: b1ce026b-2ed5-4c61-affb-b2aaaa63254f
  modified: 2026-08-22T14:37:05.556Z
---

Перенесено ДОСЛОВНО из снесённого `/home/penis/AGENTS.md` (строки 80–158). Это измеренные
инварианты и рабочие команды, а не пересказываемое знание: переформулировка их портит, поэтому
текст оставлен как есть, включая исходный английский. Оперативная грабля «SSH идёт через сам
туннель» разобрана подробнее в [[vpn-server-ssh-via-tunnel]]; про перезапись настроек клиента —
[[throne-settings-overwrite]].

Топология и hardening — снимок на **2026-08-17**: перед изменением перечитывай живые конфиги на
сервере, а не эту запись. Инварианты ниже (ALPN, единый сертификат, отсутствие `fallback`,
кастомный `padding_scheme`, webroot у certbot) — свойства решения, а не снимок состояния.

---

## VPN server (Aeza, `62.60.157.45`)

Topology and hardening below are a snapshot from **2026-08-17**; re-read the
live configs before changing anything.

- Aeza KVM, Ubuntu 24.04. Two addresses: inbound `62.60.157.45`, **outbound
  `95.163.152.76`** — egress checks report the second one, that is not a leak.
- Port 443 is fronted by **HAProxy** doing L4 SNI routing
  (`/etc/haproxy/haproxy.cfg`):
  - `subbrain.dmtr.ru` **with `http/1.1` in ALPN** → Caddy `:8443` → decoy site.
  - `subbrain.dmtr.ru` **without it** → sing-box `:4443`, `anytls` inbound.
  - `google.com`, `mtp.dmtr.ru` → mtg `:2053` (MTProto fake-TLS).
  - `portfolio.dmtr.ru`, `*.task.chickenkiller.com` → Caddy `:8443`.
  - anything else → Caddy, which rejects the handshake (no matching cert).
- Also on the box: portfolio (Nuxt/Bun `:3000`), task-backend (`:8080`) with
  postgres in Docker, webhook (`:9000`). Ports 2053/4443/8443 are firewalled off
  from the outside; only 22/80/443 are exposed.

### Anti-detection invariants — do not break these

- **The anytls client must offer ALPN exactly `["h2"]`.** The decoy split keys
  off `http/1.1`; if the client ever offers it, the tunnel lands on the decoy
  site and the VPN stops working. uTLS `chrome` defaults to `h2,http/1.1`, so
  whenever uTLS is enabled, ALPN must be pinned explicitly in the same config.
- **sing-box and Caddy must serve the identical certificate on
  `subbrain.dmtr.ru`.** Two different serials on one name is itself a signature.
  Caddy reads a copy at `/etc/caddy/certs/subbrain/`, refreshed by the certbot
  deploy hook `/etc/letsencrypt/renewal-hooks/deploy/50-subbrain-distribute.sh`.
- **AnyTLS in sing-box has no `fallback` option** — `AnyTLSInboundOptions` is
  only `users` + `padding_scheme`, and an unauthenticated peer gets
  `fallback disabled` and a dropped connection. Anti-probing therefore has to
  live in front of it, in HAProxy. Do not go looking for a sing-box-side option.
- **Keep `padding_scheme` custom.** The upstream default is public and identical
  across every anytls server, which makes packet sizes a ready-made signature.
  The server pushes the scheme to clients itself (`cmdUpdatePaddingScheme`), so
  it is configured on the server only.
- `certbot` uses **webroot**, not standalone — port 80 belongs to Caddy, and
  standalone renewal fails with `Could not bind TCP port 80`.

### Operational gotchas

- **SSH to this host routes through the VPN itself.** Restarting sing-box or
  stopping Throne kills the running SSH session. Arm a timed auto-rollback
  before any change that needs a restart, verify the timer actually started
  (`pgrep -af`), and run long commands detached instead of holding them open.
- `caddy-app.service` runs with `admin off`, so **`systemctl reload` fails** —
  use `restart`. The deploy hook already does.
- `/etc/caddy/Caddyfile` is dead: `caddy-app.service` loads `app.Caddyfile`, and
  this build has no `layer4` module. Do not edit it expecting an effect.
- A catch-all `:8443` site block in Caddy **hijacks the named vhosts** and makes
  them serve the wrong certificate. Verified and reverted on 2026-08-17.
- Throne rewrites its `settings` table from memory on exit — see the assistant
  memory note `throne-settings-overwrite`.

### Self-check

```bash
# decoy path — expect: HTTP=200 size=4987
curl -s --resolve subbrain.dmtr.ru:443:62.60.157.45 https://subbrain.dmtr.ru/ \
  -o /dev/null -w "HTTP=%{http_code} size=%{size_download}\n"

# tunnel path — expect: subject=CN=subbrain.dmtr.ru, same cert as above
openssl s_client -connect 62.60.157.45:443 -servername subbrain.dmtr.ru \
  </dev/null 2>/dev/null | openssl x509 -noout -subject -fingerprint -sha256

# mtproto still routed to mtg — expect: subject=CN=*.google.com
openssl s_client -connect 62.60.157.45:443 -servername google.com \
  </dev/null 2>/dev/null | openssl x509 -noout -subject

# renewal — expect: "all simulated renewals succeeded"
ssh root@62.60.157.45 'certbot renew --dry-run --cert-name subbrain.dmtr.ru \
  --no-random-sleep-on-renew'
```

Rollback points from the 2026-08-17 hardening:
`/etc/haproxy/haproxy.cfg.bak-antiban-20260817-151328`,
`/etc/caddy/app.Caddyfile.bak-mtp-162744`,
`/etc/sing-box/config.json.bak-antiban-20260817-151328`,
`~/.config/Throne/config/throne.db.bak-antiban-20260817-193051`.
