# Bilibili History Cleaner

[中文说明](README.zh-CN.md)

Tampermonkey userscript for manually cleaning Bilibili watch history.

## Features

- Adds a small collapsed control button on `https://www.bilibili.com/history`.
- Scans history through Bilibili's cursor history API instead of relying on visible lazy-loaded cards.
- Deletes up to 50 or 100 matched records after a manual click.
- Deletes `archive` records when `progress === -1` or `progress / duration >= 0.8`.
- Deletes `live`, `article`, `article-list`, and `pgc` records directly.
- Runs delete requests serially with a short delay and shows failures in the panel.
- Does not call Bilibili's global clear-history API.

## Install

Install a userscript manager such as Tampermonkey, then install:

```text
src/bilibili-history-cleaner.user.js
```

After publishing, use the Greasy Fork install page or the raw GitHub `.user.js` URL.

## Usage

1. Open `https://www.bilibili.com/history`.
2. Click the `B站历史清理` button at the bottom-right corner.
3. Click `预览候选` to scan matched records without deleting.
4. Click `立即清理 50 条` or `立即清理 100 条` to delete matched records.
5. Refresh the history page after cleanup.

The number in the button is a maximum. If `立即清理 100 条` shows `已删除: 54/54`, the scan found only 54 matched candidates.

## Development

Run tests:

```bash
node --test test/bilibili-history-cleaner.test.js
```

Run syntax check:

```bash
node --check src/bilibili-history-cleaner.user.js
```

## License

MIT
