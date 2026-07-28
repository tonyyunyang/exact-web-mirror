#!/usr/bin/env bash
# Install exact-web-mirror as a Claude Code skill.
#
#   ./install.sh              symlink into ~/.claude/skills/ (updates when you `git pull`)
#   ./install.sh --copy       copy instead of symlink
#   ./install.sh --project    install into ./.claude/skills/ of the current directory
#   ./install.sh --uninstall  remove it
#   ./install.sh --no-setup   skip the dependency install
set -euo pipefail

NAME=exact-web-mirror
REPO="$(cd "$(dirname "$0")" && pwd)"
SRC="$REPO/skills/$NAME"

MODE=symlink
SCOPE="$HOME/.claude/skills"
RUN_SETUP=1
for arg in "$@"; do
  case "$arg" in
    --copy) MODE=copy ;;
    --project) SCOPE="$PWD/.claude/skills" ;;
    --uninstall) MODE=uninstall ;;
    --no-setup) RUN_SETUP=0 ;;
    -h|--help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg (try --help)" >&2; exit 1 ;;
  esac
done
DEST="$SCOPE/$NAME"

if [ "$MODE" = uninstall ]; then
  if [ -e "$DEST" ] || [ -L "$DEST" ]; then rm -rf "$DEST"; echo "Removed $DEST"; else echo "Nothing installed at $DEST"; fi
  exit 0
fi

[ -f "$SRC/SKILL.md" ] || { echo "error: $SRC/SKILL.md not found — run this from inside the repo." >&2; exit 1; }

# A stale symlink from a previous install would otherwise make ln put the new link *inside* it.
if [ -e "$DEST" ] || [ -L "$DEST" ]; then
  echo "Replacing existing install at $DEST"
  rm -rf "$DEST"
fi

mkdir -p "$SCOPE"
if [ "$MODE" = copy ]; then
  cp -R "$SRC" "$DEST"
  echo "Copied  $SRC"
else
  ln -s "$SRC" "$DEST"
  echo "Linked  $SRC"
fi
echo "     →  $DEST"

# Run setup through DEST so --copy installs dependencies into the copy, not back into the repo.
if [ "$RUN_SETUP" = 1 ]; then
  echo
  node "$DEST/scripts/setup.mjs"
else
  echo
  echo "Skipped dependency setup. Run it before first use:"
  echo "  node \"$DEST/scripts/setup.mjs\""
fi

echo
echo "Start a new Claude Code session and ask it to mirror a page, or run:"
echo "  node \"$DEST/scripts/archive.mjs\" https://example.com/ --verify"
