# Long replies and merged chat records

Every QQ response is checked before sending. The defaults fold text above 500 visible characters or 12 lines into one QQ merged-forward card; shorter responses remain ordinary messages. The measurement includes the answer, textbook references, web sources and image captions.

This preserves complete content rather than generating a summary. Paragraph/sentence splitting respects Unicode glyph boundaries and keeps every text character in order. Images are placed at the end. Every node uses the actual bot identity, with a brief question excerpt in the first node. QQ can drop native reply associations inside forwarded nodes, so the excerpt provides the readable context. Human participants are never impersonated. Ordinary replies, Bilibili shares and paper recommendations use the same boundary.

Configure the private profile.json:

```json
"replyPresentation": {
  "inlineMaxCharacters": 500,
  "inlineMaxLines": 12,
  "forwardNodeCharacters": 800
}
```

Allowed ranges are 100–2000 characters, 3–40 lines, and 600–2000 characters per node. Reload an idle Hub after changes, preserving QQ login and queued messages. Group content cannot change these settings. Older profiles without this field receive the same defaults.

Only one write is attempted. After receiving message_id, the transport checks the outer message's actual group and bot author, then calls get_forward_msg to verify node authors, complete text and image count. Verified ordinary replies persist deliveryMode=forward, verified=true and nodeCount. Uncertain writes are never retried or replaced by a long plain-text flood.

Some NapCat versions can return placeholder group_id values for child nodes. Authorization therefore uses the outer get_msg group and author. Only the current bot's cards in the current group are expanded; foreign nested records are not followed recursively. Quoting the bot's card exposes its full text and attached images.

Casual replies prefer one to three sentences, normally within 200 characters. Mathematical proofs retain necessary assumptions, arguments and actual citations. Model, daily quota, search, knowledge and expression policies remain separate. The existing 6000 UTF-16-unit answer bound remains; complete outgoing text also has 16000-glyph and 64-node bounds. Oversized input fails rather than being silently truncated.

Sources: NapCat's [merged-forward API](https://doc.napneko.icu/develop/api/doc#send-forward-msg-%E5%8F%91%E9%80%81%E5%90%88%E5%B9%B6%E8%BD%AC%E5%8F%91-normal-native) and the installed send_group_forward_msg/get_forward_msg implementation. Custom news/prompt preview fields can be client-restricted; this implementation uses the native card without depending on custom preview metadata.
