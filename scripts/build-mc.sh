#!/usr/bin/env bash
# 构建 MinIO Client（mc）静态二进制 → .ci-assets/mc（Dockerfile 据此拷入镜像）。
# 官方已停发预编译二进制（dl.min.io 410 Gone，仅源码分发），用一次性 golang
# 容器从源码构建，宿主无需装 Go。CI（docker-deploy image job）自动调用；
# 本地 docker build 前需先手动跑一次。
#   MC_REF    mc 版本 git tag（默认钉 RELEASE.2025-07-21T05-28-08Z）
#   GO_IMAGE  构建镜像（默认 golang:1.25-alpine）
#   GOPROXY   Go 模块代理（默认 https://goproxy.cn,direct；可直连时改 https://proxy.golang.org,direct）
set -euo pipefail
cd "$(dirname "$0")/.."

MC_REF="${MC_REF:-RELEASE.2025-07-21T05-28-08Z}"
GO_IMAGE="${GO_IMAGE:-golang:1.25-alpine}"
GOPROXY="${GOPROXY:-https://goproxy.cn,direct}"

mkdir -p .ci-assets
docker run --rm -e GOPROXY="$GOPROXY" -e GOBIN=/out \
  -v "$PWD/.ci-assets:/out" "$GO_IMAGE" \
  go install "github.com/minio/mc@${MC_REF}"
echo "mc ${MC_REF} → .ci-assets/mc"
