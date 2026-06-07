# Home Admin Commands

Status: active
Scope: backend scripts
Truth source: `package.json`
Stale if: package scripts or package manager changes

## 执行原则

- 所有命令在 `home-admin/` 执行。
- 使用 `pnpm`。
- 先判断命令是否写文件、启动环境或影响数据库。
- 数据库迁移和测试环境脚本必须明确目标环境。

## 低副作用命令

- `pnpm start:dev`：开发 watch 模式。
- `pnpm build`：执行 `nest build`，写 `dist/`。
- `pnpm lint`：ESLint 检查，不自动修复。
- `pnpm test`：Jest 单测。
- `pnpm test:cov`：覆盖率。
- `pnpm test:e2e`：E2E，`NODE_ENV=test`，runInBand。

## 会写文件或影响环境的命令

- `pnpm format`：Prettier 写入 `src/**/*.ts` 与 `test/**/*.ts`。
- `pnpm lint:fix`：ESLint 自动修复。
- `pnpm test:env:up` / `pnpm test:env:down` / `pnpm test:env:clean`：启动、关闭或清理测试环境。
- `pnpm migration:generate`：生成迁移文件。
- `pnpm migration:run`、`pnpm migration:run:ts`、`pnpm migration:revert`：影响数据库。

## 迁移命令前提

运行迁移前必须确认：

1. `NODE_ENV` 和 env 文件加载符合目标。
2. 数据库连接指向预期环境。
3. migration diff 已人工审查。
4. 有回滚说明。

## 何时运行

- 文档-only：`rg` + `git diff --check`。
- 普通后端逻辑：相关 `*.spec.ts`。
- RBAC/API key/open-api/file/task/notification：相关单测 + 必要 E2E。
- 共享 core/common/config：`pnpm test` + `pnpm build`。
