import {createHash} from 'node:crypto';

// A deterministic admission gate, not another model or an authorization policy.
export const ATTENTION_VERSION=1;
export function initialAttention(){return {version:1,credit:0.35,updatedAt:0,lastAutomaticAt:0,lastReplyAt:0,lastReplyUser:'',recent:[],automatic:[],admitted:0,withheld:0};}
export function validateAttention(s){
 if(!s||s.version!==1||!Number.isFinite(s.credit)||s.credit<0||s.credit>2||!['updatedAt','lastAutomaticAt','lastReplyAt','admitted','withheld'].every(k=>Number.isSafeInteger(s[k])&&s[k]>=0)||typeof s.lastReplyUser!=='string'||s.lastReplyUser.length>32||!Array.isArray(s.recent)||s.recent.length>24||s.recent.some(x=>!x||!/^[a-f0-9]{16}$/.test(x.key)||!Number.isSafeInteger(x.at)||x.at<0)||!Array.isArray(s.automatic)||s.automatic.length>12||s.automatic.some(x=>!Number.isSafeInteger(x)||x<0))throw Error('INVALID_ATTENTION_STATE');
 return s;
}
export function attentionDecision(previous,{now,text='',senderId='',mandatory=false,eligible=true,topic=false,question=false,addressed=false,cooldownMs=60000}={}){
 const state=structuredClone(validateAttention(previous||initialAttention()));
 if(!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(cooldownMs)||cooldownMs<0)throw Error('INVALID_ATTENTION_INPUT');
 const deny=reason=>{state.withheld++;return {state,allow:false,reason};};
 if(!eligible)return deny('reply-policy');
 // Current explicit requests always bypass interest credit, never reply authorization.
 if(mandatory){state.admitted++;return {state,allow:true,reason:'explicit-request'};}
 state.credit*=Math.exp(-Math.max(0,now-state.updatedAt)/600000);state.updatedAt=now;
 state.recent=state.recent.filter(x=>now-x.at<600000&&x.at<=now);
 state.automatic=state.automatic.filter(t=>now-t<600000&&t<=now);
 const key=createHash('sha256').update(String(text).normalize('NFKC').replace(/\s+/gu,'').toLowerCase()).digest('hex').slice(0,16);
 if(state.recent.some(x=>x.key===key))return deny('repeated-topic');
 state.recent.push({key,at:now});state.recent=state.recent.slice(-24);
 if(state.lastAutomaticAt&&now-state.lastAutomaticAt<cooldownMs)return deny('cooldown');
 if(state.automatic.length>=3)return deny('room-budget');
 const followup=state.lastReplyUser===senderId&&now-state.lastReplyAt>=0&&now-state.lastReplyAt<120000;
 const score=(topic?0.55:0)+(question?0.35:0)+(addressed?0.7:0)+(followup?0.95:0);
 // Unrelated long chatter cannot slowly turn itself into permission to interrupt.
 if(score===0)return deny('no-attention-cue');
 state.credit=Math.min(2,state.credit+score);
 if(state.credit<0.9)return deny('insufficient-attention');
 state.credit=Math.max(0,state.credit-0.9);state.lastAutomaticAt=now;state.automatic.push(now);state.admitted++;
 return {state,allow:true,reason:followup?'conversation-followup':addressed?'named-interest':'relevant-interest'};
}
export function attentionReply(previous,{now,senderId,delivered}={}){
 const state=structuredClone(validateAttention(previous));
 if(delivered&&Number.isSafeInteger(now)&&now>=0&&typeof senderId==='string'&&senderId.length<=32){state.lastReplyAt=now;state.lastReplyUser=senderId;}
 return state;
}
