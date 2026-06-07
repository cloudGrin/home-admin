# Home Admin Sensors

Status: active
Scope: backend verification
Truth source: Jest config, package scripts, existing tests
Stale if: test runner, lint behavior, or migration flow changes

## Sensor 规则

没有新鲜 sensor 结果，不要声称完成。无法运行 sensor 时，说明缺失条件和剩余风险。

## 默认矩阵

| 改动类型 | 最低 sensor |
| --- | --- |
| 文档-only | `rg` 核对路径和残留引用；`git diff --check` |
| 普通 controller/service | 相关 `*.spec.ts` |
| core/common/shared/config | `pnpm test` + `pnpm build` |
| DTO/参数转换 | DTO spec 覆盖空值、分页、布尔、数组 |
| Auth/RBAC | auth/user/role/permission/menu 单测或 E2E |
| API key/open-api | api-auth/open-api 单测 + E2E |
| Entity/Migration | migration spec + entity/migration diff 审查 |
| File/OSS | file controller/service/storage 测试 |
| Notification/Task | notification/task service/controller 测试 |

## 现有测试映射

- 启动/架构：`src/app.module.spec.ts`、`src/architecture-slimming.spec.ts`
- CORS/config：`src/bootstrap/cors-options.spec.ts`、`src/config/configuration.spec.ts`
- 权限 guard：`src/core/guards/permissions.guard.spec.ts`
- Auth：`src/modules/auth/controllers/auth.controller.spec.ts`、`src/modules/auth/services/auth.service.spec.ts`
- RBAC：`src/modules/role/**`、`src/modules/permission/**`、`src/modules/menu/**`
- API key：`src/modules/api-auth/**`、`test/api-auth.e2e-spec.ts`
- Open API：`src/modules/open-api/**`
- File：`src/modules/file/**`、`test/file.e2e-spec.ts`
- Task：`src/modules/task/**`
- Notification：`src/modules/notification/**`、`test/notification.e2e-spec.ts`
- Family：`src/modules/family/**`
- Insurance：`src/modules/insurance/**`
- Migrations：`src/migrations/*.spec.ts`

## 命令示例

单文件：

```bash
pnpm test -- src/modules/task/services/task.service.spec.ts
```

E2E 单文件：

```bash
pnpm test:e2e -- test/auth.e2e-spec.ts
```

全量：

```bash
pnpm test
pnpm build
```

## 人工检查清单

- 权限：非公开接口是否显式声明权限或允许登录访问。
- API key：scope、过期、禁用、日志是否保持。
- 迁移：`up/down` 是否对称，默认值是否兼容已有数据。
- 文件：公开性、存储后端、删除、清理候选是否保持。
- 通知：Bark/Feishu 失败是否不影响主流程。
