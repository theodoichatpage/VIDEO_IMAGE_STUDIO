const fs=require('fs'),s=fs.readFileSync('extension/content.js','utf8');
function ok(x,m){if(!x)throw Error(m)}
ok(s.includes('[data-testid^="conversation-turn-"]'),'must support non-article conversation turns');
ok(s.includes('extractAssistantText'),'must have robust assistant text extractor');
ok(s.includes('pre code'),'must explicitly read JSON code blocks');
console.log('PASS text capture source checks');
