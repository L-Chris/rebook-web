# torto-webdav-proxy

一个极简的 WebDAV CORS 反向代理，跑在 Cloudflare Workers 上。torto-web 在浏览器中通过它访问坚果云、InfiniCLOUD、Koofr、STRATO HiDrive、Yandex Disk 的 WebDAV 接口（这些服务商不支持 CORS，浏览器无法直连）。

## 工作原理

```
浏览器  →  https://<worker>/<完整的上游 URL>  →  WebDAV 服务商
```

- 上游域名白名单（`src/index.js` 的 `ALLOWED_HOSTS`），防止被当开放代理滥用
- 请求/响应全程流式转发，不落地、不记录，大文件直接穿透
- 所有 WebDAV 方法与条件头（`PROPFIND`/`MKCOL`/`If-Match`/`If-None-Match` 等）原样转发
- 不跟随重定向（避免凭据泄露到其他源）

## 自部署

需要 [Node.js](https://nodejs.org) 和一个免费的 [Cloudflare](https://cloudflare.com) 账号：

```bash
npm i -g wrangler
wrangler login          # 浏览器授权一次
cd worker
wrangler deploy         # 输出你的 Worker 地址，如 https://torto-webdav-proxy.<账号>.workers.dev
```

然后在 torto-web 的 设置 → 云同步 里把「代理地址」填成你的 Worker 地址即可。

免费额度：10 万次请求/天，流量不限；请求体上限 100MB（超过 100MB 的书籍无法上传）。

## Deno Deploy 版（坚果云专用）

坚果云封锁了 Cloudflare 的 IP 段，所有 CF Worker 都无法连通。因此坚果云需要走 Deno Deploy（`proxy-deno/`，与 Worker 同一份逻辑）：

```bash
# 安装 Deno 后，在 https://app.deno.com 创建 access token
export DENO_DEPLOY_TOKEN=<token>
cd proxy-deno
deno deploy --prod --org <你的org> --app torto-webdav-proxy
```

免费额度：100 万次请求/月。部署后把 `https://<app>.<org>.deno.net` 填到 设置 → 云同步 的坚果云代理地址。

## 注意

Worker 会经手 WebDAV 应用密码（仅转发，不存储）。在意的话请自部署——代码不到 100 行，可自行审计。
