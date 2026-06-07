# CLAUDE.md - Home Admin

本文件只做 Claude 兼容入口。通用 agent 规则以 `AGENTS.md` 为准，详细开发须知统一维护在 `docs/agent-harness/`。

## 必读入口

- `AGENTS.md`
- `docs/agent-harness/index.md`
- `docs/agent-harness/repo-map.md`
- `docs/agent-harness/commands.md`
- `docs/agent-harness/sensors.md`
- `docs/agent-harness/backend.md`
- `docs/agent-harness/risk-zones.md`
- `docs/agent-harness/task-protocol.md`

## Claude 约束

- 用中文回复，并在最终回复中列出改动范围、验证、未验证项和风险。
- 先看 `git status --short`，不要恢复或删除用户已有未提交变更。
- 不执行 `git add`、`git commit`、`git reset`、`git checkout --`，除非用户明确要求。
- 修改认证、权限、菜单、迁移、文件、通知、Open API 前，先读 `risk-zones.md`。
- 不能仅凭历史记忆或旧文档下结论；以当前源码、配置、package scripts 和测试为准。
