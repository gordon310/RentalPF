// Cloudflare Worker：接收业务答卷并代表其创建 GitHub Issue。
// 需要环境变量（用 `wrangler secret put` 配置）：
//   GITHUB_TOKEN   具备本仓库 Issues: write 的细粒度 token
//   FORM_KEY       可选，与网页端 FORM_KEY 一致的简单口令
//   ADMIN_KEY      删除记录的管理员口令
// 普通变量（wrangler.toml [vars]）：
//   GITHUB_REPO    "gordon310/RentalPF"
//   ALLOWED_ORIGIN "https://gordon310.github.io"

function jsonResponse(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign({}, cors, { "Content-Type": "application/json; charset=utf-8" }),
  });
}

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-form-key, x-admin-key",
      "Vary": "Origin",
    };

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405, cors);

    let data;
    try {
      data = await request.json();
    } catch (e) {
      return jsonResponse({ error: "invalid json" }, 400, cors);
    }

    // 删除记录（需管理员口令）
    if (data && data.action === "delete") {
      if (!env.ADMIN_KEY || request.headers.get("x-admin-key") !== env.ADMIN_KEY) {
        return jsonResponse({ error: "unauthorized" }, 401, cors);
      }
      const number = parseInt(data.number, 10);
      if (!number) return jsonResponse({ error: "missing number" }, 400, cors);
      if (!env.GITHUB_REPO || !env.GITHUB_TOKEN) {
        return jsonResponse({ error: "server not configured" }, 500, cors);
      }
      // 注：REST DELETE /issues/{n} 在本类项目实测恒返回 404（即使管理员 token），
      //     故先取 node_id，再走 GraphQL deleteIssue（已验证可用）。
      const ghHeaders = {
        Authorization: "Bearer " + env.GITHUB_TOKEN,
        Accept: "application/vnd.github+json",
        "User-Agent": "rentalpf-relay",
      };
      const info = await fetch("https://api.github.com/repos/" + env.GITHUB_REPO + "/issues/" + number, { headers: ghHeaders });
      if (info.status === 404 || info.status === 410) {
        return jsonResponse({ ok: true, deleted: number, already: true }, 200, cors);
      }
      if (!info.ok) return jsonResponse({ error: "github_error", status: info.status }, 502, cors);
      const nodeId = (await info.json()).node_id;
      if (!nodeId) return jsonResponse({ error: "github_error", detail: "no node_id" }, 502, cors);

      const gql = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: Object.assign({}, ghHeaders, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          query: "mutation($id: ID!) { deleteIssue(input: { issueId: $id }) { clientMutationId } }",
          variables: { id: nodeId },
        }),
      });
      const gj = await gql.json().catch(() => ({}));
      if (gql.ok && gj && gj.data && gj.data.deleteIssue) {
        return jsonResponse({ ok: true, deleted: number }, 200, cors);
      }
      return jsonResponse({ error: "github_error", status: gql.status, detail: gj && gj.errors ? gj.errors : null }, 502, cors);
    }

    // 创建记录（可用 FORM_KEY 口令）
    if (env.FORM_KEY && request.headers.get("x-form-key") !== env.FORM_KEY) {
      return jsonResponse({ error: "unauthorized" }, 401, cors);
    }

    const title = String(data.title || "").slice(0, 200);
    const body = String(data.body || "");
    if (!title || !body) return jsonResponse({ error: "missing title or body" }, 400, cors);
    if (body.length > 100000) return jsonResponse({ error: "payload too large" }, 413, cors);

    const repo = env.GITHUB_REPO;
    if (!repo || !env.GITHUB_TOKEN) {
      return jsonResponse({ error: "server not configured" }, 500, cors);
    }

    const res = await fetch("https://api.github.com/repos/" + repo + "/issues", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.GITHUB_TOKEN,
        Accept: "application/vnd.github+json",
        "User-Agent": "rentalpf-relay",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: title, body: body, labels: ["business-feedback"] }),
    });

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      return jsonResponse({ error: "github_error", status: res.status, detail: detail }, 502, cors);
    }

    const issue = await res.json();

    // 回查确认记录确实已创建（最多 3 次，规避 GitHub API 短暂延迟）
    let verified = false;
    for (let i = 0; i < 3 && !verified; i++) {
      try {
        const chk = await fetch("https://api.github.com/repos/" + repo + "/issues/" + issue.number, {
          headers: {
            Authorization: "Bearer " + env.GITHUB_TOKEN,
            Accept: "application/vnd.github+json",
            "User-Agent": "rentalpf-relay",
          },
        });
        verified = chk.ok;
      } catch (e) {
        verified = false;
      }
      if (!verified) await new Promise((r) => setTimeout(r, 800));
    }

    return jsonResponse({ ok: true, verified: verified, number: issue.number, url: issue.html_url }, 200, cors);
  },
};
