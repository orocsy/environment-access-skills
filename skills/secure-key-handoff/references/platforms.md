# 平台区别与来源

资料核对：2026-10-30。实际使用时重新核对官方页面；菜单、套餐和权限可能变化。以下是取舍依据，不是所有场景都照抄的权限配置。

| 平台 | 常见用途与凭据 | 应改变的决定 |
| --- | --- | --- |
| Resend | 来信读取、草稿改写、审批后发送；API Key；Webhook 签名密钥另算 | 正确公司空间内 API Keys → Create API Key；完整读/改流程需 Full access，该权限覆盖整个空间；只有发送时不要默认要它。Webhook 地址准备后可由技术通过 API 配置，老板不必先配事件。 |
| Stripe | 服务器收款集成；restricted key / secret key；浏览器 publishable key；Webhook signing secret | 新开发选沙箱测试环境。优先限制权限的 rk_test_；确实无法满足才说明为何需要 sk_test_。pk_test_ 不能代替服务器 Key；签名 secret 独立。勿把测试标签当成阻止真实付款的门禁。 |
| GitHub | 自己操作指定仓库的 fine-grained PAT，或长期/组织集成的 GitHub App | 优先本人身份或 GitHub App 安装授权；必须 PAT 时限定 resource owner、选定仓库、有效期和用途所需权限。只读分析通常 Contents read；推送代码才考虑写权限，工作流权限单独说明，不要默认索要老板全局 token。 |
| 其他平台 | API token、service account JSON、Webhook secret 等 | 按官方文档确认账号、环境、范围、到期和创建入口，再生成同样的安全交接包；不要用 Resend 的 Full access 套所有平台。 |

官方来源：

- [Resend API Key 权限](https://resend.com/docs/api-reference/api-keys/create-api-key)、[密钥管理](https://resend.com/docs/dashboard/api-keys/introduction)
- [Stripe keys](https://docs.stripe.com/keys)、[限制 Key 权限](https://docs.stripe.com/keys-best-practices)
- [GitHub PAT](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)、[GitHub App](https://docs.github.com/en/apps/overview)

共性是按用途授权、分清账号与环境、使用专用可撤销凭据、安全传递；创建位置和最小权限不通用。OAuth/应用安装是另一类授权流程，不能谎称都必须先把私钥给别人。
