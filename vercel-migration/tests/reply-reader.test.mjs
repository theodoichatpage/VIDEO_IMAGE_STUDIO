import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const context = vm.createContext({});
vm.runInContext(readFileSync(new URL('../extension/reply-reader.js', import.meta.url), 'utf8'), context);
const reader = context.VISReplyReader;
function wordStreamPage(prompt, response, later = '') {
  const nodes = [prompt, response, later].filter(Boolean).map((value, index) => ({
    innerText: value, textContent: value,
    getAttribute: name => name === 'class' ? index === 0 ? 'UserBubble-a TextBase-b' : 'DiResponseRoot-HfQrEh Reveal-k2IWvM' : '',
    matches: selector => index > 0 && selector.includes('ResponseRoot-'),
    closest() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
    contains(other) { return this === other; },
    compareDocumentPosition(other) { return nodes.indexOf(this) < nodes.indexOf(other) ? 4 : 2; },
  }));
  return { querySelectorAll(selector) {
    if (selector === '[class*="ResponseRoot-"]') return nodes.slice(1);
    if (selector === 'div, p') return nodes;
    return [];
  } };
}

test('reads 15 scenes from the ResponseRoot word-stream markup observed in the user screenshot', () => {
  const prompt = 'PHẦN: Phần 3 - Nghệ thuật NỘI DUNG: ' + 'Một câu chuyện tiền sử về chuỗi vỏ sò. '.repeat(6);
  const scenes = Array.from({ length: 15 }, (_, i) => ({ title: 'Cảnh ' + (i + 1), prompt: 'Camera shot ' + (i + 1) }));
  const result = reader.readStreaming(wordStreamPage(prompt + ' Show more', JSON.stringify({ scenes }), JSON.stringify({ scenes: [{ title: 'Unrelated later answer', prompt: 'Other' }] })), { id: 'recovered-job-3', type: 'part_analysis', prompt });
  assert.equal(result.complete, true);
  assert.equal(JSON.parse(result.text).scenes.length, 15);
});

test('does not attach a ResponseRoot answer to a different part', () => {
  const prompt = 'PHẦN: Phần 3 NỘI DUNG: ' + 'Một câu chuyện về nghệ thuật. '.repeat(6);
  const result = reader.read(wordStreamPage(prompt, '{"scenes":[{"prompt":"A shell"}]}'), { type: 'part_analysis', prompt: prompt.replace('Phần 3', 'Phần 5') });
  assert.equal(result.text, '');
});
const scene = title => JSON.stringify({ scenes: [{ title, content: 'A {scene} with "quoted text"', prompt: 'A cinematic shot' }] });
test('matches a collapsed legacy prompt by exact part title and source opening', () => {
  const head = 'PHẦN: Phần 5 - Buồn chán đánh thức trí tưởng tượng\nNỘI DUNG:\n';
  const source = 'Nhưng chán đâu chỉ đẻ ra nghệ thuật với âm nhạc, nó còn vô tình kích hoạt một thứ vũ khí đáng sợ hơn nhiều. ';
  const prompt = 'Return JSON. ' + head + source + 'The rest of a long script is hidden.';
  const after = page([turn('user', 'Return JSON. ' + head + source + '... Show more'), turn('assistant', scene('Part 5'))]);
  const job = { id: 'recovery-job-5', type: 'part_analysis', prompt };
  assert.equal(JSON.parse(reader.read(after, job).text).scenes[0].title, 'Part 5');
  assert.equal(reader.read(after, { ...job, prompt: prompt.replace('Phần 5', 'Phần 4') }).text, '');
  assert.equal(reader.read(after, { ...job, prompt: prompt.replace(source, 'A different story with the same part title. '.repeat(5)) }).text, '');
});
function turn(role, value, { article = false, code = '' } = {}) {
  return {
    innerText: value, textContent: value,
    getAttribute: name => name === (article ? 'data-turn' : 'data-message-author-role') ? role : '',
    querySelector: () => null,
    querySelectorAll: () => code ? [{ textContent: code }] : [],
  };
}
function page(messages, articles = false) {
  return { querySelectorAll: selector => selector.startsWith('article') ? articles ? messages : [] : messages };
}

