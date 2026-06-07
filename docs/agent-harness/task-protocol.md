# Home Admin Task Protocol

Status: active
Scope: backend agent workflow
Truth source: `AGENTS.md`, harness docs, verification rules
Stale if: workflow or completion contract changes

## 接任务

1. 读 `AGENTS.md`。
2. 判断是否命中 `risk-zones.md`。
3. 用 `rg` 查相邻模块和测试，不靠记忆猜。
4. 改动前说明触碰模块和验证思路。

## 实施中

- 保持改动聚焦，不顺手重构无关模块。
- 遇到用户已有未提交变更，相关则顺着现状工作，无关则不碰。
- 不运行会写文件的命令，除非任务需要并明确说明。
- 不运行迁移或测试环境清理命令，除非用户明确要求。

## 验证失败模板

```text
验证失败：
- 命令：<command>
- 失败点：<summary>
- 判断：<new regression / existing failure / environment missing>
- 下一步：<fix / narrow test / ask user>
```

## 最终回复模板

```text
改动范围：
- <modules/files>

验证：
- 已运行：<command>，结果 <summary>
- 未运行：<command>，原因 <reason>

风险：
- <known risk or none>
```
