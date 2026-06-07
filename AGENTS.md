# Repository Guidelines

本文件只写进入 `home-admin/` 后需要立即遵守的规则。根目录 `../AGENTS.md` 仍然生效；详细规则看本仓 `docs/agent-harness/`。

## 边界

- `home-admin/` 是独立 Git 仓库；不要在根目录或其他子项目执行后端命令。
- 使用 `pnpm`，以 `package.json` scripts 为准。
- 不执行 `git add`、`git commit`，除非用户明确要求。
- 不提交 `.env*`、数据库凭据、Bark/Feishu/OSS 凭据、API key 或本地数据。
- 不恢复、不删除用户已有未提交变更。
- 本项目是个人后台和单实例优先项目；不要把企业级多实例、强审计、分布式治理默认当必修项。

## 开发规则

- 后端是 NestJS 单体应用，路径别名 `~/*` 指向 `src/*`。
- 新能力优先落在已有 `src/modules/{domain}/`，不要新建平行抽象。
- Controller 只协调 HTTP、DTO、装饰器和 service 调用；业务行为放 service。
- 非公开接口默认必须显式声明权限，使用 `@Public()`、`@AllowAuthenticated()` 或权限装饰器时先查相邻实现。
- API key、open-api、auth、RBAC、文件、通知、迁移、task/family/insurance 都属于高风险区，先读 `docs/agent-harness/risk-zones.md`。
- 修改 entity 必须考虑 migration；不要启用自动 schema sync。
- 个人项目可以接受低优先级工程化债务，但不能放过数据丢失、权限绕过、API 契约破坏和启动失败。

## 命令

- 开发：`pnpm start:dev`
- 构建：`pnpm build`
- Lint：`pnpm lint`
- 自动修复：`pnpm lint:fix`
- 单测：`pnpm test`
- E2E：`pnpm test:e2e`
- 测试环境：`pnpm test:env:up` / `pnpm test:env:down`
- 迁移：`pnpm migration:generate`、`pnpm migration:run:ts`

## 验证

- 文档-only：检查残留引用和 `git diff --check`。
- 普通 controller/service：跑相关 `*.spec.ts`，必要时 `pnpm test`。
- 权限、API key、open-api、迁移、文件、通知、任务提醒：扩大到相关 E2E 或全量单测。
- 无法验证时，最终回复必须说明缺失条件和剩余风险。

## 详细索引

- 总入口：`docs/agent-harness/index.md`
- 仓库地图：`docs/agent-harness/repo-map.md`
- 命令说明：`docs/agent-harness/commands.md`
- 验证矩阵：`docs/agent-harness/sensors.md`
- 开发规则：`docs/agent-harness/backend.md`
- 高风险区：`docs/agent-harness/risk-zones.md`
- 文档新鲜度：`docs/agent-harness/doc-freshness.md`
- agent 工作协议：`docs/agent-harness/task-protocol.md`
