# 汇付微信投诉 API 接入资料

核对日期：2026-10-29。仅查阅公开官方资料，未读取用户登录后的控台内容，未使用真实凭证调用接口。

## 结论：Webhook 优先接收，查询 API 补详情和历史

商户控台支持配置微信投诉与 400 消费者投诉 Webhook。接收端使用独立终端密钥验签，无须商户 RSA 私钥；主动查询、回复和反馈处理完成仍走 API 凭证。此前仅考虑主动拉取，遗漏了这条接入路径。[11][12]

### 现有弘梵退费工单接入

需求文档 `docs/退费异常类工单/【保险】退费异常订单线下退款线上闭环能力.md` 提到弘梵保险后台；对应退费推送实现与接口契约使用 `jb-insurance`、骏伯保险平台命名。

- 接收地址：`POST /api/integrations/jb-insurance/work-orders`，由保险平台主动推送；Bearer token 认证、JSON 字段校验，见 `apps/api/src/routes/jb-insurance-push.route.ts`。
- 建单：`apps/api/src/services/refund-push.service.ts` 按 `(platform, endorNo)` 幂等，同事务建单、保存退费详情、建单日志及通知；重复推送返回原工单号，不按手机号阻止建单。
- 完结：`apps/api/src/services/ticket-resolve.service.ts` 在完结事务内创建投递记录；`callback-delivery.service.ts` 后台回传处理结果，失败重试。
- 可复用接入模式；汇付认证、报文及 ACK 不同，需要独立路由，不能直接把现有退费地址填入汇付控台。当前仓库尚无汇付接收实现。

### 两种投诉事件

| 事件 | 官方推送内容 | 限制 |
| --- | --- | --- |
| `wechat.complaint` | `namespace`、`event_define_no`、`wechat_order_no`、`complaint_id`、`mer_id`、`trade_amount`、`complaint_datetime`、`mer_name` | 模板无投诉正文、电话、状态、历史或图片；可先建摘要工单，详情需另查。只描述消费者投诉时触发，未承诺所有后续变化推送 [13] |
| `hotline.complaint` | 投诉号 `ticketId`、正文 `content`、用户 `userName`、电话 `userPhoneNumber`、订单/商户信息、附件、事件及操作时间等 | 创建、催单、退回触发；电话示例为脱敏号码，不能假定明文。附件为 JSON 数组字符串，链接示例有有效期 [14] |

同一投诉的重复投递不能重复建单；400 催单、退回是同单新事件，不能因已存在工单就全部跳过。投诉身份和事件身份需要分开去重。微信模板没有返回查询 API 中的 `mchid`，不要自行把 `mer_id` 当作微信商户号。[4][13][14]

### 终端配置与接收

- 新增接收端点，部署为公网 HTTPS URL，再在控台配置 URL、终端密钥、事件类型。[11]
- 终端密钥固定 32 位字母数字，可由控台生成或手工录入；它是 Webhook 验签用共享密钥，不是 RSA 商户私钥，也没有依据表明它能解密 `payer_phone`。[11][15]
- 官方验签 Demo 的 `MD5Utils.java` 对 `data + key` 做 MD5，再输出大写十六进制。对原始请求体验签后再解析 JSON，不能重新序列化后验证。文档称 `sign` 在报文头，但示例位于 URL query，需用实际模拟报文核实传递位置。[11][15]
- 用户截图的端点校验提示要求 2 秒内返回 `success`；公开接入文档的正式投递要求为 HTTP `2xx`，示例返回 `ok`，超时说明为 5 秒。接收端可兼容返回 HTTP 200、纯文本 `success`，保持短响应，不等待外部详情查询。[11]
- 推荐接收流程：验签及商户范围校验 → 持久化接收记录 → 返回成功 → 后台幂等建单/更新 → 可选 API 补详情。持久化失败不能返回成功，测试事件不能创建真实工单。
- 官方提供失败补发、人工重推和 test webhook；事件查询仅三天。重试文字写“24h 内 8 次”，但仅列出 7 个间隔，不能承诺精确次数。历史导入与超出补发窗口的漏单仍需查询或人工补录。[11]

