# Home Admin Backend Guide

Status: active
Scope: NestJS backend development
Truth source: source code, `tsconfig.json`, `.eslintrc.js`, package scripts
Stale if: NestJS conventions, auth guards, DTO pipeline, or TypeORM config changes

## 项目取舍

这是个人后台和本地优先项目。保持单实例、轻量、可运行、可扩展。不要为没有真实需求的企业级审计、分布式锁、多实例协调、复杂权限模型引入新基础设施。

但以下问题不能降级处理：数据丢失、权限绕过、认证/授权错误、API key 越权、数据库迁移破坏、启动失败、核心流程不可用。

## 技术栈与别名

后端是 NestJS + TypeScript + TypeORM + MySQL。路径别名 `~/*` 指向 `src/*`。`strictNullChecks` 开启，`noImplicitAny` 关闭；不要把“能编译”当作行为正确。

## 标准开发流程

1. 用 `rg` 找相邻模块写法。
2. DTO 定义输入和响应边界。
3. Controller 只处理 HTTP、DTO、装饰器和 service 调用。
4. Service 承载业务逻辑、事务、外部调用和错误映射。
5. Entity 改动必须配 migration。
6. 补或更新靠近被测代码的 `*.spec.ts`。

## 架构禁做清单

- 不为单个功能引入新框架、消息队列、独立 worker、插件引擎或跨进程协调；先用现有 NestJS 模块表达。
- 不把业务逻辑塞进 controller、guard、decorator、DTO、entity hook 或 interceptor；这些层只做边界和横切职责。
- 不新增与 `src/modules/<domain>` 平行的业务目录，例如 `services2/`、`features/`、`domain/`。
- 不绕过 Nest DI 手动 new service、repository 或 client；依赖必须通过 module provider 管理。
- 不复制万能 CRUD 基类或通用 service 来消除表面重复；只有跨模块行为稳定后再抽象。
- 不把个人项目低优先级当成低质量借口；权限、数据、迁移、启动和核心流程必须严肃处理。

## 模块禁做清单

- 不跨模块直接操作对方 repository；需要复用时调用对方公开 service，或明确抽出 shared 能力。
- 不在一个 service 方法里混合 HTTP 参数解释、权限判断、数据库写入、外部通知和响应拼装。
- 不用字符串散落表示状态、类型、scope、权限码；优先复用现有 enum、常量和 DTO。
- 不吞掉外部调用失败后继续报告成功；Bark、Feishu、OSS、Socket.IO 等失败必须有日志、降级或返回语义。
- 不新增临时兼容字段但不写来源和退出条件。
- 不在测试里只 mock happy path；权限、空值、过期、重复、删除、边界日期至少选相关项覆盖。

## 权限规则

权限守卫默认拒绝未声明权限的非公开接口。新增接口必须明确：

- `@Public()`：公开接口。
- `@AllowAuthenticated()`：登录即可访问。
- 权限装饰器：需要具体权限。

遇到 403 先查用户角色、权限、菜单和装饰器，不要直接放宽 guard。

## DTO 与分页

分页、查询、数组、布尔和日期参数优先复用现有 DTO 模式。新增查询 DTO 必须考虑空值、非法值、默认值和排序字段。

## 数据库与迁移

不要启用自动 schema sync。迁移 CLI 使用 `src/config/data-source.ts`，其 env 加载逻辑需与应用保持一致。生成迁移后必须审查 SQL 意图和 `down` 回滚。

## 数据库禁做清单

- 不改 entity 后跳过 migration，也不手写 SQL 改库后让代码“追认”。
- 不在 migration 中写不可回滚的破坏性操作而不说明影响；删除字段、改类型、批量更新必须有兼容/备份判断。
- 不在请求路径中做无边界批量查询、N+1 查询或循环 await 写库；先查现有分页、relation 和事务模式。
- 不用本地开发库的成功推断生产数据安全；任何数据迁移都必须说明目标环境和回滚策略。

## 外部能力

- 文件存储默认 local，OSS 可选。
- 通知外部投递支持 Bark 和 Feishu。
- Cache 是进程内设计，符合当前单实例取舍。
- API key/open-api 必须显式 scope，不要开放隐式全量访问。
