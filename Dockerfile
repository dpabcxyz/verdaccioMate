# 本地已构建好 frontend/dist，镜像内无需构建工具链
FROM --platform=linux/amd64 node:20-slim
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data \
    npm_config_registry=https://registry.npmmirror.com \
    # 原生模块预编译二进制走国内镜像（容器内访问 GitHub releases 会超时，导致 better-sqlite3 回退 gyp 编译失败）
    npm_config_better_sqlite3_binary_host=https://registry.npmmirror.com/-/binary/better-sqlite3 \
    npm_config_ignore_scripts=false

WORKDIR /app

# 后端依赖：仅 express + better-sqlite3（预编译二进制经国内镜像下载，无需编译工具链）
COPY backend/package.json ./
RUN npm install --production --legacy-peer-deps

COPY backend/ ./
# 前端产物（本地构建好的 dist）
COPY frontend/dist /frontend/dist

# 非 root 运行
RUN mkdir -p /app/data && chown -R 10000:10000 /app/data
USER 10000:10000

EXPOSE 3000
CMD ["node", "server.js"]
