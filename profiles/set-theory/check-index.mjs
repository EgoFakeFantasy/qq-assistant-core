import { readFile } from 'node:fs/promises';
import { createKnowledgeBase } from './knowledge.mjs';
const index = JSON.parse(await readFile(process.argv[2], 'utf8'));
const kb = createKnowledgeBase(index);
const ids = [...new Set(index.pages.map(p => p.bookId))];
const coverage = ids.map(bookId => {
  const pages = index.pages.filter(p => p.bookId === bookId);
  const samples = [pages[0], pages[Math.floor(pages.length / 2)], pages.at(-1)];
  return { bookId, title: pages[0].title, indexedPages: pages.length,
    samples: samples.map(p => { const result = kb.readPage(bookId, p.page); if (!result?.text) throw new Error('MISSING_PAGE'); return { pdfPage: result.pdfPage, characters: result.text.length, citation: result.citation }; }) };
});
const queries = ['什么是共尾度', 'countable ordinal', 'forcing', 'large cardinal'].map(query => ({ query,
  hits: kb.search(query).map(p => ({ bookId: p.bookId, pdfPage: p.pdfPage, score: p.score, truncated: p.truncated })) }));
console.log(JSON.stringify({ indexedPages: kb.pageCount, coverage, queries, mathematicalCorrectnessVerified: false }, null, 2));
