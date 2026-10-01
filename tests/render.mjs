// 渲染测试：用无头 Chrome 打开线上页面并执行 JS，校验最终 DOM。
// 运行：node tests/render.mjs
// 可用 CHROME 指定浏览器路径；找不到 Chrome 时自动跳过（退出码 0）。
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";

const BASE = process.env.TEST_BASE || "https://gordon310.github.io/RentalPF";
const CHROME = process.env.CHROME || [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find(p => fs.existsSync(p));

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS " + m)) : (fail++, console.log("  FAIL " + m)); };

if (!CHROME) {
  console.log("未找到 Chrome，跳过渲染测试（设置 CHROME 环境变量可指定路径）。");
  process.exit(0);
}

function dump(url, tag) {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rentalpf-render-" + tag + "-"));
    const args = ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
      "--no-default-browser-check", "--user-data-dir=" + dir,
      "--virtual-time-budget=15000", "--dump-dom", url];
    const p = spawn(CHROME, args);
    let out = "";
    p.stdout.on("data", d => (out += d));
    const t = setTimeout(() => p.kill("SIGKILL"), 60000);
    p.on("close", () => { clearTimeout(t); fs.rmSync(dir, { recursive: true, force: true }); resolve(out); });
    p.on("error", reject);
  });
}

console.log("[填] " + BASE + "/");
const index = await dump(BASE + "/", "index");
const qids = new Set([...index.matchAll(/data-qid="(q\d+)"/g)].map(m => m[1]));
ok(qids.size === 53, "渲染出 53 个题号 (实际 " + qids.size + ")");
const btns = [...index.matchAll(/id="(btn-[a-z]+)"/g)].map(m => m[1]);
ok(btns.includes("btn-submit") && !btns.some(b => b !== "btn-submit" && b !== "btn-done"),
   "只有提交按钮: " + [...new Set(btns)].join(", "));
ok(index.includes('id="done" class="done" style="display:none"'), "谢谢遮罩默认隐藏");
ok(!/（未选择）|（未回答）/.test(index), "页面无残留占位");

console.log("[记录] " + BASE + "/records.html");
const records = await dump(BASE + "/records.html", "records");
const total = (records.match(/<b id="s-total">[^<]*<\/b>/) || [""])[0];
const n = Number((total.match(/>(\d+)</) || [])[1]);
ok(Number.isFinite(n), "提交份数已渲染: " + n);
ok(!/<p id="status"[^>]*>加载失败/.test(records), "无加载失败");
ok((records.match(/class="card"/g) || []).length >= 1 || n === 0, "明细卡片或空状态正常");
ok(n === 0 || /data-del="\d+"/.test(records), "每条记录含删除按钮");

console.log("[感谢] " + BASE + "/thanks.html");
const thanks = await dump(BASE + "/thanks.html", "thanks");
ok(thanks.includes("感谢上传"), "感谢页显示「感谢上传」");

console.log("\n结果: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
