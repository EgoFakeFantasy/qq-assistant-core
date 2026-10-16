import {publicQuery} from './public-fetch.mjs';
// Trusted deployment settings enable topic lookup; documents cannot change settings.
export function autonomousPublicQuery(proposed,{context=[],sources=[]}={}) {
 const query=publicQuery(proposed);
 if(query.length>140||query.split(/\s+/).length>16||/[\n\r;；。]/.test(query)||/(?:[a-z]:[\\/]|https?:\/\/|gf-[a-f0-9]{16}|[a-f0-9]{32,}|sk-[\w-]+|session[_ -]?token|身份证|手机号|私人|私聊)/i.test(query))throw new Error('PUBLIC_TOPIC_KEYWORDS_REQUIRED');
 const normalized=query.normalize('NFKC').toLowerCase().replace(/\s+/g,' ');
 const privateText=[...context.map(m=>m.text||m.content||''),...sources.map(s=>s.text||'')];
 if(normalized.length>=30&&privateText.some(t=>String(t).normalize('NFKC').toLowerCase().replace(/\s+/g,' ').includes(normalized)))throw new Error('RAW_REFERENCE_TEXT_DENIED');
 return query;
}