当前建议先开发并部署接收端点，用控台模拟事件验证验签、字段及响应；是否需要 API 私钥，取决于是否要自动补全微信投诉详情、拉历史或对外回复。公网 URL 尚需按实际部署确定。

## 账号与凭证

| 项目 | 用途 | 获取位置 |
| --- | --- | --- |
| sys_id | 调用方的商户或渠道商汇付 ID | 先在合作伙伴或商户控台「开发 → 开发者管理」绑定开发者，再由开发者到「开放平台开发者工作台 → 我的商户 → 公共参数」获取 [1][6] |
| product_id | 汇付分配的产品号 | 同上「公共参数」；不能套用文档示例值 [1][4] |
| 商户私钥 | 请求签名；通用指南中也用于部分参数解密 | 管理员登录控台「开发设置 → 密钥管理」生成，或本地生成密钥对并上传商户公钥 [2] |
| 商户公钥 | 供汇付验证我方签名 | 与商户私钥成对生成，本地生成后填入控台「系统公钥」 [2] |
| 汇付公钥 | 验证汇付返回签名 | 控台或开发者工作台获取；SDK 的 rsaPublicKey 指汇付公钥，不是商户公钥 [2] |
| huifu_id | 查询指定被投诉商户；不是所有场景都与 sys_id 相同 | 被投诉商户的汇付 ID；服务商、渠道商不指定时，可查询名下全部特约商户投诉 [4][6] |
| mchid / mch_id | 微信从业机构号，供后续历史、回复等接口使用 | 投诉列表返回 mchid；历史接口的入参名为 mch_id [4][5] |
| complainted_mchid | 被投诉的微信商户号 | 投诉列表返回；不要与 mchid 混用 [4] |

