#!/usr/bin/env python3
"""导出 GitHub 上业务需求答卷（Issues）为 CSV 与 Markdown 汇总。

用法：
    python3 scripts/export_issues.py --repo gordon310/RentalPF \
        --label business-feedback --out ./exports

依赖：已安装并登录的 GitHub CLI (gh)。
"""

import argparse
import csv
import json
import os
import re
import subprocess
import sys

# 题号 -> 简短列名（导出 CSV 用）
COLS = [
    ("submitter_name", "填写人"),
    ("dept", "部门"),
    ("fill_date", "填写日期"),
    ("q1", "1_经营形态"),
    ("q2", "2_用户重心"),
    ("q3", "3_收入来源"),
    ("q4", "4_以租代购"),
    ("q5", "5_设备品类"),
    ("q6", "6_唯一资产"),
    ("q7", "7_商品属性"),
    ("q8", "8_状态档期"),
    ("q9", "9_计费周期"),
    ("q10", "10_计价模式"),
    ("q11", "11_起租门槛"),
    ("q12", "12_续退换机"),
    ("q13", "13_运费安装"),
    ("q14", "14_交付方式"),
    ("q15", "15_耗材"),
    ("q16", "16_备用机"),
    ("q17", "17_多仓调拨"),
    ("q18", "18_注册认证"),
    ("q19", "19_账户体系"),
    ("q20", "20_合同签署"),
    ("q21", "21_会员信用"),
    ("q22", "22_下单流程"),
    ("q23", "23_B端询价"),
    ("q24", "24_电子签名"),
    ("q25", "25_企业审批"),
    ("q26", "26_支付方式"),
    ("q27", "27_押金方式"),
    ("q28", "28_押金退还"),
    ("q29", "29_支付节奏"),
    ("q30", "30_发票"),
    ("q31", "31_赔付扣款"),
    ("q32", "32_质检流程"),
    ("q33", "33_定损赔付"),
    ("q34", "34_逾期处理"),
    ("q35", "35_信用征信"),
    ("q36", "36_入驻审核"),
    ("q37", "37_商家后台"),
    ("q38", "38_分账结算"),
    ("q39", "39_后台模块"),
    ("q40", "40_营销工具"),
    ("q41", "41_客服售后"),
    ("q42", "42_角色权限"),
    ("q43", "43_终端形态"),
    ("q44", "44_通知方式"),
    ("q45", "45_报表指标"),
    ("q46", "46_合规"),
    ("q47", "47_外部对接"),
    ("q48", "48_重点功能"),
    ("q49", "49_优先解决"),
    ("q50", "50_上线时间"),
    ("q51", "51_现有资源"),
    ("q52", "52_参与测试"),
    ("q53", "53_补充"),
]


def run(cmd):
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        sys.stderr.write(result.stderr)
        raise SystemExit("命令失败: " + " ".join(cmd))
    return result.stdout


def fetch_issues(repo, label):
    out = run([
        "gh", "issue", "list",
        "--repo", repo,
        "--label", label,
        "--state", "all",
        "--limit", "1000",
        "--json", "number,title,body,author,createdAt,url,state",
    ])
    return json.loads(out)


def parse_body(body):
    """把 Issue 正文解析为 {id: value}。兼容精简式、标题式与 HTML 表单生成的 Markdown。"""
    answers = {}
    current = None
    for raw in (body or "").splitlines():
        line = raw.rstrip()
        if not line:
            continue
        m4 = re.match(
            r"^[-*]\s*(填写人姓名|所属部门\s*/\s*岗位|填写日期)[：:]\s*(.+)$", line)
        if m4:
            key = {
                "填写人姓名": "submitter_name",
                "所属部门 / 岗位": "dept",
                "填写日期": "fill_date",
            }[m4.group(1)]
            answers[key] = m4.group(2).strip()
            continue
        mh = re.match(r"^(?:\*\*|#{2,3}\s*)(\d+)\.\s", line)
        if mh:
            current = "q" + mh.group(1)
            answers.setdefault(current, [])
            continue
        if not re.match(r"^[-*#>]", line):
            mq = re.match(r"^(\d+)\.\s+(.+)$", line)
            if mq:
                answers["q" + mq.group(1)] = mq.group(2).strip()
                continue
        if current:
            m2 = re.match(r"^\s*[-*]\s*\[(x| )\]\s*(.+)$", line)
            if m2:
                if m2.group(1).lower() == "x":
                    answers[current].append(m2.group(2).strip())
                continue
            m3 = re.match(r"^\s*[-*]\s*(.+)$", line)
            if m3:
                answers[current].append(m3.group(1).strip())
                continue
            if not re.match(r"^(#|>|---|\*\*)", line):
                answers[current].append(line.strip())
                continue
    for k, v in list(answers.items()):
        if isinstance(v, list):
            answers[k] = "；".join(v)
    return answers


def write_csv(issues, outdir):
    path = os.path.join(outdir, "business-feedback.csv")
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(["issue", "url", "提交人", "创建时间", "状态"] + [c[1] for c in COLS])
        for it in issues:
            a = parse_body(it.get("body", ""))
            writer.writerow([
                it["number"], it["url"],
                (it.get("author") or {}).get("login", ""),
                it.get("createdAt", ""), it.get("state", ""),
            ] + [a.get(cid, "") for cid, _ in COLS])
    return path


def write_md(issues, outdir):
    path = os.path.join(outdir, "business-feedback.md")
    lines = ["# 业务需求答卷汇总", ""]
    for it in issues:
        a = parse_body(it.get("body", ""))
        lines.append("## #{n} {title}".format(n=it["number"], title=it.get("title", "").strip()))
        lines.append("")
        lines.append("- 提交人：{}".format((it.get("author") or {}).get("login", "")))
        lines.append("- 时间：{}".format(it.get("createdAt", "")))
        lines.append("- 链接：{}".format(it.get("url", "")))
        lines.append("")
        for cid, name in COLS:
            if a.get(cid):
                lines.append("- **{}**：{}".format(name, a[cid]))
        lines.append("")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True, help="OWNER/RentalPF")
    ap.add_argument("--label", default="business-feedback")
    ap.add_argument("--out", default="./exports")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    issues = fetch_issues(args.repo, args.label)
    csv_path = write_csv(issues, args.out)
    md_path = write_md(issues, args.out)
    print("已导出 {} 份答卷：\n- {}\n- {}".format(len(issues), csv_path, md_path))


if __name__ == "__main__":
    main()
