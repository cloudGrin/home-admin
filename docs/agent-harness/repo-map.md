# Home Admin Repository Map

Status: active
Scope: `home-admin/` directory layout
Truth source: filesystem, `package.json`, `tsconfig.json`, Nest configs
Stale if: module layout or infrastructure directories change

## 项目边界

`home-admin/` 是独立 Git 仓库，是家庭/个人后台的 NestJS 后端。所有后端命令必须在本目录执行。

## 核心路径

- `src/bootstrap/`：启动相关能力。
- `src/config/`：环境变量、数据库、TypeORM CLI 数据源。
- `src/core/`：guards、decorators、filters、interceptors、base 能力。
- `src/common/`：DTO、异常、类型、工具。
- `src/shared/`：cache、database、logger 等共享基础设施。
- `src/modules/`：业务模块。
- `src/migrations/`：TypeORM 迁移及迁移测试。
- `src/test-utils/` 与 `test/`：测试工具和 E2E。

## 关键模块

- `auth`、`user`、`role`、`permission`、`menu`：JWT/RBAC/admin 菜单。
- `api-auth`、`open-api`：API app、API key、外部开放 API。
- `file`：本地/OSS 文件上传、下载、清理。
- `notification`：站内通知、Bark、Feishu。
- `task`：任务、列表、提醒。
- `family`：家庭内容、宝宝资料、实时能力。
- `insurance`：保单、成员、提醒。
- `automation`：代码定义自动化任务。
- `health`：健康检查。
