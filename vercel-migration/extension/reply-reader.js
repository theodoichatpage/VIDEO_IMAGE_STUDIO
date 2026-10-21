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
    const hintedUsers = new Set(promptBlocks);
    const role = node => hintedUsers.has(node) ? 'user' : roleOf(node);
    const headings = [...document.querySelectorAll('h5, h6, [role="heading"]')].filter(node => /^(you said|bạn đã nói|bạn nói|chatgpt said|chatgpt đã nói|chatgpt nói)\s*:?$/i.test(normalize(node.textContent)));
    const semanticTurns = headings.map(node => node.closest?.('article, [data-testid*="conversation-turn"], [data-turn]') || node.parentElement).filter(Boolean);
    const candidates = [...document.querySelectorAll('[data-testid^="conversation-turn-"], [data-testid="conversation-turn"], [data-turn="user"], [data-turn="assistant"], main article, [role="main"] article, article'), ...semanticTurns, ...document.querySelectorAll('article[data-testid^="conversation-turn-"], article[data-turn]'), ...document.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]'), ...document.querySelectorAll('main .markdown, main .agent-turn')];
    const nodes = [...new Set([...candidates, ...wordRoots, ...promptBlocks])].filter(node => ['user', 'assistant'].includes(role(node)));
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
  function snapshot(document) { return turns(document).filter(turn => turn.role === 'assistant').map(fingerprint); }
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
  function sources(document, context = {}) {
    const messages = turns(document, context);
    const hasUsers = messages.some(turn => turn.role === 'user');
    const latestUser = messages.findLastIndex(turn => turn.role === 'user' && (context.type !== 'image_generation' || [normalize(turn.text), normalize(turn.node.textContent)].some(value => matchesPrompt(value, context))));
    if (context.type === 'image_generation' && hasUsers && latestUser < 0) return { sources: [], reason: 'latest-user-mismatch' };
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
    const answer = answers.find(turn => wordResponse(turn.node)) || answers.at(-1);
    if (!answer || context.type === 'image_generation' && Array.isArray(context.before) && context.before.includes(fingerprint(answer))) return { sources: [], reason: 'no-new-answer' };
    const code = [...(answer.node.querySelectorAll?.('pre code, pre') || [])].map(node => node.textContent || text(node));
    const words = [...(answer.node.querySelectorAll?.('[data-stream-word], [data-d-stream-word]') || [])].map(node => node.textContent || '').join(' ');
    return { node: answer.node, sources: [...new Set([...code, answer.text, answer.node.textContent || '', words].filter(Boolean))], reason: 'matched' };
  }
  function extract(source, kind) {
    const key = kind === 'script_structure' ? 'parts' : kind === 'part_analysis' ? 'scenes' : '';
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
        } catch {}
        break;
      }
    }
    return '';
  }
  function read(document, context) {
    const found = sources(document, context);
    for (const source of found.sources) {
      const json = extract(source, context.type);
      if (json) return { text: json, reason: 'matched' };
    }
    return { text: '', reason: found.reason === 'matched' ? 'invalid-json' : found.reason };
  }
  function diagnose(document, context) {
    const messages = turns(document, context);
    return 'user=' + messages.filter(turn => turn.role === 'user').length + ', assistant=' + messages.filter(turn => turn.role === 'assistant').length + ', reason=' + read(document, context).reason;
  }
  function readStreaming(document, context) {
    const full = read(document, context);
    if (full.text) return { ...full, complete: true };
    if (context.type !== 'part_analysis') return { ...full, complete: false };
    for (const source of sources(document, context).sources) {
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
  globalThis.VISReplyReader = { turns, snapshot, sources, extract, read, readStreaming, diagnose };
})();
