import {validateScholarEvidence} from './scholar-reader.mjs';
// One bounded correction keeps exact source checks, including page coverage.
export async function verifiedScholarReview(evidence,call){
 const citationCandidates=evidence.blocks.slice(0,12).filter(b=>b.text.length>=12).map(b=>({blockId:b.id,quote:b.text.slice(0,240)}));
 let review=await call({citationCandidates});
 try{validateScholarEvidence(review,evidence);return review;}catch(error){
  if(!['SCHOLAR_EVIDENCE_MISMATCH','SCHOLAR_UNREAD_PAGE_CITATION','SCHOLAR_READING_SCOPE_REQUIRED','SCHOLAR_SCOPE_OVERCLAIM','SCHOLAR_INSUFFICIENT_READING'].includes(error.message))throw error;
  review=await call({citationCandidates,repair:{code:error.message,previousEvidence:review.evidence||[]}});
  validateScholarEvidence(review,evidence);return review;
 }
}
