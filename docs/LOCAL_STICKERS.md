# Local cute stickers

The assistant uses a shared expression policy for QQ replies, proactive recommendations and Bilibili comments. Mocking or hostile reaction emoji are replaced before delivery. Small, friendly kaomoji are welcome; neither stickers nor kaomoji are mandatory, and mathematical proofs should stay undecorated.

Local expressive pictures are selected only from an operator-reviewed catalog. They can accompany ordinary chat without a web-image request. At most one local sticker is sent per response. Web images still require an explicit image-search request and retain their source attribution.

The default catalog is `private/stickers/catalog.json`, next to the main runtime directory. Set `localStickerRoot` in the private live configuration to override the folder. All groups deliberately share this approved asset catalog, while request workspaces and group materials remain scoped.

Catalog format:

```json
{
  "version": 1,
  "stickers": [{
    "id": "sticker-smile",
    "file": "smile.jpg",
    "title": "Friendly smile",
    "tags": ["greeting", "smile"],
    "reviewed": true,
    "tone": "cute",
    "sha256": "REPLACE_WITH_THE_64_CHARACTER_SHA256_OF_THE_REVIEWED_FILE"
  }]
}
```

Review the actual picture and its text before adding it. Use a flat PNG/JPEG filename, up to 4 MiB, and record its SHA-256. No symlinks, arbitrary paths, unreviewed entries or known hostile labels are accepted. Selected images are hash-checked again and copied into the active question workspace. A missing or invalid catalog supplies no stickers; ordinary replies still work.

The model sees IDs, titles and tags, never the source paths or the whole QQ image cache. Do not populate the catalog automatically from received images. After editing the catalog, reload the Hub when idle. Preserve ongoing replies, QQ login and knowledge indexes. Keep actual pictures and the catalog private; published tests use a synthetic image.
