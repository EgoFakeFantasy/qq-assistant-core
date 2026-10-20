export function normalizeGroupReplyPolicy(value='adaptive'){
 if(!['adaptive','mentions-only'].includes(value))throw Error('INVALID_GROUP_REPLY_POLICY');
 return value;
}
export function configForAdditionalGroup(config,group){
 if(!group||!config.allowedGroupIds?.includes(group.groupId)||group.groupId===config.groupId)throw Error('UNAPPROVED_ADDITIONAL_GROUP');
 return {...config,groupId:group.groupId,groupName:group.name,replyPolicy:normalizeGroupReplyPolicy(group.replyPolicy)};
}
export function hasDirectSelfMention(message,botId){
 return Array.isArray(message)&&message.some(s=>s?.type==='at'&&String(s.data?.qq)===botId);
}
