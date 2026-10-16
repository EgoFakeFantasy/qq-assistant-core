import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {parseScholarFeed,normalizeCrossref,createScholarSources} from './scholar-sources.mjs';
import {createScholarReader,validateScholarEvidence} from './scholar-reader.mjs';
import {ScholarExplorer} from './scholar-explorer.mjs';
const abstract='We construct a family of structures with explicit rank bounds and prove the stated compactness theorem under the hypotheses. '.repeat(5);
const xml='<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2610.12345v2</id><title>A rank theorem</title><summary>'+abstract+'</summary><author><name>A. Researcher</name></author><published>2026-10-10T00:00:00Z</published><arxiv:doi xmlns:arxiv="http://arxiv.org/schemas/atom">10.1234/rank</arxiv:doi><category term="math.LO"/></entry></feed>';
const paper=parseScholarFeed(xml)[0],text=abstract.repeat(4),blocks=[{id:'page-1',label:'PDF page 1',text}];
test('Atom and RSS parse canonical arXiv identities without trusting external links',()=>{
 assert.equal(paper.id,'arxiv:2610.12345');assert.equal(paper.doi,'10.1234/rank');assert.equal(paper.publicationKind,'preprint');assert.deepEqual(paper.authors,['A. Researcher']);
 const rss='<rss><channel><item><title>RSS paper</title><link>https://arxiv.org/abs/math/0301234</link><description>'+abstract+'</description></item></channel></rss>';
 assert.equal(parseScholarFeed(rss)[0].id,'arxiv:math/0301234');
 assert.equal(parseScholarFeed(xml.replace('2610.12345v2','../../private')) .length,0);
 assert.throws(()=>parseScholarFeed('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///secret">]><feed/>'),/UNSAFE/);
});
test('Crossref retains journal attribution, actual publication date and strips markup',()=>{
 const p=normalizeCrossref({DOI:'10.1234/ABC',title:['<b>Theorem</b>'],abstract:'<jats:p>'+abstract+'</jats:p>',published:{'date-parts':[[2026,10,1]]},link:[{URL:'file:///private'}]},{name:'Logic journal'});
 assert.equal(p.doi,'10.1234/abc');assert.equal(p.title,'Theorem');assert.equal(p.published,'2026-10-01');assert.deepEqual(p.links,[]);
});
test('one source failure leaves other journals usable; requests are serialized and cache is reused',async()=>{
 let requests=0,active=0,maximum=0;
 const sources=createScholarSources({minIntervalMs:0,fetchFn:async u=>{requests++;active++;maximum=Math.max(active,maximum);await new Promise(setImmediate);active--;if(u.hostname.includes('arxiv'))throw Error('PUBLIC_HTTP_429');return {bytes:Buffer.from(JSON.stringify({message:{items:[{DOI:'10.1234/rank',title:['rank'],abstract,published:{'date-parts':[[2026,10,1]]}}]}}))};}});
 const settings={journals:[{name:'Test journal',issn:'0022-4812'}]};const r=await sources.discover(settings);assert.equal(r.candidates.length,1);assert.equal(r.sources[0].ok,false);const n=requests;await sources.discover(settings);assert.equal(requests,n);assert.equal(maximum,1);
});
test('scholar keywords and categories cannot expand the public API scope',async()=>{
 const s=createScholarSources({fetchFn:()=>assert.fail('no network')});await assert.rejects(s.discover({categories:['../../private']}),/CATEGORIES/);await assert.rejects(s.discover({query:'password Bearer secret'}),/PUBLIC_KEYWORDS/);
});
test('actual public HTML body becomes evidence blocks and abstracts are labelled separately',async()=>{
 const workspace=await mkdtemp(join(tmpdir(),'paper-read-'));const r=await createScholarReader({fetchFn:async()=>({bytes:Buffer.from('<article><section>'+text+'</section></article>')})}).read(paper,workspace);
 assert.equal(r.scope,'html-body');assert.ok(r.blocks.some(b=>b.text===text.trim()));assert.equal(r.workspace,workspace);
 const a=await createScholarReader({fetchFn:async()=>{throw Error('PUBLIC_HTTP_404');}}).read(paper,workspace);assert.equal(a.scope,'abstract');assert.equal(a.blocks[0].text,paper.abstract);
});
test('PDF fallback uses a bounded private file and configured Python dependency path',async()=>{
 const workspace=await mkdtemp(join(tmpdir(),'paper-pdf-'));let options;
 const r=await createScholarReader({pythonPath:'python-fixture',pythonLibraries:'private-libraries',fetchFn:async u=>{if(u.pathname.includes('/html/'))throw Error('PUBLIC_HTTP_404');return {bytes:Buffer.from('%PDF-fixture')};},runProcess:async(_exe,args,opts)=>{options=opts;assert.ok((await readFile(args[1])).subarray(0,5).toString()==='%PDF-');return {stdout:JSON.stringify({pageCount:1,pages:[{page:1,text}]})};}}).read(paper,workspace);
 assert.equal(r.scope,'pdf-body');assert.equal(options.env.PYTHONPATH,'private-libraries');await assert.rejects(readFile(join(workspace,'paper.pdf')),/ENOENT/);
});
test('fabricated support quotes are refused before sharing',()=>{
 assert.equal(validateScholarEvidence({share:true,evidence:[{blockId:'page-1',quote:'We construct a family of structures'}]},{blocks}),true);
 assert.throws(()=>validateScholarEvidence({share:true,evidence:[{blockId:'page-1',quote:'This invented claim is not in the paper'}]},{blocks}),/MISMATCH/);
 assert.throws(()=>validateScholarEvidence({share:true,evidence:[]},{blocks}),/INSUFFICIENT/);
});
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'scholar-cycle-'));let sends=0,reads=0;
 const config={enabled:true,targetGroupId:'1000000001',intervalMs:10800000,maxPapersPerCycle:2,maxSharesPerDay:2,minShareIntervalMs:0};
 const sources={discover:async()=>({candidates:[paper,{...paper,id:'doi:10.1234/rank',publicationKind:'journal-article',source:'Logic journal'}],sources:[{source:'arXiv',ok:true}]})};
 const reader={read:async(p,workspace)=>{reads++;return {paper:p,workspace,blocks,scope:'pdf-body',truncated:false};}};
 const curator={choose:async({candidates})=>({id:candidates[0].id}),review:async()=>({summary:'Concrete rank theorem',interestScore:0.9,share:true,shareText:'这个秩界的构造很值得讨论。',evidence:[{blockId:'page-1',quote:'We construct a family of structures'}],nextQueries:['rank theorem']})};
 const transport={check:async()=>({online:true,memberOfGroup:true}),sendProactive:async({groupId,text})=>{sends++;assert.equal(groupId,config.targetGroupId);assert.ok(text.includes(paper.url));assert.ok(text.includes('预印本'));return {ok:true,messageId:'123',verified:true};}};
 const options={root,sources,reader,curator,transport,config};return {...options,options,sends:()=>sends,reads:()=>reads,explorer:await ScholarExplorer.open(options)};
}
test('real read-review-share order deduplicates preprint/journal versions and persists verified receipts',async()=>{
 const f=await fixture(),r=await f.explorer.run();assert.equal(r.completed,1);assert.equal(f.reads(),1);assert.equal(f.sends(),1);assert.equal(f.explorer.diagnostics.recent[0].share.verified,true);
 const again=await ScholarExplorer.open(f.options);await again.run({manual:true});assert.equal(f.sends(),1);assert.equal(f.reads(),1);
});
test('unsupported model evidence, unknown selections and offline transport cannot send',async()=>{
 const f=await fixture();f.curator.review=async()=>({summary:'fake',interestScore:1,share:true,evidence:[{blockId:'page-1',quote:'Invented theorem without support'}]});assert.equal((await f.explorer.run()).error,'SCHOLAR_EVIDENCE_MISMATCH');assert.equal(f.sends(),0);
 const g=await fixture();g.curator.choose=async()=>({id:'unknown'});assert.equal((await g.explorer.run()).error,'CURATOR_UNKNOWN_PAPER');assert.equal(g.reads(),0);
 const h=await fixture();h.transport.check=async()=>({online:false});assert.equal((await h.explorer.run()).error,'TARGET_QQ_GROUP_OFFLINE');assert.equal(h.reads(),0);
});
test('uncertain QQ delivery is never resent after restart or expiry of the seen cache',async()=>{
 const f=await fixture();f.transport.sendProactive=async()=>{throw Error('NETWORK_TIMEOUT');};await f.explorer.run();assert.equal(f.explorer.diagnostics.recent[0].share.phase,'uncertain');
 const path=join(f.root,'scholar-state.json'),s=JSON.parse(await readFile(path,'utf8'));s.seen=[];await writeFile(path,JSON.stringify(s));let sends=0;f.transport.sendProactive=async()=>{sends++;return {ok:true};};const again=await ScholarExplorer.open(f.options);await again.run({manual:true});assert.equal(sends,0);
});
test('a fresh group mention can abort paper reading without any public action',async()=>{
 const f=await fixture(),controller=new AbortController();f.reader.read=async()=>{controller.abort();throw Error('ABORTED');};assert.equal((await f.explorer.run({signal:controller.signal})).status,'deferred-for-mentions');assert.equal(f.sends(),0);
});
