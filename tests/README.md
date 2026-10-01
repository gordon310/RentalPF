# 测试

只读测试，不会创建或修改任何记录（导出脚本写入系统临时目录）。

## 运行

```bash
node tests/logic.test.mjs     # 逻辑：提交 URL、Markdown 往返、导出脚本、Worker
node tests/render.mjs         # 渲染：无头 Chrome 打开线上页面并校验 DOM
# 或
npm test                      # = logic
npm run test:all              # = logic + render
```

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `TEST_REPO` | `gordon310/RentalPF` | 测试的 GitHub 仓库 |
| `TEST_BASE` | `https://gordon310.github.io/RentalPF` | 渲染测试的页面地址 |
| `TEST_EXPECT_COUNT` | 空 | 断言记录条数（可选） |
| `CHROME` | 自动探测 | Chrome/Chromium 路径 |

## 覆盖范围

- **logic.test.mjs**
  1. `index.html`：53 题、单按钮、Markdown 精简、提交 URL 合法、回退 URL 长度
  2. `records.html`：Markdown↔解析往返、线上 Issue 可解析
  3. `export_issues.py`：能导出 CSV/Markdown 且表头正确
  4. `relay/worker.js`：正常提交/回查校验 verified/口令错误/缺字段/OPTIONS 预检/删除
- **render.mjs**
  - 填写页真实渲染（题号、按钮、遮罩默认隐藏）
  - 记录页真实拉取 GitHub API 后渲染（份数、无加载错误）
  - 感谢页显示「感谢上传」
