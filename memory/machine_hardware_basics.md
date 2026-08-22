---
name: machine_hardware_basics
description: "Ноутбук HONOR BRN-HXXB (M1020) на CachyOS без dual-boot, корень Btrfs+Snapper, Wi-Fi ath11k_pci, режим eDP-1 форсирован через drm.edid_firmware"
metadata: 
  node_type: memory
  type: reference
  originSessionId: b1ce026b-2ed5-4c61-affb-b2aaaa63254f
  modified: 2026-08-22T14:36:08.037Z
---

Устойчивое про эту машину — то, что не меняется от обновления пакетов. Версии ядра, тулов,
свободное место и подключённые дисплеи сюда не пишутся: дистрибутив rolling, снимок протухает
молча. Их берут тулом в момент вопроса (`uname -r`, `pacman -Q`, `free`, `df`, `lsblk`,
`ls /sys/class/drm`).

- **Модель:** HONOR BRN-HXXB, product version M1020 (`/sys/devices/virtual/dmi/id/product_name`,
  `product_version`). Платформа AMD: Ryzen 7640HS + интегрированная Radeon 760M (Phoenix1),
  драйвер `amdgpu`, Vulkan через RADV.
- **ОС — CachyOS (Arch-based, rolling), и она на диске одна: dual-boot нет, Windows нет.** Это
  не мелочь для диагностики: при потере bluetooth-пар версия «Windows перегенерил LTK/IRK»
  исключается сразу, причину надо искать в linux-стороне.
- **Корень — Btrfs со сжатием zstd, установлены Snapper и Btrfs Assistant.** Значит у системных
  правок есть снапшоты, и любая раскладка подтомов ломается легко — раскладку и настройку
  Snapper беречь, разрушительные операции с диском делать только с явного «го».
- **Wi-Fi — Qualcomm QCNFA765 на `ath11k_pci`** (`lsmod | grep ath11k`). Сетевые странности
  ищутся в этом драйвере, а не в общем стеке.
- **Встроенный дисплей `eDP-1` работает в принудительном режиме 1920×1200**, заданном параметром
  ядра `drm.edid_firmware=eDP-1:edid/1920x1200_72.bin`: родной EDID подменён. Кто правит режимы
  экрана, должен знать, что источник — параметр ядра, а не настройка COSMIC. Где живёт параметр —
  [[machine-limine-bootloader]].

Журнал системных правок агента — [[machine-system-changelog]].
