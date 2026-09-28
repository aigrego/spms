/* next build 之后把 public 与 .next/static 并入 standalone 产物——standalone
   server.js 只伺服自己目录内的静态资产（容器内启动时构建，没人再做这一步拷贝，
   所以挂进 build 脚本；幂等，重复执行覆盖）。 */
const { cpSync } = require('node:fs');

cpSync('public', '.next/standalone/public', { recursive: true });
cpSync('.next/static', '.next/standalone/.next/static', { recursive: true });
