# B站历史清理

[English](README.en.md)

一个用于手动批量清理 B 站历史记录的 Tampermonkey 用户脚本。

## 功能

- 在 `https://www.bilibili.com/history` 页面右下角添加一个默认折叠的小按钮。
- 通过 B 站历史记录 cursor API 后台扫描，不依赖页面前台已经懒加载出来的卡片。
- 手动点击后最多删除 50 条或 100 条命中候选。
- 普通视频 `archive`：当 `progress === -1`，或观看进度 `progress / duration >= 0.8` 时删除。
- 直播、专栏、文集、PGC：进入候选后直接删除。
- 删除请求串行执行，中间有短间隔，并在面板中显示失败项。
- 不调用 B 站全量清空历史接口。

## 安装

先安装 Tampermonkey 等用户脚本管理器，然后从以下任一地址安装：

- Greasy Fork 页面
- GitHub raw `.user.js` 地址
- 本仓库的 `src/bilibili-history-cleaner.user.js`

## 使用

1. 打开 `https://www.bilibili.com/history`。
2. 点击右下角 `B站历史清理` 小按钮展开面板。
3. 点击 `预览候选`，只扫描候选，不删除。
4. 点击 `立即清理 50 条` 或 `立即清理 100 条` 执行删除。
5. 清理完成后刷新历史页。

按钮上的数量是“最多删除数量”。例如点击 `立即清理 100 条` 后显示 `已删除: 54/54`，表示本次只扫描到 54 条命中候选，并成功删除 54 条。

## 清理规则

| 类型 | 规则 |
| --- | --- |
| `archive` | `progress === -1` 或 `progress / duration >= 0.8` |
| `live` | 直接删除 |
| `article` | 直接删除 |
| `article-list` | 直接删除 |
| `pgc` | 直接删除 |
| 未知类型 | 跳过 |

## 开发

运行测试：

```bash
node --test test/bilibili-history-cleaner.test.js
```

语法检查：

```bash
node --check src/bilibili-history-cleaner.user.js
```

## 许可证

MIT
