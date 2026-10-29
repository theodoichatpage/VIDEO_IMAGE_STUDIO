// ChatGPT DOM variants observed in October 2026 (extension 0.4.24).
// A tiny DOM is enough: the reader only needs selectors, text, order and ancestry.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const context = vm.createContext({});
vm.runInContext(readFileSync(new URL('../extension/reply-reader.js', import.meta.url), 'utf8'), context);
const reader = context.VISReplyReader;

class El {
  constructor(tag, attrs = {}, children = []) { this.tag = tag; this.attrs = attrs; this.children = children.map(c => typeof c === 'string' ? new Text(c) : c); this.children.forEach(c => { c.parent = this; }); }
  get textContent() { return this.children.map(c => c.textContent).join(''); }
  get innerText() { return this.textContent; }
  getAttribute(name) { return name in this.attrs ? String(this.attrs[name]) : null; }
  *walk() { for (const c of this.children) if (c instanceof El) { yield c; yield* c.walk(); } }
  matchesSimple(sel) {
    const parts = sel.match(/^([a-z]+)?((?:\.[\w-]+|\[[^\]]+\])*)$/i); if (!parts) return false;
    if (parts[1] && parts[1].toLowerCase() !== this.tag) return false;
    for (const piece of parts[2].match(/\.[\w-]+|\[[^\]]+\]/g) || []) {
      if (piece[0] === '.') { if (!(this.getAttribute('class') || '').split(/\s+/).includes(piece.slice(1))) return false; continue; }
      const m = piece.match(/^\[([\w-]+)(?:([*^]?=)"([^"]*)")?\]$/); const v = this.getAttribute(m[1]);
      if (v === null) return false;
      if (m[2] === '=' && v !== m[3]) return false;
      if (m[2] === '^=' && !v.startsWith(m[3])) return false;
      if (m[2] === '*=' && !v.includes(m[3])) return false;
    }
    return true;
  }
  matches(selector) {
    return selector.split(',').map(s => s.trim()).some(s => {
      const chain = s.split(/\s+/); if (!this.matchesSimple(chain.at(-1))) return false;
      let node = this.parent, i = chain.length - 2;
      while (i >= 0 && node) { if (node.matchesSimple?.(chain[i])) i -= 1; node = node.parent; }
      return i < 0;
    });
  }
  querySelectorAll(selector) { return [...this.walk()].filter(n => n.matches(selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { for (let n = this; n instanceof El; n = n.parent) if (n.matches(selector)) return n; return null; }
  contains(other) { for (let n = other; n; n = n.parent) if (n === this) return true; return false; }
  compareDocumentPosition(other) { const order = [...root().walk()]; return order.indexOf(this) < order.indexOf(other) ? 4 : 2; }
}
class Text { constructor(value) { this.value = value; } get textContent() { return this.value; } }
let current;
const root = () => current;
const h = (tag, attrs, ...children) => new El(tag, attrs || {}, children.flat());
const page = (...children) => { current = h('html', {}, h('body', {}, h('main', {}, ...children))); return current; };

const prompt = 'PHẦN: Phần 2 - Lưu lạc NỘI DUNG: ' + 'Ở tuổi 17, Nguyễn Du bơ vơ giữa kinh thành loạn lạc, rời Thăng Long lên Thái Nguyên. '.repeat(3);
const ask = id => '[VIS_JOB_ID:' + id + '] TEXT ANALYSIS ONLY. Return only the requested JSON. ' + prompt;
const scenes = n => JSON.stringify({ scenes: Array.from({ length: n }, (_, i) => ({ title: 'Cảnh ' + (i + 1) + ' "trích"', prompt: 'Wide shot ' + (i + 1) + ' {x}' })) }, null, 2);
const words = text => text.split(/(\s+)/).map(w => /\s/.test(w) ? w : h('span', { 'data-stream-word': '' }, w));
const ctx = (id, type = 'part_analysis', p = prompt) => ({ id, type, prompt: p });
const count = result => result.text ? Object.values(JSON.parse(result.text))[0].length : result.reason;

test('reads the reply when ChatGPT renders no role/turn attributes (MarkdownRoot)', () => {
  const doc = page(h('div', { class: 'whitespace-pre-wrap' }, ask('j1')), h('div', { 'data-markdown-text-style': 'assistant-message', class: 'MarkdownRoot-a' }, h('p', {}, scenes(12))));
  assert.equal(count(reader.read(doc, ctx('j1'))), 12);
});

test('a status/thinking ResponseRoot before the JSON no longer causes invalid-json', () => {
  const doc = page(h('div', { class: 'UserBubble-a' }, ask('j1')), h('div', { class: 'DiResponseRoot-a' }, 'Đang suy nghĩ… Thought for 4s'),
    h('div', { class: 'DiResponseRoot-b' }, ...words(scenes(12))), h('div', { class: 'UserBubble-a' }, 'câu hỏi khác'), h('div', { class: 'DiResponseRoot-c' }, ...words(scenes(2))));
  assert.equal(count(reader.read(doc, ctx('j1'))), 12);
});

test('two consecutive parts map to their own replies; an old job never reads the new reply', () => {
  const p3 = prompt.replace('Phần 2 - Lưu lạc', 'Phần 3 - Gió bụi');
  const doc = page(h('div', { class: 'whitespace-pre-wrap' }, ask('j1')), h('div', { 'data-markdown-text-style': 'assistant-message' }, scenes(3)),
    h('div', { class: 'whitespace-pre-wrap' }, '[VIS_JOB_ID:j2] ' + p3), h('div', { 'data-markdown-text-style': 'assistant-message' }, scenes(5)));
  assert.equal(count(reader.read(doc, ctx('j1'))), 3);
  assert.equal(count(reader.read(doc, ctx('j2', 'part_analysis', p3))), 5);
});

test('same prompt resent with a new job id: each id reads its own reply, unsent jobs read nothing', () => {
  const doc = page(h('div', { class: 'whitespace-pre-wrap' }, ask('old')), h('div', { 'data-markdown-text-style': 'assistant-message' }, scenes(3)),
    h('div', { class: 'whitespace-pre-wrap' }, ask('new')), h('div', { 'data-markdown-text-style': 'assistant-message' }, scenes(7)));
  assert.equal(count(reader.read(doc, ctx('old'))), 3);
  assert.equal(count(reader.read(doc, ctx('new'))), 7);
  assert.equal(count(reader.read(doc, ctx('recovered'))), 7, 'a recovery without marker may only use the latest prompt');
  assert.equal(reader.read(doc, ctx('later', 'part_analysis', 'Một lệnh khác chưa gửi')).text, '');
});

test('streaming JSON is not accepted until complete; finished invalid JSON reports why', () => {
  const partial = page(h('div', { class: 'whitespace-pre-wrap' }, ask('j1')), h('div', { 'data-markdown-text-style': 'assistant-message' }, scenes(4).slice(0, 300)));
  const r = reader.read(partial, ctx('j1'));
  assert.equal(r.text, ''); assert.equal(r.reason, 'invalid-json'); assert.match(r.detail, /JSON lỗi/);
  const wrong = page(h('div', { class: 'whitespace-pre-wrap' }, ask('j1')), h('div', { 'data-markdown-text-style': 'assistant-message' }, '{"scenes":[{"title":"Cảnh 1","prompt":"x",}]}'));
  assert.match(reader.read(wrong, ctx('j1')).detail, /JSON lỗi/);
  const empty = page(h('div', { class: 'whitespace-pre-wrap' }, ask('j1')), h('div', { 'data-markdown-text-style': 'assistant-message' }, '{"scenes":[]}'));
  assert.match(reader.read(empty, ctx('j1')).detail, /thiếu mảng "scenes"/);
});

test('structure split and transcript partition read the right key', () => {
  const parts = JSON.stringify({ parts: Array.from({ length: 13 }, (_, i) => ({ title: 'Phần ' + (i + 1), range: 'r', content: 'c' })) });
  const doc = page(h('div', { class: 'whitespace-pre-wrap' }, '[VIS_JOB_ID:s1] Chia kịch bản'), h('div', { 'data-markdown-text-style': 'assistant-message' }, h('pre', {}, h('code', {}, parts))));
  assert.equal(count(reader.read(doc, ctx('s1', 'script_structure', 'Chia kịch bản'))), 13);
  const branches = JSON.stringify({ branches: [{ title: 'A', end: 10 }, { title: 'B', end: 20 }] });
  const t = page(h('div', { class: 'whitespace-pre-wrap' }, '[VIS_JOB_ID:t1] Chia transcript'), h('div', { 'data-markdown-text-style': 'assistant-message' }, branches));
  assert.equal(count(reader.read(t, ctx('t1', 'transcript_mindmap', 'Chia transcript'))), 2);
});

test('progress reading returns complete scenes only, from the anchored reply', () => {
  const text = scenes(5); const cut = text.slice(0, text.lastIndexOf('"Cảnh 4'));
  const doc = page(h('div', { class: 'whitespace-pre-wrap' }, ask('j1')), h('div', { class: 'DiResponseRoot-a' }, 'Thinking'), h('div', { 'data-markdown-text-style': 'assistant-message' }, cut));
  const r = reader.readStreaming(doc, ctx('j1'));
  assert.equal(r.complete, false); assert.ok(JSON.parse(r.text).scenes.length >= 2);
});

test('conversation size counts message bubbles only, not page chrome', () => {
  const doc = page(h('div', { class: 'whitespace-pre-wrap' }, 'x'.repeat(1000)), h('div', { 'data-markdown-text-style': 'assistant-message' }, h('p', {}, 'y'.repeat(500))), h('div', { class: 'sidebar' }, 'z'.repeat(99999)));
  assert.equal(reader.conversationChars(doc), 1500);
});
