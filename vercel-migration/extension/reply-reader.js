(() => {
  const normalize = text => String(text || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
  const text = node => node?.innerText || node?.textContent || '';
  const wordResponse = node => String(node?.getAttribute?.('class') || '').includes('ResponseRoot-');
  const roleOf = node => {
    const direct = node.getAttribute?.('data-message-author-role') || node.getAttribute?.('data-turn');
    if (['user', 'assistant'].includes(direct)) return direct;
    const parent = node.closest?.('[data-message-author-role], [data-turn="user"], [data-turn="assistant"]');
    const parentRole = parent?.getAttribute('data-message-author-role') || parent?.getAttribute('data-turn');
    if (['user', 'assistant'].includes(parentRole)) return parentRole;
    if (wordResponse(node)) return 'assistant';
    const hasUser = node.querySelector?.('[data-message-author-role="user"]');
    const hasAssistant = node.querySelector?.('[data-message-author-role="assistant"]');
    if (hasUser && hasAssistant) return '';
    if (hasUser) return 'user';
    if (hasAssistant || node.matches?.('.markdown, .agent-turn') || node.querySelector?.('.markdown, .agent-turn')) return 'assistant';
    const heading = normalize(node.querySelector?.('h5, h6, [role="heading"]')?.textContent || '');
    if (/^(you said|bạn đã nói|bạn nói)\s*:?$/i.test(heading)) return 'user';
    if (/^(chatgpt said|chatgpt đã nói|chatgpt nói)\s*:?$/i.test(heading)) return 'assistant';
    return '';
  };
  function turns(document, context = {}) {
    // The user's page renders messages as ResponseRoot + data-stream-word,
    // without article/role/markdown attributes. Locate prompt blocks outside
    // response roots, then preserve DOM order to pair the matching reply.
    const wordRoots = [...document.querySelectorAll('[class*="ResponseRoot-"]')].filter(wordResponse);
    const promptBlocks = wordRoots.length && context.prompt ? [...document.querySelectorAll('div, p')].filter(node => {
      if (wordResponse(node) || wordResponse(node.closest?.('[class*="ResponseRoot-"]')) || wordResponse(node.querySelector?.('[class*="ResponseRoot-"]'))) return false;
      const value = normalize(text(node));
      return value.includes('[VIS_JOB_ID:') || /PHẦN:.*NỘI DUNG:/.test(value) || matchesPrompt(value, context);
    }) : [];
    // Image-only ChatGPT turns may omit role/article/ResponseRoot attributes.
    // Infer the prompt from its complete text; common prefixes establish only
    // boundaries, never ownership of an image.
    const imageMode = context.type === 'image_generation';
    const prefix = normalize(context.prompt).slice(0, 120);
    const loose = imageMode && context.prompt ? [...document.querySelectorAll('div, p')].filter(node => {
      if (node.closest?.('form, [contenteditable="true"], #prompt-textarea') || roleOf(node) === 'assistant') return false;
      const value = normalize(text(node));
      return matchesPrompt(value, context) || prefix.length >= 80 && value.startsWith(prefix);
    }) : [];
    const leafPrompts = loose.filter(node => !loose.some(child => child !== node && node.contains?.(child)));
    const bubblePrompts = imageMode ? [...document.querySelectorAll('[class*="UserBubble"], [data-testid="user-message"]')].filter(node => /UserBubble/.test(node.getAttribute?.('class') || '') || node.getAttribute?.('data-testid') === 'user-message') : [];
    const hintedUsers = new Set([...promptBlocks, ...leafPrompts, ...bubblePrompts]);
    const imageNodes = imageMode ? [...document.querySelectorAll('img')].filter(image => {
      const url = image.currentSrc || image.src || '';
      return image.naturalWidth >= 256 && image.naturalHeight >= 256 && /^(https:\/\/(?:chatgpt\.com|[^/]+\.oaiusercontent\.com|[^/]+\.blob\.core\.windows\.net)\/|blob:)/i.test(url) && roleOf(image) !== 'user' && ![...hintedUsers].some(user => user.contains?.(image));
    }).map(image => image.parentElement).filter(Boolean) : [];
    const hintedImages = new Set(imageNodes);
    const role = node => hintedUsers.has(node) ? 'user' : roleOf(node) || (hintedImages.has(node) ? 'assistant' : '');
    const headings = [...document.querySelectorAll('h5, h6, [role="heading"]')].filter(node => /^(you said|bạn đã nói|bạn nói|chatgpt said|chatgpt đã nói|chatgpt nói)\s*:?$/i.test(normalize(node.textContent)));
    const semanticTurns = headings.map(node => node.closest?.('article, [data-testid*="conversation-turn"], [data-turn]') || node.parentElement).filter(Boolean);
    const candidates = [...document.querySelectorAll('[data-testid^="conversation-turn-"], [data-testid="conversation-turn"], [data-turn="user"], [data-turn="assistant"], main article, [role="main"] article, article'), ...semanticTurns, ...document.querySelectorAll('article[data-testid^="conversation-turn-"], article[data-turn]'), ...document.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]'), ...document.querySelectorAll('main .markdown, main .agent-turn')];
    const nodes = [...new Set([...candidates, ...wordRoots, ...hintedUsers, ...imageNodes])].filter(node => ['user', 'assistant'].includes(role(node)));
    const top = nodes.filter((node, index) => !nodes.some((parent, other) => index !== other && role(parent) === role(node) && parent.contains?.(node)));
    top.sort((a, b) => {
      const position = a.compareDocumentPosition?.(b) || 0;
      return position & 4 ? -1 : position & 2 ? 1 : 0;
    });
    return top.map(node => ({ role: role(node), node, text: text(node) }));
  }
  function fingerprint(turn) {
    const identity = turn.node.getAttribute?.('data-message-id') || turn.node.getAttribute?.('data-testid') || '';
    const images = [...(turn.node.querySelectorAll?.('img') || [])].map(image => image.currentSrc || image.src || '').filter(Boolean).join('|');
    return identity + ':' + normalize(turn.text) + (images ? ':' + images : '');
  }
  function snapshot(document) { return turns(document, {type:'image_generation'}).filter(turn => turn.role === 'assistant').map(fingerprint); }
  function matchesPrompt(user, context) {
    const expected = normalize(context.prompt);
    if (context.id && user.includes('[VIS_JOB_ID:' + context.id + ']')) return true;
    if (expected && user.includes(expected)) return true;
    // ChatGPT may mount only the collapsed prompt preview. A recovered job has
    // a new ID, so match both the exact part title AND its distinctive source.
    if (context.type !== 'part_analysis') return false;
    const match = expected.match(/PHẦN:\s*(.+?)\s*NỘI DUNG:\s*(.+)$/);
    if (!match || match[2].length < 80) return false;
    const shown = user.match(/PHẦN:\s*(.+?)\s*NỘI DUNG:\s*(.+)$/);
    return Boolean(shown && shown[1] === match[1] && shown[2].startsWith(match[2].slice(0, 80)));
  }
  // ChatGPT ships several DOM variants. Some have no role/turn attributes at all
  // (MarkdownRoot + data-markdown-text-style="assistant-message"). Anchor on the
  // exact prompt of THIS job, then take only answer nodes after it and before the
  // next user prompt, so another job's reply can never be read.
  const FOLLOWING = 4;
  const ANSWER = '[data-markdown-text-style="assistant-message"], [data-message-author-role="assistant"], .markdown, [class*="ResponseRoot-"], pre';
  const USERISH = '[data-message-author-role="user"], [data-turn="user"], [class*="UserBubble"], [data-testid="user-message"], .whitespace-pre-wrap';
  const outsideComposer = node => !node.closest?.('form, [contenteditable="true"], #prompt-textarea');
  function anchored(document, context = {}) {
    if (!context.prompt && !context.id) return { sources: [], reason: 'no-user-anchor' };
    const matching = [...document.querySelectorAll(USERISH)].filter(node => outsideComposer(node) && !node.closest?.(ANSWER) && matchesPrompt(normalize(text(node)), context));
    // The exact job marker wins; prompt-text matching is only for a recovered job whose marker is gone.
    const byId = context.id ? matching.filter(node => normalize(text(node)).includes('[VIS_JOB_ID:' + context.id + ']')) : [];
    const prompts = byId.length ? byId : matching;
    const anchor = prompts.filter(node => !prompts.some(other => other !== node && node.contains?.(other))).at(-1);
    if (!anchor) return { sources: [], reason: 'latest-user-mismatch' };
    const after = node => Boolean(anchor.compareDocumentPosition?.(node) & FOLLOWING) && !anchor.contains?.(node) && !node.contains?.(anchor);
    const boundary = [...document.querySelectorAll(USERISH)].find(node => outsideComposer(node) && !node.closest?.(ANSWER) && after(node) && normalize(text(node)) && !anchor.parentElement?.contains?.(node));
    // Without this job's own marker, only the latest prompt may be used (recovery), never an older turn.
    if (!byId.length && boundary) return { sources: [], reason: 'latest-user-mismatch' };
    const before = node => !boundary || Boolean(node.compareDocumentPosition?.(boundary) & FOLLOWING);
    const nodes = [...document.querySelectorAll(ANSWER)].filter(node => outsideComposer(node) && after(node) && before(node));
    if (!nodes.length) return { sources: [], reason: 'no-new-answer' };
    const list = [];
    for (const node of nodes) {
      list.push(...[...(node.querySelectorAll?.('pre code, pre') || [])].map(item => item.textContent || text(item)), text(node), node.textContent || '');
      const words = [...(node.querySelectorAll?.('[data-stream-word], [data-d-stream-word]') || [])].map(item => item.textContent || '');
      if (words.length) list.push(words.join(''), words.join(' '));
    }
    return { node: nodes.at(-1), sources: [...new Set(list.filter(Boolean))], reason: 'matched', anchored: true };
  }
  // Characters in message bubbles only (prompts + answers); page scripts and UI chrome are not counted.
  function conversationChars(document) {
    const selector = ANSWER + ', ' + USERISH;
    return [...document.querySelectorAll(selector)].filter(node => outsideComposer(node) && !node.parentElement?.closest?.(selector)).reduce((total, node) => total + (node.textContent || '').length, 0);
  }
  function sources(document, context = {}) {
    const primary = roleSources(document, context);
    if (primary.reason === 'matched' || context.type === 'image_generation') return primary;
    const fallback = anchored(document, context);
    return fallback.reason === 'matched' ? fallback : primary;
  }
  function roleSources(document, context = {}) {
    const messages = turns(document, context);
    const latestUser = messages.findLastIndex(turn => turn.role === 'user' && (context.type !== 'image_generation' || [normalize(turn.text), normalize(turn.node.textContent)].some(value => matchesPrompt(value, context))));
    if (context.type === 'image_generation' && latestUser < 0) return { sources: [], reason: 'latest-user-mismatch' };
    let answers;
    if (latestUser >= 0) {
      const userTexts = [normalize(messages[latestUser].text), normalize(messages[latestUser].node.textContent)];
      const matches = userTexts.some(user => matchesPrompt(user, context));
      if (!matches) return { sources: [], reason: 'latest-user-mismatch' };
      const nextUser = messages.findIndex((turn, index) => index > latestUser && turn.role === 'user');
      answers = messages.slice(latestUser + 1, nextUser < 0 ? undefined : nextUser).filter(turn => turn.role === 'assistant');
    } else {
      if (!Array.isArray(context.before)) return { sources: [], reason: 'no-user-anchor' };
      answers = messages.filter(turn => turn.role === 'assistant' && !context.before.includes(fingerprint(turn)));
    }
    const answer = context.type === 'image_generation' ? answers.find(turn => turn.node.querySelectorAll?.('img')?.length) || answers.at(-1) : answers.find(turn => wordResponse(turn.node)) || answers.at(-1);
    if (!answer || context.type === 'image_generation' && Array.isArray(context.before) && context.before.includes(fingerprint(answer))) return { sources: [], reason: 'no-new-answer' };
    const code = [...(answer.node.querySelectorAll?.('pre code, pre') || [])].map(node => node.textContent || text(node));
    const words = [...(answer.node.querySelectorAll?.('[data-stream-word], [data-d-stream-word]') || [])].map(node => node.textContent || '').join(' ');
    const imageTurn = context.type === 'image_generation' ? answer.node.closest?.('article, [data-testid^="conversation-turn-"], [data-turn="assistant"]') : null;
    const node = imageTurn && !imageTurn.querySelector?.('[data-message-author-role="user"], [data-turn="user"]') ? imageTurn : answer.node;
    return { node, sources: [...new Set([...code, answer.text, answer.node.textContent || '', words].filter(Boolean))], reason: 'matched' };
  }
  let lastProblem = '';
  function extract(source, kind) {
    const key = kind === 'transcript_mindmap' ? 'branches' : kind === 'script_structure' ? 'parts' : kind === 'part_analysis' ? 'scenes' : '';
    if (!key) return '';
    const value = String(source || '').replace(/[\u200B\uFEFF]/g, '');
    for (let start = 0; start < value.length; start += 1) {
      if (value[start] !== '{') continue;
      let depth = 0, quoted = false, escaped = false;
      for (let end = start; end < value.length; end += 1) {
        const char = value[end];
        if (quoted) {
          if (escaped) escaped = false;
          else if (char === '\\') escaped = true;
          else if (char === '"') quoted = false;
          continue;
        }
        if (char === '"') quoted = true;
        else if (char === '{') depth += 1;
        else if (char === '}') depth -= 1;
        if (depth !== 0) continue;
        try {
          const parsed = JSON.parse(value.slice(start, end + 1));
          if (Array.isArray(parsed[key]) && parsed[key].length) return JSON.stringify(parsed);
          lastProblem = 'JSON thiếu mảng "' + key + '" hoặc mảng rỗng';
        } catch (error) { lastProblem = 'JSON lỗi: ' + String(error?.message || error).slice(0, 160); }
        break;
      }
    }
    return '';
  }
  function read(document, context) {
    const found = sources(document, context);
    if (context.type === 'transcript_rewrite' && found.sources.length) return {text: found.sources[0].trim(), reason:'matched'};
    lastProblem = '';
    const pools = [found];
    if (!found.anchored && context.type !== 'image_generation') pools.push(anchored(document, context));
    for (const pool of pools) for (const source of pool.sources || []) {
      const json = extract(source, context.type);
      if (json) return { text: json, reason: 'matched' };
    }
    const matched = pools.some(pool => pool.reason === 'matched');
    return { text: '', reason: matched ? 'invalid-json' : found.reason, detail: matched ? (lastProblem || 'không tìm thấy JSON') : '' };
  }
  function diagnose(document, context) {
    const messages = turns(document, context);
    return 'user=' + messages.filter(turn => turn.role === 'user').length + ', assistant=' + messages.filter(turn => turn.role === 'assistant').length + ', reason=' + read(document, context).reason;
  }
  function readStreaming(document, context) {
    const full = read(document, context);
    if (full.text) return { ...full, complete: true };
    if (context.type !== 'part_analysis') return { ...full, complete: false };
    const found = sources(document, context);
    const pool = [...(found.sources || []), ...(found.anchored ? [] : anchored(document, context).sources || [])];
    for (const source of pool) {
      const match = /"scenes"\s*:\s*\[/.exec(source);
      if (!match) continue;
      const scenes = [];
      let start = -1, depth = 0, quoted = false, escaped = false;
      for (let i = match.index + match[0].length; i < source.length; i++) {
        const c = source[i];
        if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue; }
        if (c === '"') { quoted = true; continue; }
        if (c === '{') { if (depth === 0) start = i; depth++; }
        else if (c === '}' && depth > 0) {
          depth--;
          if (depth === 0) {
            try {
              const scene = JSON.parse(source.slice(start, i + 1));
              if (!String(scene.prompt || '').trim()) break;
              scenes.push(scene);
            } catch { break; }
          }
        } else if (c === ']' && depth === 0) break;
      }
      if (scenes.length) return { text: JSON.stringify({ scenes }), reason: 'partial', complete: false };
    }
    return { ...full, complete: false };
  }
  globalThis.VISReplyReader = { turns, snapshot, sources, anchored, extract, read, readStreaming, diagnose, conversationChars };
})();

