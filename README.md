# 办公设备租赁平台（RentalPF）· 业务需求收集

用于收集内部业务 / 运营团队对「办公设备租赁平台」的需求确认，并把结论沉淀为开发文档。

- 在线填写表单：`index.html`（也可直接打开本地文件）
- GitHub 在线提交：仓库 `Issues` → 选择「业务需求确认表 V1.0」
- 每条提交 = 一个 GitHub Issue（label `business-feedback`），永久留档、可导出
- 开发需求文档（V0.2 已回填最终决议）：`docs/办公设备租赁平台开发需求文档_V0.2.md`

> 业务逻辑对标哈啰租车（取还 → 选品 → 选期 → 计价 → 免押 → 下单支付 → 交付验机 → 使用 → 归还结算），品类扩展为办公自动化设备。

## 目录

```
RentalPF/
├── README.md
├── index.html                        填写页（单按钮提交）
├── thanks.html                       提交成功后显示「感谢上传」
├── records.html                      答卷记录页（完成情况 / 明细 / CSV）
├── questionnaire.md                  问卷唯一维护源
├── package.json                      测试脚本
├── .github/ISSUE_TEMPLATE/
│   ├── business-requirements.yml     GitHub Issue 表单（53 题结构化）
│   └── config.yml                    新增 issue 引导
├── docs/
│   └── 办公设备租赁平台开发需求文档_V0.2.md
├── relay/                            Cloudflare Worker 中转（可选，实现「提交→谢谢」）
│   ├── worker.js
│   ├── wrangler.toml
│   └── README.md
├── scripts/
│   └── export_issues.py              导出全部答卷为 CSV / Markdown 汇总
└── tests/
    ├── logic.test.mjs                逻辑测试（只读）
    └── render.mjs                    无头 Chrome 渲染测试
```

## 仓库信息

- 仓库：https://github.com/gordon310/RentalPF
- **填写页（单按钮提交）**：https://gordon310.github.io/RentalPF/
- **答卷记录页（内部查看完成情况）**：https://gordon310.github.io/RentalPF/records.html
- 提交入口（Issue 表单，备用）：https://github.com/gordon310/RentalPF/issues/new/choose
- 建议在仓库 `Settings → Labels` 保持 `business-feedback` 标签存在，便于筛选导出。

> 记录页会展示每位同事的提交次数、最近提交时间与状态，并支持按姓名过滤、导出 CSV。

### 提交方式

- **当前**：填写页点「提交」→ 打开 GitHub 新 Issue 页（预填标题/正文/标签），登录 GitHub 点一次 Submit。
- **可选（推荐）**：部署 `relay/` 的 Cloudflare Worker 后，把 `index.html`、`records.html` 的 `RELAY_URL` 填上，即变为「提交 → 感谢上传」，同事全程不接触 GitHub。详见 `relay/README.md`。

## 如何填写

1. 打开 `https://gordon310.github.io/RentalPF/`（共 53 题，单按钮提交）。
2. 填写姓名、部门与日期，逐项作答，第 53 题可补充。
3. 点「提交」完成，可直接关闭浏览器。
4. 提交后请勿删除，作为需求留档。

> GitHub Issue 表单（`issues/new/choose`）无法强制"最多选 N 项"，第 48 / 49 题请在题干提示下自行控制；HTML 版会强制限制。

### 身份与多次提交

- **姓名必填**：每份答卷第一项要求填写「填写人姓名」，用于识别是谁提交。
- **可多次提交**：同一人可提交多份（如修订版），每份都是独立 Issue，全部留档。
- **建议**：提交时在 Issue 标题带上姓名（HTML 版已自动填充为 `[业务答卷] 姓名 / 日期`）。
- **取最新为准**：同名多次提交时，以导出表中 `创建时间` 最新的一条为准。

## 维护与回填

- 修改问卷：先改 `questionnaire.md`，再同步 `index.html` 的 `SECTIONS`、`records.html` 的 `QLABELS` 与 `business-requirements.yml`。
- 收到答卷后：在 `docs/办公设备租赁平台开发需求文档_V0.2.md` 中把对应 `【待确认】` 回填，并标注来源与日期。

## 测试

只读测试，不会创建或修改任何记录。

```bash
npm test          # 逻辑（提交 URL / Markdown 往返 / 导出 / Worker）
npm run test:all  # 逻辑 + 无头浏览器渲染
```

详见 `tests/README.md`。

## 导出留档

```bash
# 需要已登录的 gh CLI
python3 scripts/export_issues.py --repo gordon310/RentalPF --out ./exports
```

输出：

- `exports/business-feedback.csv`：每行一位同事，列出题号答案
- `exports/business-feedback.md`：按填写人汇总的完整答卷