官方 CLI 文档提供控台入口：[合作伙伴控台](https://dashboard.huifu.com/partners/login)、[商户控台](https://dashboard.huifu.com/customers/login)。CLI 旧文档还列了「开发设置 → 开发者信息」及「我的信息 → 密钥管理」；菜单有版本差异，公共参数优先按接入说明 [1] 查找。[7]

本地生成可使用官方 CLI `dg genrsa`，默认 RSA 2048、PKCS8。签名算法为 SHA256WithRSA，仅对 data 的第一层字段按 ASCII 顺序排序后序列化签名；嵌套 JSON 字符串的内容不重排。同步返回也需要验签。[3][7]

实施建议：已有支付系统接入时，先由管理员确认现有密钥及其使用方，再决定复用或变更；私钥通过部署机密配置提供，不写入代码或研究笔记。

## 投诉相关 API

所有路径的网关均为 `https://api.huifu.com`。[4][5][6]

| 功能 | POST 路径 | 当前用途 |
| --- | --- | --- |
| 列表及详情 | /v2/merchant/complaint/list/info/query | 拉取投诉并创建本地工单 |
| 协商历史 | /v2/merchant/complaint/history/query | 拉取用户、商户及平台事件 |
| 图片下载 | /v2/merchant/complaint/download/picture | 需要接图片时使用 |
| 回复用户 | /v2/merchant/complaint/reply | 需要从工单系统回复微信时使用 |
| 反馈处理完成 | /v2/merchant/complaint/complete | 需要从工单系统反馈处理完成时使用 |

当前单向拉取的最小凭证集合：sys_id、product_id、商户私钥、汇付公钥。列表还需程序生成 req_seq_id、req_date、日期范围和分页参数，不需要人工领取这些参数。[3][4]

## 主动查询 API 首次联调顺序

1. 从已绑定商户的「公共参数」取 sys_id、product_id。[1]
2. 确认收到的公钥是哪一种：汇付公钥用于验证返回签名；商户公钥供汇付验证请求签名。两者均不能替代商户私钥，无法从公钥反推私钥。[2][3]
3. 向现有支付对接负责人确认该 sys_id 对应的签名私钥保管方。已有密钥配置时先确认使用方；不能仅因找不到私钥就覆盖控台公钥。商户专用旧版说明列出「我的信息管理 → 密钥管理」与「开发设置 → 开发者信息」，菜单版本可能不同。[10]
4. 凭证齐备后，先发一次只读投诉查询：选择有已知投诉的日期，offset="0"、limit="1"；使用新请求流水号及实际请求日期，签名后调用列表及详情接口，再验签并解析返回。首次联调不写工单，也不调用回复、退款审批或处理完成接口。[3][4]
5. 验签通过且 resp_code="00000000" 表示这次查询成功。空列表不能证明该时间段之外无投诉，也不能证明全量同步已覆盖；还需核实日期、商户范围及留言筛选条件。[4]
6. 只读查询能跑通后，再处理手机号解密、分页补漏、数据库幂等、定时建单。手机号解密资料缺失不妨碍先验证查询与验签；未解密的密文不能写入 phone 字段。

商户身份说明：产品指南明确描述商户查询；接口 sys_id 明确支持直连商户填写自身 huifu_id。因此不能因用户是商户就判定无法接入，也不能将所有普通商户等同于直连商户。是否可直接调用，仍需核实账号主体与授权。[4][6]

可向公钥提供方发送：

> 我们要接入汇付微信投诉查询。请确认发来的公钥是汇付公钥还是商户公钥，以及公共参数中的 sys_id/product_id 对应的签名私钥由谁保管。该商户是否可直接调用 /v2/merchant/complaint/list/info/query 和 /v2/merchant/complaint/history/query？如私钥由现有支付系统保管，请提供内部调用方案；先不要重置现有密钥。

## 未解决项

- 手机号：投诉接口将 payer_phone 标为 AES 密文；公开通用加解密指南讲的是 RSA。已核对页面未说明该字段的 AES 密钥来源、模式、IV、padding 和密文编码，不能直接套用 RSA 或自行生成 AES key。[4][8]
- 权限：微信客诉指南描述商户可调用，接口 sys_id 支持直连商户；但两页适用对象又分别写服务商、微信渠道商。具体账号是否能调、是否需额外开通，须由汇付确认，拥有密钥不等于已有投诉权限。[4][6]
- 测试：投诉页只给出上述网关，未列独立投诉测试地址。公开本地沙箱是支付协议模拟工具，覆盖表未列投诉；不能据此承诺投诉接口可在该沙箱联调。[4][9]
- 同步口径：begin_date/end_date 只接受日期；是否按投诉创建时间筛选、可查历史范围、频率限制，以及 incoming_user_response 缺省是否过滤有待回复留言的投诉，仍需确认。[4]

向汇付技术索取：该账号的投诉查询/历史权限确认、联调地址与测试投诉、payer_phone 完整解密规则及测试向量、日期筛选及限流规则。

## 官方来源

1. [开发接入说明](https://paas.huifu.com/docs/start/#/api_kfzn)
2. [获取密钥](https://paas.huifu.com/docs/start/#/guide_gsycshq)
3. [加签验签](https://paas.huifu.com/docs/start/#/api_v2jqyq)
4. [查询投诉单列表及详情](https://paas.huifu.com/docs/api/#/shgl/tousu/api_shgl_tousu_tscx)
5. [查询投诉协商历史](https://paas.huifu.com/docs/api/#/shgl/tousu/api_shgl_tousu_xslscx)
6. [微信客诉处理及关联接口目录](https://paas.huifu.com/docs/bzb/#/yygj/wxkscl)
7. [官方 CLI](https://paas.huifu.com/docs/devtools/#/cli/cli_js)
8. [通用加密解密说明](https://paas.huifu.com/docs/start/#/api_jiami_jiemi)
9. [本地沙箱服务](https://paas.huifu.com/docs/devtools/#/huifu_payment_local_sandbox)
10. [商户密钥操作说明](https://paas.huifu.com/docs/devtools/#/sdk_java_myczsm)
11. [Webhook 接入](https://paas.huifu.com/docs/devtools/#/webhook/webhook_jieshao)
12. [Webhook 事件列表](https://paas.huifu.com/docs/devtools/#/webhook/webhook_list)
13. [微信投诉 Webhook 模板](https://paas.huifu.com/docs/devtools/#/webhook/mb_wechat_complaint)
14. [400 消费者投诉 Webhook 模板](https://paas.huifu.com/docs/devtools/#/webhook/md_hotline_complaint)
15. [官方 Webhook 验签 Demo](https://apisite.oss-cn-shanghai.aliyuncs.com/dougongSDK/webhook/webhook%E5%8A%A0%E8%A7%A3%E7%AD%BEDEMO.zip)