test('reads generic div conversation turns without old role attributes or markdown classes', () => {
  const user = turn('user', 'Analyze part 3', { article: true });
  const answer = turn('assistant', scene('New DOM reply'), { article: true });
  const doc = { querySelectorAll: selector => selector.includes('[data-testid^="conversation-turn-"]') && !selector.startsWith('article') ? [user, answer] : [] };
  assert.equal(reader.read(doc, { type: 'part_analysis', prompt: 'Analyze part 3' }).reason, 'matched');
});

test('does not mistake a user template nested inside a data-turn user container for a reply', () => {
  const user = turn('user', 'Analyze part 3', { article: true });
  const template = turn('', scene('Template only'));
  template.matches = () => true;
  template.closest = selector => selector.includes('data-turn') ? user : null;
  user.contains = other => other === template;
  const doc = { querySelectorAll: selector => selector.startsWith('main') ? [template] : selector.startsWith('[data-testid') ? [user] : [] };
  assert.equal(reader.read(doc, { type: 'part_analysis', prompt: 'Analyze part 3' }).text, '');
});

test('streams only complete scene objects and leaves the final incomplete object unread', () => {
  const value = '{"scenes":[{"title":"First","prompt":"A {shell} and \\"light\\""},{"title":"Second","prompt":"A cave"},{"title":"Third","prompt":"unfinished';
  const doc = page([turn('user', 'Analyze part 3'), turn('assistant', value)]);
  const result = reader.readStreaming(doc, { type: 'part_analysis', prompt: 'Analyze part 3' });
  assert.equal(result.complete, false);
  assert.equal(JSON.parse(result.text).scenes.length, 2);
});

test('finds part 3 when old messages disappear and the total count no longer increases', () => {
  const before = page([turn('assistant', scene('Part 1')), turn('assistant', scene('Part 2'))]);
  const job = { id: 'job-3', type: 'part_analysis', prompt: 'Analyze part 3', before: reader.snapshot(before) };
  const after = page([turn('user', '[VIS_JOB_ID:job-3] Analyze part 3'), turn('assistant', scene('Part 3'))]);
  assert.equal(JSON.parse(reader.read(after, job).text).scenes[0].title, 'Part 3');
});

test('recovers existing v0.4.9 response from matching prompt without runtime counters or job marker', () => {
  const job = { id: 'existing-job-3', type: 'part_analysis', prompt: 'Analyze part 3 with original content' };
  const after = page([turn('user', 'TEXT ANALYSIS ONLY.\nAnalyze part 3 with original content'), turn('assistant', scene('Existing 12 scenes'))]);
  assert.equal(JSON.parse(reader.read(after, job).text).scenes[0].title, 'Existing 12 scenes');
});

test('supports ChatGPT conversation article markup and JSON in a code block', () => {
  const after = page([turn('user', 'Analyze part 3', { article: true }), turn('assistant', 'Code Copy JSON', { article: true, code: '```json\n' + scene('Article reply') + '\n```' })], true);
  assert.equal(JSON.parse(reader.read(after, { id: 'job-3', type: 'part_analysis', prompt: 'Analyze part 3' }).text).scenes[0].title, 'Article reply');
});

test('does not take old part 2 JSON, echoed user templates or a reply to another prompt', () => {
  const job = { id: 'job-3', type: 'part_analysis', prompt: 'Analyze part 3' };
  assert.equal(reader.read(page([turn('assistant', scene('Old Part 2')), turn('user', 'Analyze part 3 ' + scene('Template'))]), job).text, '');
  assert.equal(reader.read(page([turn('user', 'Analyze part 4'), turn('assistant', scene('Part 4'))]), job).text, '');
});

test('rejects partial JSON and wrong response schema', () => {
  assert.equal(reader.extract('{"scenes":[{"title":"unfinished"', 'part_analysis'), '');
  assert.equal(reader.extract('{"parts":[{"content":"wrong schema"}]}', 'part_analysis'), '');
});

test('does not discard a markdown answer when only user articles have explicit role attributes', () => {
  const user = turn('user', 'Analyze part 3', { article: true });
  const answer = turn('', scene('Markdown-only reply'));
  answer.matches = () => true;
  user.compareDocumentPosition = other => other === answer ? 4 : 0;
  answer.compareDocumentPosition = other => other === user ? 2 : 0;
  const doc = { querySelectorAll: selector => selector.startsWith('article') ? [user] : selector.startsWith('main') ? [answer] : [user] };
  assert.equal(JSON.parse(reader.read(doc, { id: 'job-3', type: 'part_analysis', prompt: 'Analyze part 3' }).text).scenes[0].title, 'Markdown-only reply');
});
