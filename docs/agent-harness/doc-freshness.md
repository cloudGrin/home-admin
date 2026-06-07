# Home Admin Document Freshness

Status: active
Scope: backend docs and harness
Truth source: source code, package scripts, configs, tests
Stale if: referenced path, command, module, or workflow changes

## 元信息

本目录文档必须保留：

```md
Status: active
Scope: <covered area>
Truth source: <source files/configs>
Stale if: <conditions>
```

## 冲突优先级

1. 当前源码。
2. 当前配置和 package scripts。
3. 当前测试。
4. `docs/agent-harness/`。
5. `README.md` 和 `CLAUDE.md`。
6. 顶层历史部署笔记、对话记忆、旧报告。

## 更新触发器

- package scripts 改名或副作用变化。
- auth/RBAC/API-key/open-api 行为变化。
- TypeORM migration 或 env 加载流程变化。
- 测试框架、测试路径、E2E 环境脚本变化。
- 文件存储、通知投递、task/family/insurance 行为变化。

## 删除策略

代码仓只保留当前工程事实和长期规则。过程稿、阶段计划、一次性报告不要放回本仓；确需保留时迁到知识库或任务系统。
