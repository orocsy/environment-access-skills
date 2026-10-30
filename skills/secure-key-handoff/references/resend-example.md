# 可以转给负责人的 Resend 示例

这是虚构项目示例，不包含任何客户信息。使用时先确认本次需要完整读信和改草稿，以及公司空间归属。

> 请帮忙准备 Resend 接入密钥：
>
> 1. 登录 Resend，左上角选择贵公司的工作空间。
> 2. 左侧 API Keys → Create API Key，名称填 Website Sales Integration，权限选 Full access，然后创建。该权限覆盖本公司空间，用于读取来信、修改草稿和发送邮件。
> 3. 打开我提供的 owner.html，粘贴刚生成的密钥，点“加密并下载”。
> 4. 把下载的 resend-test-encrypted.json 文件交给我，不发原始密钥或截图。
>
> 不需要邀请账号或提供密码；后续邮箱和 Webhook 配置由技术处理。

文件名取决于生成时选择的环境，转发前用实际文件名替换。既有邮箱不是“技术人员邀请邮箱”；对外发件地址属于业务配置，测试收件邮箱属于验收配置。

若负责人不能打开 HTML、但有 Node，保持同一个 request.json 和公钥，换成：`node handoff.mjs seal --request request.json --out response-encrypted.json`。把这些 CLI 步骤发给技术人员，不混在上面的老板说明里。
