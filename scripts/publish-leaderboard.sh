#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Generating leaderboard dashboard..."
node -e "
const { dashboardHtml } = require('./src/dashboard');
const { badgeSvg } = require('./src/badge');
const { leaderboardData, renderMarkdown } = require('./src/leaderboard');
const fs = require('fs');
fs.mkdirSync('public', { recursive: true });
fs.writeFileSync('public/index.html', dashboardHtml());
fs.writeFileSync('public/badge.svg', badgeSvg('counterflow'));
fs.writeFileSync('public/LEADERBOARD.md', renderMarkdown(leaderboardData()));
console.log('  public/index.html');
console.log('  public/badge.svg');
console.log('  public/LEADERBOARD.md');
"

if [ -d .git ]; then
  BRANCH=$(git rev-parse --abbrev-ref HEAD)
  echo "==> Publishing to gh-pages branch..."
  git checkout -B gh-pages
  cp public/* .
  git add index.html badge.svg LEADERBOARD.md
  git commit -m "publish leaderboard $(date -u +%Y-%m-%d)" || true
  git push origin gh-pages --force
  git checkout "$BRANCH"
  echo "==> Published to GitHub Pages"
else
  echo "==> Not a git repo — files in public/ directory"
fi
