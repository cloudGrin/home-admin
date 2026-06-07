# Home Admin Agent Harness

Status: active
Scope: `home-admin/`
Truth source: `AGENTS.md`, `package.json`, NestJS source, test configs
Stale if: scripts, module layout, auth/API-key guards, migrations, or test setup change

## 用法

本目录是 `home-admin` 的 agent harness，随本仓库版本化。进入后端任务时，先读 `AGENTS.md`，再按任务类型读取本目录文档。

## 阅读路径

- 普通后端改动：`repo-map.md`、`backend.md`、`commands.md`、`sensors.md`。
- 认证、RBAC、API key、open-api、迁移、文件、通知、任务提醒：先读 `risk-zones.md`。
- 文档或规则调整：读 `doc-freshness.md`。
- 长任务：读 `task-protocol.md`。

## 事实优先级

当前源码、配置、package scripts 和测试高于 README、历史笔记和对话记忆。发现冲突时，以代码为准，并更新本目录文档。
