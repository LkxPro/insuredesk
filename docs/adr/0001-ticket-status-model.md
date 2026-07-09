# ADR 0001: 工单状态模型 - 存储状态与计算状态分离

## 状态

已接受

## 上下文

工单系统需要跟踪工单的生命周期状态，同时还需要实时反映超时预警信息。我们面临两种设计方案：

**方案 A：所有状态存储到数据库**
- 6 个状态值：unassigned / assigned / processing / pending_timeout / overdue / completed
- 需要后台定时任务扫描并更新 pending_timeout 和 overdue 状态
- 优点：查询简单，不需要实时计算
- 缺点：状态更新有延迟，需要维护定时任务

**方案 B：基础状态存储 + 超时状态实时计算**
- 4 个存储状态：unassigned / assigned / processing / completed
- 2 个计算状态：pending_timeout / overdue（查询时根据 dueAt 实时判断）
- 优点：状态实时准确，无需定时任务
- 缺点：查询时需要额外计算逻辑

## 决策

采用**方案 B**：基础状态存储 + 超时状态实时计算。

**数据库存储**：
```
status: unassigned | assigned | processing | completed
dueAt: timestamp (nullable)
```

**前端显示逻辑**：
```
if (status === 'completed') return 'completed'
if (dueAt && now > dueAt) return 'overdue'
if (dueAt && (dueAt - now) < 2小时) return 'pending_timeout'
return status
```

## 理由

1. **实时性**：超时状态无延迟，用户看到的始终是准确的预警信息
2. **简化架构**：无需维护定时任务和状态同步逻辑
3. **数据一致性**：避免定时任务失败导致的状态不准确
4. **性能可接受**：计算逻辑简单（一次时间比较），不会成为瓶颈

## 影响

- 前端和 API 层需要实现状态计算逻辑（可封装为通用函数）
- 数据库查询需要考虑计算状态的过滤条件（如筛选"已超时"工单时需要加 WHERE 条件）
- 统计查询（如"超时工单数"）需要在 SQL 中加入时间判断逻辑

## 补充说明（范围澄清）

本 ADR 中"无需定时任务"指**工单显示状态**（pending_timeout / overdue）在用户查询时实时计算，不落库，因此不需要定时任务去维护状态字段。

**v2.0：读时计算的原则已扩展到通知。** ADR 0004 复盘后确认，"时间流逝触发类"提醒（overdue / due_soon / 待首响 / 跟进检查点 / 特急欠跟进）与本 ADR 的显示状态**同源**——都是随 `now` 持续变化的派生条件，因此同样**读时计算**成"我的待办"，不落库、不需定时任务。本期整个系统的时间类判定（显示染色、看板卡、我的待办）复用同一 `dueAt`/`now` 判定函数，各处口径一致。

- 本 ADR：用户打开页面时看到的实时超时标记（查询时算）
- ADR 0004：用户名下的"我的待办"告警（同样查询时算，与本 ADR 复用同一判定）
- 定时任务本期不需要；仅在二期"带外推送（邮件/飞书）"落地时引入，专供"人不在应用内"的检测与投递去重（见 ADR 0004）
