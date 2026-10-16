import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {indexVisualPages} from '../profiles/set-theory/visual-index.mjs';
const args=process.argv.slice(2),value=flag=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};
try{
 const runtime=JSON.parse(await readFile(resolve(value('--config')||'private/live-config.json'),'utf8')),bookId=value('--book-id');
 const manifest=JSON.parse(await readFile(resolve(runtime.corpusRoot,'manifest.json'),'utf8')),book=manifest.books.find(x=>x.bookId===bookId);
 if(!book)throw Error('UNKNOWN_BOOK');
 let pages;if(args.includes('--all'))pages=Array.from({length:book.pages},(_,i)=>i+1);
 else{const input=value('--pages');if(!input)throw Error('EXPLICIT_PAGES_OR_ALL_REQUIRED');pages=[];for(const part of input.split(',')){if(!/^\d+(?:-\d+)?$/.test(part))throw Error('INVALID_PAGES');const [a,b=a]=part.split('-').map(Number);if(a<1||b<a||b>book.pages)throw Error('INVALID_PAGES');for(let n=a;n<=b;n++)pages.push(n);}}
 console.log(JSON.stringify(await indexVisualPages({runtime,bookId,pages,onProgress:p=>console.log(JSON.stringify(p))})));
}catch(e){console.error(/^[A-Z_]+$/.test(e.message)?e.message:'VISUAL_INDEX_FAILED');process.exitCode=1;}
