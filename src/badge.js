const fs = require('fs');
const path = require('path');
const { LOG_PATH } = require('./audit');

function loadAuditLog() {
  if (!fs.existsSync(LOG_PATH)) return [];
  return fs.readFileSync(LOG_PATH, 'utf-8').trim().split('\n').filter(Boolean).map(JSON.parse);
}

function badgeSvg(label = 'counterflow', color = 'success') {
  const entries = loadAuditLog();
  const proved = entries.filter(e => e.verdict === 'proved').length;
  const violated = entries.filter(e => e.verdict === 'violated').length;
  const right = proved > 0 ? `${proved}/${proved + violated} proved` : settledOutput(entries);

  const leftWidth = label.length * 6 + 20;
  const rightWidth = right.length * 6 + 20;
  const totalWidth = leftWidth + rightWidth;

  const leftColor = '#555';
  const rightColor = color === 'success' ? '#4c1' : color === 'critical' ? '#e05d44' : '#9f9f9f';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20">
  <linearGradient id="b" x2="0" y2="100%"><stop offset="0" stop-color="#bbb"/><stop offset="1" stop-color="#fff"/></linearGradient>
  <mask id="a"><rect width="${totalWidth}" height="20" rx="3" fill="#fff"/></mask>
  <g mask="url(#a)"><rect width="${leftWidth}" height="20" fill="${leftColor}"/>
    <rect x="${leftWidth}" width="${rightWidth}" height="20" fill="${rightColor}"/>
    <rect width="${totalWidth}" height="20" fill="url(#b)"/></g>
  <g fill="#fff" text-anchor="middle" font-family="monospace" font-size="10">
    <text x="${leftWidth / 2}" y="15">${label}</text>
    <text x="${leftWidth + rightWidth / 2}" y="15">${right}</text>
  </g>
</svg>`;
}

function settledOutput(entries) {
  const latest = entries.slice(-1)[0];
  if (!latest) return 'no runs';
  return latest.verdict === 'proved' ? 'PROVED' : latest.verdict === 'violated' ? 'VIOLATED' : 'UNKNOWN';
}

module.exports = { badgeSvg, loadAuditLog };
