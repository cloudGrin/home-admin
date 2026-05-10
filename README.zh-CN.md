# Home Admin

[English](./README.md)

Home Admin 是 Home 自托管个人与家庭管理套件的 NestJS 后端。它为桌面管理后台和移动端 H5 应用提供认证、
RBAC、任务、家庭保险、家庭圈、实时群聊、文件存储、通知、自动化任务和 API Key 开放接口能力。

项目定位很明确：一个服务、一个 MySQL 数据库、显式迁移、清晰模块结构，适合个人或家庭场景单实例部署，也方便继续扩展。

## 为什么使用它

很多后台模板只停留在用户、角色和菜单。Home Admin 已经内置真实可用的个人与家庭工作流：

- 个人/家庭任务管理，支持提醒和重复计划。
- 家庭保险记录，支持成员、附件、缴费日期和到期提醒。
- 家庭圈动态和实时群聊，支持图片/视频媒体。
- 本地或 OSS 文件存储，支持私有临时访问链接。
- 站内通知，并可选 Bark 与飞书推送。
- API 应用和密钥管理，适合受控集成。
- 可配置、可手动执行、可审计的自动化任务。

如果你想要一个开箱后就能真实使用的自托管后台，而不是只包含 CRUD 示例的模板，这个项目可以作为不错的起点。

## 功能亮点

### 认证与 RBAC

- JWT access token 与 refresh token。
- 持久化 refresh token 撤销与定时清理。
- 首次启动自动创建超级管理员，并在日志中输出一次性随机密码。
- 用户、角色、菜单、权限管理。
- 角色授权支持权限和菜单分配。
- 默认拒绝的权限守卫：接口必须显式声明公开、仅登录可访问或所需权限。

### 任务

- 任务清单，支持启用/归档。
- 普通任务与纪念日，支持截止日期、负责人、标签、重要/紧急标记。
- 检查项和附件。
- 完成、重新打开、删除和提醒稍后处理。
- 重复规则：每天、每周、每月、每年、工作日、自定义间隔。
- 持续提醒与定时提醒发送。

### 家庭保险

- 保险成员和关系。
- 保单信息：保险公司、保单号、险种、生效日期、到期日期、缴费日期、金额、负责人、备注和附件。
- 家庭视图 API。
- 到期提醒和缴费提醒任务。

### 家庭圈与群聊

- 家庭动态，支持文字、图片/视频、评论、回复和点赞。
- 家庭群聊消息，支持媒体。
- Socket.IO 网关推送动态、评论、点赞、聊天和通知刷新事件。
- 家庭媒体支持本地上传和 OSS 浏览器直传。

### 文件

- 默认本地磁盘存储。
- 可选阿里云 OSS 存储。
- 普通 multipart 上传和 OSS 浏览器直传。
- 公开下载、权限保护下载和私有临时访问链接。
- 支持按用户头像、文档、视频、保险保单、任务附件等模块归类。

### 通知

- 站内通知记录，包含类型、优先级、未读/已读状态和跳转链接。
- 未读列表、单条已读、全部已读接口。
- 可选 Bark 和飞书推送渠道。

### API 应用与开放接口

- API 应用和带权限范围的 API Key。
- 原始密钥只在生成时展示一次。
- API Key 守卫与权限范围装饰器。
- 开放接口是现有服务的轻量适配层，使用独立 DTO 和明确的权限范围。
- 访问日志记录路径、状态码、密钥和请求元数据。
- 前端可自动发现开放 API 权限范围并生成接入说明。
- 当前开放接口：`/api/v1/open/users` 用户公开资料列表。

### 自动化任务

- 自动化任务配置持久化到数据库。
- 支持手动执行。
- 执行日志和最近状态。
- 内置任务：
  - 清理过期 refresh token。
  - 发送任务到期提醒。
  - 发送保险提醒。

## 技术栈

- NestJS 11
- TypeScript 5.8
- TypeORM 0.3
- MySQL 8
- Passport JWT 与自定义 API Key strategy
- Socket.IO
- Nest Schedule
- Swagger/OpenAPI
- Winston 日志
- Jest 与 Supertest

## 环境要求

- Node.js 20+
- 推荐 pnpm 10
- MySQL 8

## 快速开始

```bash
pnpm install
cp .env.example .env
pnpm migration:run:ts
pnpm start:dev
```

默认 API 地址：

```text
http://localhost:3000/api/v1
```

健康检查接口不带版本前缀：

```text
http://localhost:3000/healthz
http://localhost:3000/readyz
```

空数据库首次启动时，应用会创建 `admin` 账号，并在日志中输出一次性随机密码。请启动后立刻查看日志、登录并修改密码。

## 配置

