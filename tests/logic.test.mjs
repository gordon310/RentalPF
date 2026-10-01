// 逻辑测试（只读，不会创建/修改任何记录）
// 运行：node tests/logic.test.mjs
// 可配置：TEST_REPO=gordon310/RentalPF
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = process.env.TEST_REPO || "gordon310/RentalPF";
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS " + m)) : (fail++, console.log("  FAIL " + m)); };

// ---------- 1) index.html 逻辑 ----------
console.log("[1] index.html 提交逻辑");
const idx = read("index.html");
const s1 = idx.slice(idx.indexOf("const GITHUB_REPO"), idx.indexOf("function setStatus"));
const api = new Function(s1 + "\nreturn { SECTIONS, toMarkdown, issueUrl, GITHUB_REPO, RELAY_URL, FORM_KEY };")();
const qids = api.SECTIONS.flatMap(s => s.questions).filter(q => q.id.startsWith("q"));
ok(qids.length === 53, "题目 53 个 (实际 " + qids.length + ")");
ok(api.GITHUB_REPO === REPO, "GITHUB_REPO = " + api.GITHUB_REPO);
ok(typeof api.RELAY_URL === "string", "RELAY_URL 存在 (值=\"" + api.RELAY_URL + "\")");

const sample = { submitter_name: "测试用户", dept: "运营部", fill_date: "2026-10-01",
  q1: "混合（自营 + 商家入驻）", q3: ["租金差价", "平台佣金"], q5: ["打印机", "投影仪"], q53: "补一句" };
const md = api.toMarkdown(sample);
ok(md.includes("- 填写人姓名：测试用户"), "Markdown 含填写人姓名");
ok(md.includes("- 所属部门 / 岗位：运营部"), "Markdown 含部门");
ok(md.includes("- 填写日期：2026-10-01"), "Markdown 含填写日期");
ok(!md.includes("医生"), "Markdown 无医生字段");
ok(md.includes("3. 租金差价；平台佣金"), "多选只列已选(精简式)");
ok(!md.includes("- [ ]") && !md.includes("- [x]"), "多选未输出全部选项");
ok(!md.includes("（未选择）") && !md.includes("（未回答）"), "跳过未作答");

const url = api.issueUrl(sample);
ok(url.startsWith("https://github.com/" + REPO + "/issues/new?title="), "提交 URL 前缀正确");
ok(decodeURIComponent(url).includes("labels=business-feedback"), "URL 含 label");

const full = { submitter_name: "测试用户", fill_date: "2026-10-01" };
for (const s of api.SECTIONS) for (const q of s.questions) {
  if (!q.id.startsWith("q")) continue;
  if (q.type === "multi") full[q.id] = q.options.slice(0, 3);
  else if (q.type === "single") full[q.id] = q.options[0];
  else full[q.id] = "补充说明";
}
const fullUrl = api.issueUrl(full);
console.log("    典型全量 URL 长度 = " + fullUrl.length);
ok(fullUrl.length < 7500, "典型全量 URL 长度 " + fullUrl.length + " < 7500 (回退阈值)");

// ---------- 2) records.html 解析（往返 + 线上真实数据） ----------
console.log("[2] records.html 解析");
const rec = read("records.html");
const s2 = rec.slice(rec.indexOf("function esc("), rec.indexOf("async function load"));
const parseBody = new Function(s2 + "\nreturn parseBody;")();
const parsed = parseBody(md);
ok(parsed.info.submitter_name === "测试用户", "往返：解析出填写人姓名");
ok(parsed.info.dept === "运营部", "往返：解析出部门");
ok(parsed.info.fill_date === "2026-10-01", "往返：解析出填写日期");
ok(Array.isArray(parsed.answers.q3) && parsed.answers.q3.join("") === "租金差价平台佣金", "往返：q3");
ok(parsed.answers.q1 === "混合（自营 + 商家入驻）", "往返：q1 单选");
ok(parsed.answers.q53 === "补一句", "往返：q53 文本");

try {
  const issues = await (await fetch("https://api.github.com/repos/" + REPO + "/issues?state=all&per_page=100")).json();
  const real = Array.isArray(issues) ? issues.filter(i => !i.pull_request) : [];
  ok(Array.isArray(issues) || issues.message, "线上 Issue 列表可读取 (" + real.length + " 条 / " + (issues.message || "ok") + ")");
  const withName = real.filter(i => parseBody(i.body).info.submitter_name);
  ok(withName.length === real.length || real.length === 0,
     "所有记录都能解析出填写人姓名 (" + withName.length + "/" + real.length + ")");
  if (process.env.TEST_EXPECT_COUNT) ok(real.length === Number(process.env.TEST_EXPECT_COUNT),
     "记录数 = " + process.env.TEST_EXPECT_COUNT);
} catch (e) { ok(false, "读取线上 Issue 失败: " + e.message); }

