// The host owns concurrency. Each bot keeps its own group-scoped queue/state.
export class QuestionWorkerPool {
  #scopes; #limit; #perGroup; #optional; #onError;
  #active = new Map(); #cursor = 0; #waiter = null; #resolve = null; #paused = false;

  constructor(scopes, { concurrency = 1, perGroup = 1, optional = 1, onError = () => {} } = {}) {
    for (const [value, max] of [[concurrency, 6], [perGroup, 3], [optional, 2]]) {
      if (!Number.isInteger(value) || value < 1 || value > max) throw Error('INVALID_WORKER_LIMIT');
    }
    this.#scopes = [...scopes.values()];
    this.#limit = concurrency; this.#perGroup = perGroup; this.#optional = optional; this.#onError = onError;
  }

  get diagnostics() {
    return { concurrency: this.#limit, perGroupConcurrency: this.#perGroup, optionalConcurrency: this.#optional,
      active: this.#active.size, activeBackground: [...this.#active.values()].filter(job=>job.background).length, activeOptional: [...this.#active.values()].filter(job => !job.mandatory).length, paused: this.#paused };
  }

  runBackground(groupId, task) {
    if(this.#scopes.some(scope=>scope.config.groupId===groupId&&scope.config.replyPolicy==='mentions-only'))return null;
    if (this.#paused || this.#active.size >= this.#limit || this.#active.has('background:'+groupId) ||
        [...this.#active.values()].filter(job=>!job.mandatory).length >= this.#optional ||
        [...this.#active.values()].filter(job=>job.groupId===groupId).length >= this.#perGroup ||
        this.#scopes.some(scope=>scope.bot.diagnostics?.queued>0 || scope.bot.peekJob())) return null;
    const key='background:'+groupId;
    const controller=new AbortController();
    this.#active.set(key,{groupId,mandatory:false,background:true,controller});
    const result=Promise.resolve().then(()=>task({signal:controller.signal})).finally(()=>{this.#active.delete(key);this.#pump();});
    result.catch(error=>this.#onError(error));
    return result;
  }

  pause() { this.#paused = true; this.#pump(); }
  resume() { this.#paused = false; return this.drain(); }
  drain() {
    if (!this.#waiter) this.#waiter = new Promise(resolve => { this.#resolve = resolve; });
    const result = this.#waiter;
    this.#pump();
    return result;
  }

  #pump() {
    while (!this.#paused && this.#active.size < this.#limit) {
      const active = [...this.#active.values()];
      const optional = active.filter(job => !job.mandatory).length;
      const candidates = [];
      for (let offset = 0; offset < this.#scopes.length; offset++) {
        const index = (this.#cursor + offset) % this.#scopes.length;
        const scope = this.#scopes[index];
        if (active.filter(job => job.groupId === scope.config.groupId).length >= this.#perGroup) continue;
        const job = scope.bot.peekJob();
        if (job && (job.mandatory || optional < this.#optional)) candidates.push({ index, scope, job, offset });
      }
      // Mentions first; round robin between groups at the same priority.
      candidates.sort((a, b) => Number(b.job.mandatory) - Number(a.job.mandatory) || a.offset - b.offset);
      const next = candidates[0];
      if (!next) break;
      const key = next.scope.config.groupId + ':' + next.job.messageId;
      const task = next.scope.bot.startNext();
      if (!task) break;
      this.#cursor = (next.index + 1) % this.#scopes.length;
      this.#active.set(key, { ...next.job, groupId: next.scope.config.groupId });
      Promise.resolve(task).catch(error => this.#onError(error)).finally(() => {
        this.#active.delete(key);
        this.#pump();
      });
    }
    // Any ready human reply reclaims a background slot that occupies the optional budget.
    const current=[...this.#active.values()];
    if(current.filter(job=>!job.mandatory).length>=this.#optional&&this.#scopes.some(scope=>{const job=scope.bot.peekJob();return job&&!job.mandatory&&current.filter(active=>active.groupId===scope.config.groupId&&!active.background).length<this.#perGroup;})){
      for(const job of current)if(job.background&&!job.controller.signal.aborted)job.controller.abort();
    }
    // A new mention may reclaim the background slot; normal replies are never interrupted.
    for(const scope of this.#scopes){
      if(!scope.bot.peekJob()?.mandatory)continue;
      const groupActive=[...this.#active.values()].filter(job=>job.groupId===scope.config.groupId);
      if(this.#active.size>=this.#limit||groupActive.length>=this.#perGroup){
        for(const job of this.#active.values())if(job.background&&!job.controller.signal.aborted)job.controller.abort();
      }
    }
    if (this.#active.size === 0 && this.#waiter) {
      const done = this.#resolve;
      this.#waiter = null; this.#resolve = null;
      done();
    }
  }
}
