// Deterministic evidence quality; no model calls or chat-text telemetry.
export const memoryKinds = ['preference', 'correction', 'claim', 'open_question', 'episode', 'style_feedback'];
const correction = /纠正|更正|勘误|上次.{0,25}(?:说错|错了)|不是.{1,100}而是/u;
const event = /(?:我|我们|今天|昨天|这次|本周|刚刚|已经|终于).{0,100}(?:完成了|解决了|证明了|找到了|决定了|约定了|读完了|学完了|讨论完了|整理完了)/u;
export function assessMemory(kind, text) {
 if (kind === 'correction' && !correction.test(text)) return {kind:'claim',eligible:true,reason:'tentative-human-claim'};
 if (kind === 'episode' && !event.test(text)) return {kind,eligible:false,reason:'event-evidence-insufficient'};
 return {kind,eligible:true,reason:'explicit-evidence'};
}