// ---------- 3) 导出脚本 ----------
console.log("[3] export_issues.py");
const outdir = path.join(os.tmpdir(), "rentalpf-test-exports");
try {
  const out = execFileSync("python3", ["scripts/export_issues.py", "--repo", REPO, "--out", outdir], { cwd: ROOT }).toString();
  ok(/已导出 \d+ 份答卷/.test(out), "导出脚本执行: " + out.trim());
  const csvPath = path.join(outdir, "business-feedback.csv");
  const csv = fs.readFileSync(csvPath, "utf8").split("\n");
  ok(csv[0].includes("填写人") && csv[0].includes("填写日期"), "CSV 表头含填写人/日期");
  ok(!csv[0].includes("医生"), "CSV 无医生列");
  ok(fs.existsSync(path.join(outdir, "business-feedback.md")), "生成 Markdown 汇总");
} catch (e) { ok(false, "导出脚本异常: " + e.message); }

// ---------- 4) Worker 逻辑 ----------
console.log("[4] relay/worker.js");
const mod = await import("file://" + path.join(ROOT, "relay/worker.js"));
const worker = mod.default;
const env = { GITHUB_REPO: REPO, GITHUB_TOKEN: "test", FORM_KEY: "k", ALLOWED_ORIGIN: "https://gordon310.github.io" };
const mk = (body, headers = {}) => new Request("https://relay/", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
let captured = null, calls = [];
globalThis.fetch = async (u, o) => {
  calls.push(u);
  if (/\/issues\/\d+$/.test(u)) return new Response(JSON.stringify({ number: 99 }), { status: 200 });
  captured = { u, o };
  return new Response(JSON.stringify({ number: 99, html_url: "x" }), { status: 201 });
};
let r = await worker.fetch(mk({ title: "t", body: "b" }, { "x-form-key": "k" }), env);
let j = await r.json();
ok(r.status === 200 && j.ok === true && j.number === 99, "正常提交返回 ok");
ok(j.verified === true, "创建后回查校验 verified=true");
ok(calls.some(u => /\/issues\/99$/.test(u)), "确实发起了回查请求");
ok(captured.u === "https://api.github.com/repos/" + REPO + "/issues", "调用 GitHub issues API");
ok(captured.o.headers.Authorization === "Bearer test", "带 token");
ok(JSON.parse(captured.o.body).labels[0] === "business-feedback", "打标签");

// 回查失败 → verified=false
globalThis.fetch = async (u) => /\/issues\/\d+$/.test(u)
  ? new Response("nope", { status: 404 })
  : new Response(JSON.stringify({ number: 5, html_url: "x" }), { status: 201 });
r = await worker.fetch(mk({ title: "t", body: "b" }, { "x-form-key": "k" }), env);
j = await r.json();
ok(j.verified === false, "回查失败 verified=false");

globalThis.fetch = async () => new Response(JSON.stringify({ number: 99, html_url: "x" }), { status: 201 });
r = await worker.fetch(mk({ title: "t", body: "b" }, { "x-form-key": "bad" }), env);
ok(r.status === 401, "错误口令被拒 401");
r = await worker.fetch(mk({ title: "", body: "" }, { "x-form-key": "k" }), env);
ok(r.status === 400, "缺字段返回 400");
r = await worker.fetch(new Request("https://relay/", { method: "OPTIONS" }), env);
ok(r.status === 204, "OPTIONS 预检 204");

// 删除（REST DELETE 实测 404，改走 GraphQL deleteIssue）
const envAdmin = { ...env, ADMIN_KEY: "admin" };
let delCalls = [];
globalThis.fetch = async (u, o) => {
  delCalls.push({ u, o });
  if (/\/issues\/7$/.test(u)) return new Response(JSON.stringify({ node_id: "I_abc" }), { status: 200 });
  if (u === "https://api.github.com/graphql") {
    return new Response(JSON.stringify({ data: { deleteIssue: { clientMutationId: null } } }), { status: 200 });
  }
  return new Response("{}", { status: 200 });
};
r = await worker.fetch(mk({ action: "delete", number: 7 }, { "x-admin-key": "bad" }), envAdmin);
ok(r.status === 401, "删除：口令错误 401");
r = await worker.fetch(mk({ action: "delete", number: 7 }, { "x-admin-key": "admin" }), envAdmin);
j = await r.json();
ok(r.status === 200 && j.ok === true && j.deleted === 7, "删除：成功 ok");
ok(delCalls.some(c => /\/issues\/7$/.test(c.u)), "删除：先取 node_id");
const gqlCall = delCalls.find(c => c.u === "https://api.github.com/graphql");
ok(!!gqlCall && gqlCall.o.method === "POST" && /deleteIssue/.test(gqlCall.o.body) && /I_abc/.test(gqlCall.o.body), "删除：GraphQL deleteIssue(node_id)");

globalThis.fetch = async () => new Response(JSON.stringify({ message: "deleted" }), { status: 410 });
r = await worker.fetch(mk({ action: "delete", number: 7 }, { "x-admin-key": "admin" }), envAdmin);
j = await r.json();
ok(r.status === 200 && j.already === true, "删除：已删除幂等 200");

r = await worker.fetch(mk({ action: "delete" }, { "x-admin-key": "admin" }), envAdmin);
ok(r.status === 400, "删除：缺 number 400");
r = await worker.fetch(mk({ action: "delete", number: 7 }, { "x-admin-key": "admin" }), env);
ok(r.status === 401, "删除：未配置 ADMIN_KEY 拒绝");

console.log("\n结果: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
