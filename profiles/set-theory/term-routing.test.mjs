import test from 'node:test';import assert from 'node:assert/strict';import {createKnowledgeBase} from './knowledge.mjs';
const id='a'.repeat(64);
test('English concepts locate older Chinese principle names',()=>{const kb=createKnowledgeBase({pages:[{bookId:id,title:'Old Chinese textbook',page:11,text:'子集合分离原则 在集合中分出满足性质的元素。'},{bookId:id,title:'Old Chinese textbook',page:23,text:'替换原则 类函数在集合上的像为集合。'}]});assert.equal(kb.search('separation')[0].pdfPage,11);assert.equal(kb.search('replacement')[0].pdfPage,23);assert.equal(kb.search('替换公理')[0].pdfPage,23);});
