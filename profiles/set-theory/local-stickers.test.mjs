import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createLocalStickers} from './local-stickers.mjs';
import {createResourceSession} from './resource-session.mjs';
import {TeachingBot,MODEL,EFFORT} from './teaching-bot.mjs';
import {createKnowledgeBase} from './knowledge.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN0cAAAAASUVORK5CYII=','base64');
const sha256=createHash('sha256').update(png).digest('hex');
const record={id:'sticker-smile',file:'smile.png',title:'Friendly smile',tags:['smile'],tone:'cute',reviewed:true,sha256};
async function fixture(rows=[record]){
 const root=await mkdtemp(join(tmpdir(),'local-stickers-'));
 const dir=join(root,'stickers'),workspace=join(root,'turn');await mkdir(dir);await mkdir(workspace);
 await writeFile(join(dir,'smile.png'),png);
 await writeFile(join(dir,'catalog.json'),JSON.stringify({version:1,stickers:rows}));
 return {root,dir,workspace,stickers:await createLocalStickers({root:dir})};
}
test('missing local catalog stays optional and offers no arbitrary local files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'no-stickers-'));const s=await createLocalStickers({root:join(root,'absent')});
 assert.deepEqual(s.list(),[]);await assert.rejects(s.select('sticker-forged',{workspace:root}),/UNKNOWN_LOCAL_STICKER/);
});
test('reviewed hash-pinned local images are copied into the active workspace and rechecked after mutation',async()=>{
 const {stickers,workspace,dir}=await fixture();
 assert.deepEqual(stickers.list(),[{id:'sticker-smile',title:'Friendly smile',tags:['smile']}]);
 const image=await stickers.select('sticker-smile',{workspace});
 assert.equal(image.kind,'local-sticker');assert.equal(image.path.startsWith(workspace),true);
 assert.deepEqual(await readFile(image.path),png);assert.equal((await stickers.select('sticker-smile',{workspace})).path,image.path);
 await writeFile(join(dir,'smile.png'),Buffer.concat([png,Buffer.from('changed')]));
 await assert.rejects(stickers.select('sticker-smile',{workspace}),/FILE_REJECTED/);
});
test('unreviewed hostile traversal and mismatched-hash catalog rows fail closed',async()=>{
 const rows=[record,{...record,id:'sticker-unreviewed',reviewed:false},{...record,id:'sticker-hostile',title:'mocking face'},
 {...record,id:'sticker-private',file:'../secret.png'},{...record,id:'sticker-changed',sha256:'0'.repeat(64)}];
 const {stickers}=await fixture(rows);assert.equal(stickers.list().length,1);assert.equal(stickers.diagnostics.rejected,4);
});
test('symlinked catalog source cannot broaden the local image allowlist',async t=>{
 const {dir,root}=await fixture();const outside=join(root,'outside.png');await writeFile(outside,png);
 try{await symlink(outside,join(dir,'link.png'));}catch(e){if(['EPERM','EACCES','ENOTSUP'].includes(e.code)){t.skip('Host disallows creating symlinks');return;}throw e;}
 await writeFile(join(dir,'catalog.json'),JSON.stringify({version:1,stickers:[{...record,file:'link.png'}]}));
 assert.deepEqual((await createLocalStickers({root:dir})).list(),[]);
});
test('ordinary chat can select one reviewed local sticker while web images still need an explicit request',async()=>{
 const {stickers,workspace}=await fixture([{...record},{...record,id:'sticker-kind'}]);let network=0;
 const session=createResourceSession({runtime:{localStickers:stickers,resources:{list:async()=>[]},webResources:{images:async()=>{network++;return {images:[]};}}},
 request:{question:'Good morning',cwd:workspace,context:[],sources:[]}});
 const context=await session.initial({});assert.equal(context.localStickers.length,2);
 assert.deepEqual(await session.output([],{}),[]);
 const images=await session.output(['sticker-smile'],{});assert.equal(images[0].kind,'local-sticker');assert.equal(network,0);
 await assert.rejects(session.output(['image-forged'],{}),/NOT_REQUESTED/);
 await assert.rejects(session.output(['sticker-forged'],{}),/NOT_REQUESTED/);
 await assert.rejects(session.output(['sticker-smile','sticker-kind'],{}),/LOCAL_STICKER_SEND_LIMIT/);
 await assert.rejects(session.output(['sticker-smile','sticker-smile'],{}),/INVALID_IMAGE_SELECTION/);
});
test('local sticker delivery has no fabricated web-source caption',async()=>{
 const {workspace}=await fixture();let sent;
 const base=JSON.parse(await readFile(new URL('./profile.json',import.meta.url),'utf8'));
 const bot=new TeachingBot({config:{...base,mode:'offline'},runtimeRoot:workspace,knowledge:createKnowledgeBase({pages:[]}),
 model:{kind:'mock',generate:async()=>({status:'answer',text:'Good morning (｡•ᴗ•｡)',citations:[],outgoingImages:[{id:'sticker-smile',kind:'local-sticker',title:'Friendly smile',path:join(workspace,'smile.png')}],model:MODEL,reasoningEffort:EFFORT,billingRoute:'chatgpt-plan'})},
 transport:{kind:'mock',send:async value=>{sent=value;return {ok:true,messageId:'42'};}}});
 await bot.ingest({post_type:'message',message_type:'group',self_id:base.botId,group_id:base.groupId,user_id:'12345678',message_id:'7',message:[{type:'at',data:{qq:base.botId}},{type:'text',data:{text:'Good morning'}}]});
 await bot.drain();assert.equal(sent.images[0].kind,'local-sticker');assert.equal(sent.text,'Good morning (｡•ᴗ•｡)');
 assert.doesNotMatch(sent.text,/undefined|来源|许可/);
});
