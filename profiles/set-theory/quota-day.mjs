export function quotaTimeZone(value='Asia/Shanghai'){
 if(typeof value!=='string'||!value||value.length>80)throw Error('INVALID_QUOTA_TIME_ZONE');
 try{return new Intl.DateTimeFormat('en',{timeZone:value}).resolvedOptions().timeZone;}
 catch{throw Error('INVALID_QUOTA_TIME_ZONE');}
}
export function quotaDay(now,timeZone='Asia/Shanghai'){
 return new Intl.DateTimeFormat('en-CA',{timeZone:quotaTimeZone(timeZone),year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
}
