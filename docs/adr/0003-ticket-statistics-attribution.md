# ADR 0003: 客服考核统计归属于当前责任人

## 状态

已接受

## 上下文

数据看板的"跟进人考核表"需要统计每个客服的绩效数据，用于绩效考核。明确的考核维度有 3 个：**处理单量、处理时效、超时情况**。

设计过程中曾考虑加入"转单数"维度，并纠结统计应基于"当前责任人"还是"历史处理记录"。当工单被改派时，统计归属的选择直接影响实现复杂度和数据一致性。

**方案 A：按当前责任人统计**
- 工单的所有统计数据归属于当前的 assigneeId
- 改派后，原责任人不再计入该工单
- 优点：统计简单，直接按 assigneeId 分组，无重复、无遗漏
- 缺点：改派后原责任人在该工单上的工作量不可见

**方案 B：按处理历史统计（追踪转单历史）**
- 统计时分析 ProcessLog，所有处理过该工单的人都计入
- 需要引入分配历史，支持"转单数"等维度
- 优点：更全面反映每个人的经手贡献
- 缺点：统计逻辑复杂；同一工单被多人计数，总数对不上

## 决策

采用**方案 A**：考核统计按当前 assigneeId 归属，**不追踪转单历史，不统计转单数**。

考核表 3 个维度的定义：

| 维度 | 指标 | 定义 |
|------|------|------|
| 处理单量 | 完单数 | 当前 assigneeId = 该客服 且 status = completed 的工单数 |
| 处理时效 | 平均完结时长 | completionTime − assignedAt 的平均值 |
| 超时情况 | 超时单数 / 超时率 | 该客服名下已超时（含超时完结）的工单数及占比 |

```sql
-- 跟进人考核表
SELECT
  assigneeId,
  COUNT(*) FILTER (WHERE status = 'completed') AS completed_count,
  AVG(EXTRACT(EPOCH FROM (completionTime - assignedAt)))
    FILTER (WHERE status = 'completed') AS avg_resolve_seconds,
  COUNT(*) FILTER (WHERE dueAt IS NOT NULL AND now() > dueAt AND status != 'completed') AS overdue_count
FROM tickets
WHERE assigneeId IS NOT NULL
GROUP BY assigneeId
```

## 理由

1. **考核看的是"结果 + 当前责任"**：完单、时效、超时三个维度都围绕"完结"这唯一动作。工单完结后 assigneeId 不再变化，"完结人"即"完结时的责任人"，归属永久冻结。
2. **避免重复计数**：所有工单统计数之和等于工单总数。
3. **实现简单**：直接基于 assigneeId 分组，无需维护分配历史或分析日志。
4. **去掉转单数是合理的**：转走且未完结的工单不算业绩产出——既没完成、也不再负责。为它记一笔"转单"对考核没有正向意义。改派过程在工单 ProcessLog 时间线中完整可查。

## 影响

- 改派工单后，原责任人在该工单上的工作量在考核表中不可见。
- **已知取舍**：不追踪转单历史 = "超时那一刻持有工单的人"承担超时。理论上存在主管把即将超时的工单"甩"给他人的漏洞。缓解措施：改派时 dueAt 不重置（见 ADR 0002）且展示剩余时间，改派动作记录在 ProcessLog；出现争议时以 ProcessLog 为准。对当前规模的系统，此漏洞可接受。
- 如未来需要评估个人历史经手贡献，应通过 ProcessLog（operatorId）单独统计，不影响本考核表的归属逻辑。
