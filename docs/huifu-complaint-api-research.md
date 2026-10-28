# 汇付微信投诉 API 接入资料

核对日期：2026-10-26。仅查阅公开官方资料，未登录控台，未使用真实凭证调用接口。

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

## 未解决项

- 手机号：投诉接口将 payer_phone 标为 AES 密文；公开通用加解密指南讲的是 RSA。已核对页面未说明该字段的 AES 密钥来源、模式、IV、padding 和密文编码，不能直接套用 RSA 或自行生成 AES key。[4][8]
- 权限：微信客诉指南描述适用于使用微信支付的服务商；投诉接口页面标明适用对象为微信渠道商。具体账号是否能调、是否需额外开通，须由汇付确认，拥有密钥不等于已有投诉权限。[4][6]
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
