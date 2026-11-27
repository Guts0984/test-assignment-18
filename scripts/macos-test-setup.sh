#!/usr/bin/env bash
# What the tests take for granted on Linux and macOS does not give: several loopback addresses
# (the rate limit tests send from 127.0.0.2 to .11) and room for 200 connections waiting to be
# accepted. Needs sudo; the settings last until the next reboot.
set -euo pipefail
[ "$(uname -s)" = Darwin ] || { echo "Only macOS needs this." >&2; exit 0; }
for last in $(seq 2 11); do
  sudo ifconfig lo0 alias "127.0.0.$last" up
done
sudo sysctl -w kern.ipc.somaxconn=1024
