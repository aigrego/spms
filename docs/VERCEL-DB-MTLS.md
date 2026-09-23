# Vercel 经阿里云中转访问 NAS 数据库（mTLS 无域名方案）

链路：`Vercel → 阿里云（OpenResty stream 四层转发）→ Tailscale → 本地 NAS 上的 PostgreSQL/MySQL`

由于 Vercel serverless 出口 IP 不固定（静态 IP 为 Enterprise 功能），无法用 IP 白名单限制来源；改用 **mTLS 双向证书认证** 达到等价效果：无合法客户端证书的连接在 TLS 握手阶段即被拒绝，到不了数据库认证层。本方案不依赖域名，信任锚为自签 CA，服务端证书直接签给阿里云公网 IP。

## 前置条件

- NAS 与阿里云主机均加入同一 Tailscale tailnet，NAS 获得 `100.x.y.z` 地址。
- 阿里云上 OpenResty（1Panel 自带）使用 `stream {}` 顶层块（非界面上的 HTTP 反向代理），容器需额外映射对外端口；阿里云安全组与 1Panel 防火墙放行对应端口。
- 对外端口使用非标端口（如 PG `15432`、MySQL `13306`），仅减少扫描噪音，不替代认证措施。

## 步骤 1：自签 CA

```bash
openssl genrsa -out ca.key 4096
openssl req -x509 -new -nodes -key ca.key -sha256 -days 3650 \
  -out ca.crt -subj "/CN=my-db-ca"
```

`ca.key` 签完即离线保存；泄露则整套体系作废。

## 步骤 2：签服务端证书（SAN 必须是 `IP:`）

```bash
openssl genrsa -out server.key 2048
openssl req -new -key server.key -out server.csr -subj "/CN=<阿里云公网IP>"
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server.crt -days 825 -sha256 \
  -extfile <(echo "subjectAltName=IP:<阿里云公网IP>")
```

Node TLS 连接 IP 地址时校验证书中的 `IP:x.x.x.x` SAN 条目；写成 `DNS:` 会校验失败。

## 步骤 3：签客户端证书（供 Vercel 使用）

```bash
openssl genrsa -out client.key 2048
openssl req -new -key client.key -out client.csr -subj "/CN=vercel-app"
openssl x509 -req -in client.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out client.crt -days 825 -sha256
```

## 步骤 4：nginx stream 配置

`server.crt` / `server.key` / `ca.crt` 放入容器可访问路径（如 `/etc/nginx/certs/`）：

```nginx
stream {
    server {
        listen 15432 ssl;
        ssl_certificate         /etc/nginx/certs/server.crt;
        ssl_certificate_key     /etc/nginx/certs/server.key;
        ssl_client_certificate  /etc/nginx/certs/ca.crt;
        ssl_verify_client       on;
        proxy_pass 100.x.y.z:5432;    # NAS 的 Tailscale IP
    }
    server {
        listen 13306 ssl;
        ssl_certificate         /etc/nginx/certs/server.crt;
        ssl_certificate_key     /etc/nginx/certs/server.key;
        ssl_client_certificate  /etc/nginx/certs/ca.crt;
        ssl_verify_client       on;
        proxy_pass 100.x.y.z:3306;
    }
}
```

注意：`stream {}` 与 `http {}` 平级，须写在主 `nginx.conf`（1Panel 路径 `/opt/1panel/apps/openresty/openresty/conf/nginx.conf`），不能放进 `conf.d`；1Panel 升级 OpenResty 应用可能覆盖主配置与 compose 端口映射，注意备份。

TLS 在 nginx 终结，nginx → NAS 段由 Tailscale（WireGuard）加密，因此数据库服务端无需再开 SSL，pg_hba 对 tailnet 网段配普通 `host` 即可。

## 步骤 5：Vercel 侧连接配置

将 `ca.crt`、`client.crt`、`client.key` 内容写入 Vercel 环境变量（dashboard 可直接粘贴多行 PEM），代码中：

```ts
// drizzle + node-postgres
new Pool({
  host: "<阿里云公网IP>",
  port: 15432,
  ssl: {
    ca: process.env.DB_CA_CERT,
    cert: process.env.DB_CLIENT_CERT,
    key: process.env.DB_CLIENT_KEY,
    rejectUnauthorized: true,
  },
});

// mysql2 同理：ssl: { ca, cert, key, rejectUnauthorized: true }
```

## 运维要点

- 证书有效期 825 天（CA 3650 天）；到期前用同一 CA 重签 server/client 证书并替换文件，无需改动客户端信任配置。
- 兜底措施保留：数据库强密码、fail2ban、阿里云安全组仅放必需端口。
- 建议在阿里云侧为 PG 加 PgBouncer，避免 Vercel serverless 并发打满 `max_connections`。
- 若日后改为「应用部署在阿里云、走 tailnet 直连 NAS」方案，回收全部对外端口与证书。
