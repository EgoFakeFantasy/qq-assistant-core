export const philosophyJournals=[
 {name:'Continental Philosophy Review',issn:'1387-2842',domain:'continental-philosophy'},
 {name:'Philosophical Studies',issn:'0031-8116',domain:'analytic-philosophy'}
];
export const scholarDomains=['mathematics','continental-philosophy','analytic-philosophy'];
export function expandScholarSettings(settings){
 const domains=settings.domains||['mathematics'];
 if(!Array.isArray(domains)||!domains.length||domains.some(d=>!scholarDomains.includes(d)))throw Error('SCHOLAR_DOMAINS_INVALID');
 return {...settings,domains,journals:settings.journals,interests:[...new Set([...(settings.interests||[]),...(domains.includes('continental-philosophy')?['phenomenology','hermeneutics']:[]),...(domains.includes('analytic-philosophy')?['epistemology','philosophy of language']:[])])]};
}
