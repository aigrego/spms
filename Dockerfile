# Next.js（Node 单进程 SSR）—— runtime-node 单段模式：镜像只携带源码，
# 容器启动时 pnpm install --frozen-lockfile → pnpm build → exec node $APP_ENTRY
# （entrypoint 语义见镜像内 /usr/local/bin/runtime-entry.sh）。
# 运行参数经 docker run -e 注入、不落镜像层（部署接线见 .gitea/workflows/docker-deploy.yaml）：
#   APP_ENTRY=.next/standalone/server.js   PORT=5175   HOSTNAME=0.0.0.0
#   可选：NPM_REGISTRY / NPM_TOKEN_FILE（私有 npm 源）
# 注意：latest 每周一随上游滚动重建（上周能跑不代表下次能跑）；registry 现有
# 唯一版本 tag v0.3.1 缺 runtime-entry.sh 不可用，待 runtime-base 出新版本 tag 后锁死。
FROM livebook:8418/images/runtime-node:latest

# .dockerignore 已排除 node_modules / .next / data / .env（启动时重装重建）。
COPY . .

# MinIO Client（mc）：公司存储开通（admin user/policy）依赖 mc CLI，admin 操作
# 无 JS SDK（见 src/server/storage/mc.ts）。官方已停发预编译二进制
# （dl.min.io 410 Gone，仅源码分发），由 scripts/build-mc.sh 用一次性 golang
# 容器从源码构建（产物 .ci-assets/mc，gitignored，CI 自动执行，MC_REF 钉版本）。
# 缺该产物时镜像照常构建运行，仅「公司管理 → 开通存储」报"未安装 mc"。
RUN if [ -f .ci-assets/mc ]; then install -m 0755 .ci-assets/mc /usr/local/bin/mc; fi

EXPOSE 5175
