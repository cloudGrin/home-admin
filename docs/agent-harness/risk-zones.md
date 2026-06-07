# Home Admin Risk Zones

Status: active
Scope: backend high-risk areas
Truth source: module layout, guards, migrations, package scripts
Stale if: auth, RBAC, API-key, migrations, file, notification, or task behavior changes

## 使用方式

命中风险区时，先读本文件，再读 `backend.md`、`commands.md`、`sensors.md`。最终回复必须说明风险和验证。

## Auth/RBAC/Menu

触发条件：登录、refresh/logout、用户、角色、权限、菜单、guard、decorator。

禁止：

- 用 `@Public()` 解决权限问题。
- 新增接口不声明权限。
- 只改后端菜单/权限，不说明前端菜单影响。
- 在 service 里靠前端传来的角色名、菜单名或权限名决定授权结果。
- 为修测试或调试临时关闭 guard、strategy、decorator 校验。
- 把 super admin 特权复制到普通角色逻辑里。

最低验证：auth/user/role/permission/menu 单测或对应 E2E。

## API key/Open API

触发条件：API app、API key、scope、open-api、access log、strategy/guard。

禁止：

- API key 绕过 scope。
- 禁用/过期 key 仍可访问。
- 日志泄露完整 key。
- open-api 直接复用内部 controller DTO 并暴露内部字段。
- 用“登录用户权限”替代 API key scope；两套授权模型必须分开。
- 在 access log 里记录请求体中的密钥、token 或隐私字段。

最低验证：`src/modules/api-auth/**`、`src/modules/open-api/**` 相关测试和 `test/api-auth.e2e-spec.ts`。

## 数据库迁移

触发条件：entity 字段、索引、表结构、枚举、默认值、初始化数据。

禁止：

- 未审查 migration 就运行。
- 未经用户确认运行 migration。
- 删除字段或改类型但不说明兼容/回滚。
- 把生产数据修复逻辑塞进应用启动流程。
- 在 migration 中依赖当前业务 service 或 env 外部服务。
- 用 `synchronize`、手动改库或一次性脚本绕过迁移历史。

最低验证：migration spec、entity/migration diff 审查、回滚说明。

## File/OSS

触发条件：上传、下载、删除、公开文件、清理候选、OSS/local storage。

禁止：

- 仅靠前端隐藏按钮保护私有文件。
- 把用户传入路径直接拼到本地文件系统或 OSS key。
- 删除数据库记录但不处理实际文件，或先删实际文件再导致数据库回滚不一致。
- 把私有文件 URL 当永久公开 URL 返回。
- 在日志中输出带签名的临时访问链接。

最低验证：file controller/service/storage 测试；检查公开性、权限、删除和清理路径。

## Notification/Task/Family/Insurance

触发条件：提醒、Bark/Feishu、任务日期、家庭内容、保单提醒、实时能力。

禁止：

- 只按本地当前时间写死日期逻辑，不处理时区、空日期、重复提醒边界。
- 外部推送失败后把站内通知也标记为失败，或反过来吞掉失败。
- 家庭内容、聊天、附件只校验存在性，不校验归属和可见性。
- 任务完成、重开、归档、删除时遗漏 reminder、checklist、attachment 的联动语义。
- 保单缴费日、到期日修改后不考虑已有提醒状态。

最低验证：相关 service/controller 测试；日期、重复提醒、外部投递失败要覆盖或说明。

## 个人项目取舍

企业级审计、多实例一致性、强合规、复杂观测性默认低优先级。只有当它们影响当前真实使用路径，才升级为必修。
