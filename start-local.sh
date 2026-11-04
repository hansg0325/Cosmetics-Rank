#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
bash ./pnpmw install --frozen-lockfile
bash ./pnpmw setup:local
bash ./pnpmw db:migrate
exec bash ./pnpmw dev
