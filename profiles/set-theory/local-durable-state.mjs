import { mkdir, realpath, lstat, readFile, open, rename, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { syncDirectory } from '../../src/file-store.js';

// One supervisor/one process owns this directory. This is not a distributed lock.
// Successful save means file data was synced and atomically renamed. Some OSes
// do not support directory fsync; hard power-loss durability is a separate gate.
export function validateTeachingState(state,{groupId='1000000001',botId='2000000002'}={}) {
  if (!state || ![1,2].includes(state.version) || state.groupId !== groupId || !/^\d{4,20}$/.test(groupId) || state.botId !== botId || !/^\d{4,20}$/.test(botId) ||
      !Number.isSafeInteger(state.calls) || state.calls < 0 || state.calls > Number.MAX_SAFE_INTEGER ||
      typeof state.day !== 'string' || !/^(?:|\d{4}-\d{2}-\d{2})$/.test(state.day)) throw new Error('INVALID_STATE');
  for (const [key, limit] of [['queue',256],['context',200],['seen',10000],['lastUser',10000],['receipts',200]]) {
    if (!Array.isArray(state[key]) || state[key].length > limit) throw new Error('INVALID_STATE_' + key);
  }
  const jobValid = job => job && typeof job.mandatory === 'boolean' && Array.isArray(job.context) && job.context.length <= 200 &&
    job.event?.groupId === state.groupId && /^\d{4,20}$/.test(job.event?.senderId) && job.event.senderId !== state.botId &&
    typeof job.event.text === 'string' && job.event.text.length <= 12000 &&
    typeof job.event.raw?.message_id === 'string' && job.event.raw.message_id.length <= 128;
  if(state.version===2&&(!Array.isArray(state.activeJobs)||state.activeJobs.length>6||state.activeJobs.some(a=>!jobValid(a.job)||!['generating','sending'].includes(a.phase))||JSON.stringify(state.active)!==JSON.stringify(state.activeJobs[0]||null)||new Set(state.activeJobs.map(a=>a.job.event.raw.message_id)).size!==state.activeJobs.length))throw Error('INVALID_ACTIVE_JOBS');
  if (state.queue.some(job => !jobValid(job)) ||
      (state.active !== null && (!jobValid(state.active.job) || !['generating','sending'].includes(state.active.phase)))) throw new Error('INVALID_STATE_JOB');
  for (const pair of [...state.seen, ...state.lastUser]) {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || pair[0].length > 256 || !Number.isFinite(pair[1])) throw new Error('INVALID_STATE_TIME');
  }
  if (state.lastProactive !== null && !Number.isFinite(state.lastProactive)) throw new Error('INVALID_STATE_TIME');
  return state;
}

export class LocalDurableState {
  #root; #file; #groupId; #botId; #tail = Promise.resolve(); #poisoned = false;
  constructor(root, { maxBytes = 2 * 1024 * 1024, groupId='1000000001', botId='2000000002' } = {}) {
    if(!/^\d{4,20}$/.test(groupId))throw Error('INVALID_GROUP_ID');this.#groupId=groupId;if(!/^\d{4,20}$/.test(botId))throw Error('INVALID_BOT_ID');this.#botId=botId;
    this.#root = resolve(root); this.#file = join(this.#root, 'teaching-state.json');
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('INVALID_LIMIT');
    this.maxBytes = maxBytes;
  }
  async #check() {
    await mkdir(this.#root, { recursive: true });
    if (resolve(await realpath(this.#root)) !== this.#root) throw new Error('LINKED_STATE_ROOT');
    const info = await lstat(this.#file).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
    if (info && (!info.isFile() || info.isSymbolicLink() || info.size > this.maxBytes)) throw new Error('UNSAFE_STATE_FILE');
  }
  async load() {
    await this.#tail;
    try {
      await this.#check();
      const body = await readFile(this.#file, 'utf8').catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
      return body === null ? null : validateTeachingState(JSON.parse(body),{groupId:this.#groupId,botId:this.#botId});
    } catch (error) { this.#poisoned = true; throw error; }
  }
  save(state) {
    const body = JSON.stringify(validateTeachingState(structuredClone(state),{groupId:this.#groupId,botId:this.#botId}));
    if (Buffer.byteLength(body) > this.maxBytes) return Promise.reject(new Error('STATE_TOO_LARGE'));
    const operation = this.#tail.then(async () => {
      if (this.#poisoned) throw new Error('STATE_REQUIRES_OPERATOR_REPAIR');
      await this.#check();
      const temporary = join(this.#root, `.state-${randomUUID()}.tmp`);
      let handle;
      try {
        handle = await open(temporary, 'wx', 0o600);
        await handle.writeFile(body, 'utf8'); await handle.sync(); await handle.close(); handle = null;
        await rename(temporary, this.#file); await syncDirectory(this.#root);
      } finally { await handle?.close().catch(() => {}); await unlink(temporary).catch(() => {}); }
    });
    this.#tail = operation.catch(() => {});
    return operation;
  }
}
