#!/usr/bin/env bash
set -euo pipefail
src="$(cd "$(dirname "$0")" && pwd)/../fixtures/android-project"
cp -R "$src/." .
