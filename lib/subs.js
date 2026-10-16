'use strict';
// Convierte SRT / ASS / VTT a WebVTT.
const ts = (t) => {
  const m = t.trim().replace(',', '.').match(/(?:(\d+):)?(\d+):(\d+)(?:\.(\d+))?/);
  if (!m) return '00:00:00.000';
  const ms = String((m[4] || '0')).padEnd(3, '0').slice(0, 3);
  return `${String(+(m[1] || 0)).padStart(2, '0')}:${m[2].padStart(2, '0')}:${m[3].padStart(2, '0')}.${ms}`;
};

function toVtt(text, ext) {
  text = text.replace(/^﻿/, '').replace(/\r/g, '');
  if (ext === '.vtt') return text;
  const out = ['WEBVTT', ''];
  if (ext === '.srt') {
    for (const block of text.split(/\n\n+/)) {
      const lines = block.split('\n');
      const i = lines.findIndex((l) => l.includes('-->'));
      if (i < 0) continue;
      const [a, b] = lines[i].split('-->');
      out.push(`${ts(a)} --> ${ts(b.trim().split(/\s/)[0])}`, ...lines.slice(i + 1), '');
    }
  } else { // .ass / .ssa
    let fmt = null;
    for (const line of text.split('\n')) {
      if (line.startsWith('Format:') && line.includes('Start')) fmt = line.slice(7).split(',').map((s) => s.trim());
      else if (line.startsWith('Dialogue:') && fmt) {
        const p = line.slice(9).split(',');
        const g = (k) => p[fmt.indexOf(k)];
        const t = p.slice(fmt.indexOf('Text')).join(',').replace(/\{[^}]*\}/g, '').replace(/\\N/gi, '\n');
        out.push(`${ts(g('Start'))} --> ${ts(g('End'))}`, t, '');
      }
    }
  }
  return out.join('\n');
}

module.exports = { toVtt };
