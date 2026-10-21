(() => {
  const normalize = text => String(text || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
  const text = node => node?.innerText || node?.textContent || '';
  const roleOf = node => {
    const direct = node.getAttribute?.('data-message-author-role') || node.getAttribute?.('data-turn');
    if (['user', 'assistant'].includes(direct)) return direct;
    const parentRole = node.closest?.('[data-message-author-role]')?.getAttribute('data-message-author-role');
    if (['user', 'assistant'].includes(parentRole)) return parentRole;
    const hasUser = node.querySelector?.('[data-message-author-role="user"]');
    const hasAssistant = node.querySelector?.('[data-message-author-role="assistant"]');
    if (hasUser && hasAssistant) return '';
    if (hasUser) return 'user';
    if (hasAssistant || node.matches?.('.markdown, .agent-turn') || node.querySelector?.('.markdown, .agent-turn')) return 'assistant';
    return '';
  };
  function turns(document) {
    const candidates = [...document.querySelectorAll('article[data-testid^="conversation-turn-"], article[data-turn]'), ...document.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]'), ...document.querySelectorAll('main .markdown, main .agent-turn')];
    const nodes = [...new Set(candidates)].filter(node => ['user', 'assistant'].includes(roleOf(node)));
    const top = nodes.filter((node, index) => !nodes.some((parent, other) => index !== other && roleOf(parent) === roleOf(node) && parent.contains?.(node)));
    top.sort((a, b) => {
      const position = a.compareDocumentPosition?.(b) || 0;
      return position & 4 ? -1 : position & 2 ? 1 : 0;
    });
    return top.map(node => ({ role: roleOf(node), node, text: text(node) }));
  }
  function fingerprint(turn) {
    const identity = turn.node.getAttribute?.('data-message-id') || turn.node.getAttribute?.('data-testid') || '';
    return identity + ':' + normalize(turn.text);
  }
  function snapshot(document) { return turns(document).filter(turn => turn.role === 'assistant').map(fingerprint); }
  function sources(document, context = {}) {
    const messages = turns(document);
    const latestUser = messages.findLastIndex(turn => turn.role === 'user');
    let answers;
    if (latestUser >= 0) {
      const userTexts = [normalize(messages[latestUser].text), normalize(messages[latestUser].node.textContent)];
      const expected = normalize(context.prompt);
      const marker = context.id ? '[VIS_JOB_ID:' + context.id + ']' : '';
      const matches = userTexts.some(user => Boolean((marker && user.includes(marker)) || (expected && user.includes(expected))));
      if (!matches) return { sources: [], reason: 'latest-user-mismatch' };
      answers = messages.slice(latestUser + 1).filter(turn => turn.role === 'assistant');
    } else {
      if (!Array.isArray(context.before)) return { sources: [], reason: 'no-user-anchor' };
      answers = messages.filter(turn => turn.role === 'assistant' && !context.before.includes(fingerprint(turn)));
    }
    const answer = answers.at(-1);
    if (!answer) return { sources: [], reason: 'no-new-answer' };
    const code = [...(answer.node.querySelectorAll?.('pre code, pre') || [])].map(node => node.textContent || text(node));
    return { sources: [...new Set([...code, answer.text, answer.node.textContent || ''].filter(Boolean))], reason: 'matched' };
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
    const messages = turns(document);
    return 'user=' + messages.filter(turn => turn.role === 'user').length + ', assistant=' + messages.filter(turn => turn.role === 'assistant').length + ', reason=' + read(document, context).reason;
  }
  globalThis.VISReplyReader = { turns, snapshot, sources, extract, read, diagnose };
})();
