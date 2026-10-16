import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseQqAgentOutput } from '../../src/infrastructure/codex/qq-agent-output.js';
import { resolveQqReplyFileAttachments } from '../../src/qq-reply-files.js';
import { writeResponseBodyToFile } from '../../src/bounded-stream.js';
const output = path => parseQqAgentOutput(JSON.stringify({status:'reply',text:'mock',bubbles:[],reply:{mode:'plain',targetUserId:''},attachments:[{kind:'file',path,name:'fixture.txt'}]})).output;
test('native absolute attachment paths survive serialization and still obey output-root boundary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qq-native-'));
  const allowed = join(root, 'ok.txt'); await writeFile(allowed, 'fixture');
  const result = await resolveQqReplyFileAttachments(output(allowed), {event:{qqTaskWorkspace:{outputDir:root}}});
  assert.equal(result.attachments[0].path, await realpath(allowed));
  const denied = await resolveQqReplyFileAttachments(output(allowed), {event:{qqTaskWorkspace:{outputDir:join(root, 'other')}}});
  assert.equal(denied.attachments.length, 0); assert.equal(denied.failures.length, 1);
  assert.doesNotMatch(output('relative.txt'), /\[\[qq_file/);
  assert.doesNotMatch(output('\\\\server\\share\\file.txt'), /\[\[qq_file/);
});
test('download temporary file is flushed through a writable handle before rename', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qq-native-flush-')); const file = join(root, 'out.txt');
  const result = await writeResponseBodyToFile(new Response('synthetic'), file, {maxBytes:20});
  assert.equal(result.bytes,9); assert.equal(await readFile(file,'utf8'),'synthetic');
});
