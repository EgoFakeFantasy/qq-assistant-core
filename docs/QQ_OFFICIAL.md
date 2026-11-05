# Official QQ SDK integration (local adapter)

The local set-theory profile now supports `@tencent-connect/qqbot-nodejs@1.0.5`.
This is a separate bot application; it cannot log normal QQ account 2000000002 into the official SDK or lift that account's restriction.
The default OneBot entry and accepted private profile remain in place.

## Prerequisites

1. Create a bot at https://q.qq.com/ and complete the platform's verification, testing and release requirements.
2. Obtain AppID and AppSecret. Inject the secret only through local `QQBOT_APP_SECRET`; never commit it or post it in chat.
3. Have administrators add the official bot to the four groups. Confirm each `group_openid` and the bot's group-specific `member_openid`.
   Old group numbers are logical policy aliases, not official API identifiers.
4. Request all-message and proactive permissions as needed. `bot_state` itself may need platform allowlisting; denied access is never reported as verified membership.

From upstream, create a NEW private configuration (existing files are never overwritten):

```powershell
node scripts/prepare-qq-official.mjs --source private/live-config.json --destination private/qq-official-config.json
node scripts/check-qq-official.mjs private/qq-official-config.json
```

The new file preserves `profilePath`, model and textbook settings; it gets a new Hub token, adjacent port and separate runtime directory.
Fill `qqOfficial.appId` and the four group OpenID bindings; blanks fail closed.
`allowProactive` defaults to false. After privately injecting the secret, run:

```powershell
node profiles/set-theory/start-live.mjs --live --config private/qq-official-config.json
```

Official WebSocket transport requires no public exposure of the local Hub. Allowlisted and validated events enter its authenticated loopback route.
No SDK raw logger is configured, keeping chat bodies, platform credentials and media URLs out of logs.
This adaptation does not change Windows tasks, activate production, replace the old Hub, or perform group/model probes.

## Compatibility

| Feature | Adapter and boundary |
| --- | --- |
| Axu, Hui, fixed models, humanities routing | Existing profile and policies; private conversations stay with Axu |
| Textbook search, Jech page images, public research | Existing modules; outbound images use official uploads |
| Learning, memory, feedback, reviewed persona | Existing features; new identities use a separate runtime. Old member memories and public learning archives remain in their original location and are not auto-migrated |
| Group/private replies | Group passive window: 5 minutes/5 replies; C2C: 60 minutes/4 replies. Expired queued jobs do not invoke models |
| 1000000004 | Only a real current official self-mention permits replies. Quoted mentions, humanities topics and @all cannot authorize responses; proactive sending is blocked |
| Long answers | At most two short text parts, or preview plus complete answer.txt, with separate images. Capacity is reserved before sending; overflow is rejected, never silently truncated |
| Quotes | Received-event cache or quoted body in the current platform event, including indexes for outbound bot replies. No arbitrary history fetch or body-cache restoration after restart |
| Group files | Only attachments received by this process, not the entire group directory. Attachments must be received again after restart; existing parsing/import tools remain usable |
| All-message context/proactive posts | Platform permission and group settings required. Proactive posts require explicit config and fresh bot_state approval; disabled by default |
| Forward cards/arbitrary history/full directory | No equivalent capability implemented; replaced by files, current attachments and bounded caches |
| Delivery readback | Official acceptance records delivered=true, verified=false; it does not reproduce OneBot get_msg verification |
| Private admission | A genuine current official C2C event, not a claimed QQ friend-list query; isolated from each group |

## Identity, security and failures

AppID, conversation and OpenID receive persistent internal numeric aliases for existing plugin interfaces.
They are not QQ numbers; names never establish identity and no OpenID is hashed into an old QQ number.
Different groups, C2C and applications never auto-merge member memory. Status exposes `channel=qq-official`, the namespace, alias marker and capability scope.

Before external sending, reply capacity and write deduplication are persisted. Timeout, partial success and restart never automatically replay the same write.
Media is uploaded with srv_send_msg=false, then explicitly sent. msg_seq comes from the durable reservation and is not reset to 1 after restart.
Limits: 100000 identity entries, 10000 reply tickets, 20000 write ledger entries. Exhaustion fails closed and requires local maintenance, not deletion of live credentials to replay writes.
Passive deadlines also bound model cancellation. Model/effort stay unchanged, but tasks exceeding the official reply window cannot retain the old immediate-reply experience.

## Verification and live acceptance

```powershell
node --test test/qq-official.test.js
npm run verify
```

Offline tests cover FakeSDK scenarios and message construction through the installed real SDK with network requests replaced locally. They contact neither QQ nor models. Installation, simulated events and SDK ready do not establish real delivery acceptance.
After activation, independently verify application identity, all four bindings/settings, current real mentions and persona routing, images/files and failure receipts.
Permissions, authorization, content review and quotas depend on the actual application.

References:
- https://github.com/tencent-connect/qqbot-nodejs
- https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_message_create.html
- https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_messages.post.html
- https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_bot_state.get.html