从 `.env.example` 开始配置。常用配置：

```bash
NODE_ENV=development
PORT=3000
API_PREFIX=api
API_VERSION=1

DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=
DB_DATABASE=home

JWT_SECRET=dev-secret-key-change-this-in-production
JWT_REFRESH_SECRET=dev-refresh-secret-key-change-this-in-production

FILE_STORAGE=local
FILE_UPLOAD_DIR=uploads
FILE_BASE_URL=/api/v1/files

SWAGGER_ENABLE=true
TRUST_PROXY=false
```

生产环境注意事项：

- 使用足够强且不同的 `JWT_SECRET` 和 `JWT_REFRESH_SECRET`。
- 生产环境保持 `SWAGGER_ENABLE=false`。
- 不启用 `DB_SYNCHRONIZE`，数据库结构通过 migrations 管理。
- 仅在可信反向代理后面设置 `TRUST_PROXY=true`。
- 只有 OSS 变量配置完整后才使用 `FILE_STORAGE=oss`。

## 常用命令

```bash
pnpm start:dev              # watch 模式开发服务
pnpm build                  # 编译 NestJS
pnpm start:prod             # 运行编译产物
pnpm test                   # Jest 单元测试
pnpm test:e2e               # E2E 测试
pnpm test:env:up            # 启动 MySQL 测试环境
pnpm test:env:down          # 停止 MySQL 测试环境
pnpm migration:generate     # 生成 TypeORM migration
pnpm migration:run:ts       # 从 TypeScript 源码执行迁移
pnpm migration:run          # 执行编译后的迁移
pnpm migration:revert       # 回滚最近一次编译后的迁移
pnpm lint                   # ESLint
```

## 项目结构

```text
src/
  app.module.ts
  main.ts
  bootstrap/          应用启动、CORS、Swagger、校验、安全配置
  common/             DTO、异常、枚举、工具
  config/             环境变量解析、校验、TypeORM data source
  core/               守卫、装饰器、过滤器、拦截器、基础实体
  migrations/         显式数据库迁移
  modules/
    api-auth/         API 应用、API Key、权限范围、访问日志
    auth/             登录、刷新、登出、token 清理
    automation/       Cron 定义、配置、日志、执行器
    family/           动态、评论、点赞、媒体、群聊、WebSocket 网关
    file/             存储抽象、本地存储、OSS 存储
    health/           健康检查和就绪检查
    insurance/        成员、保单、附件、提醒
    menu/             动态菜单树和用户菜单
    notification/     站内通知和推送渠道
    open-api/         API Key 保护的外部接口
    permission/       权限目录
    role/             角色和角色授权
    task/             任务清单、任务、提醒
    user/             用户、个人资料、初始化管理员
  shared/             缓存、数据库模块、日志
test/                 E2E 测试和辅助工具
```

## API 形态

成功的 JSON 响应会经过全局响应包装：

```json
{
  "success": true,
  "data": {},
  "timestamp": "2026-05-06T00:00:00.000Z",
  "path": "/api/v1/...",
  "method": "GET",
  "requestId": "..."
}
```

全局 ValidationPipe 开启 `whitelist`、`forbidNonWhitelisted` 和隐式类型转换。API 使用 URI 版本化，
默认路径为 `/api/v1`。

启用 Swagger 后，文档地址为：

```text
http://localhost:3000/api-docs
```

## API Key 使用方式

在管理后台或 API 中创建 API 应用，生成密钥后立即保存原始密钥，之后通过请求头调用开放接口：

```http
X-API-Key: sk_live_xxx
```

开放接口的权限范围来自装饰器自动发现，并由 API Key 守卫校验。

## Docker

后端镜像会构建 NestJS 应用、安装生产依赖，并在容器启动时执行迁移后启动 `dist/main`。

在工作区根目录可以用 Docker Compose 同时启动 MySQL、后端和 `home-web`：

```bash
docker compose --env-file .env.local up --build
```

默认暴露：

```text
Web:  http://127.0.0.1:8088
API:  http://127.0.0.1:3002/api/v1
MySQL: 127.0.0.1:3307
```

## 测试

```bash
pnpm test
pnpm test:env:up
pnpm test:e2e
pnpm lint
pnpm build
```

单元测试覆盖服务、DTO、守卫、存储、配置和工具。E2E 测试覆盖认证、用户、角色、菜单、权限、文件、通知、自动化和 API 认证等核心流程。

## 设计边界

Home Admin 面向个人单实例部署优化。它刻意避免分布式锁、分布式缓存、多服务架构、组织/部门平台、通用工作流引擎和企业级泛化抽象，除非这些能力真的成为项目需要。

这种取舍让它更容易理解、部署和继续扩展。
