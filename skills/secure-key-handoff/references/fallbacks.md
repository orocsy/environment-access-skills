# HTML 不可用时选什么

| 对方条件 | 选一条 | 需要谁做什么 |
| --- | --- | --- |
| 电脑能打开本地 HTML | 离线页面 | 接收方生成；发送方粘贴并下载；无账号、无安装。手机聊天客户端未必允许运行附件脚本。 |
| 有 Node.js 22.13+ 的技术人员 | 同一请求的 CLI | 接收方交 request.json 和脚本；发送方运行 seal，终端隐藏输入后交密文。无需网页，不必生成第二套密钥。 |
| 已有 1Password | 限时、指定邮箱分享 | 发送方存为一个独立凭据项 → Share → 指定接收邮箱和短有效期 → 交分享链接；接收方不必有 1Password 账号。链接不要进入 agent 上下文。 |
| 已有 Bitwarden | Send 文本分享 | 发送方 Send → New Send → Text → 填密钥 → 设置到期/删除及访问限制 → 交链接；按当前版本选择收件身份验证。创建方需要账号；收件人可使用分享链接。 |
| 要标准加密文件格式的技术人员 | age | 用 age 生成独立接收身份、公钥并加密文件，见下文。 |

没有 HTML、不能运行工具、也没有受信任的分享服务时，不能承诺零安装的安全方案。先让接收方和发送方选可用渠道；不要退回明文聊天或让老板注册购买陌生服务。优先复用已有密码管理器，不代为创建账号、上传秘密或接受第三方条款。

链接分享不等于一次阅后即焚：到期/删除不能收回已经复制的明文，预览器也可能消耗访问次数。若设置最大访问数为 1，先关闭聊天预览并按服务实际行为处理；不要把它当作唯一保护。Bitwarden 新版本的身份选项须看当前官方文档，不能假定所有客户端和套餐相同。

## 标准工具 age

age 使用它自己的密钥与文件格式，不能用本工具的 RSA public.pem，也不能由 handoff.mjs 解密。需要安装 age（有 macOS/Linux/Windows 官方说明）。由技术人员操作：

```sh
# 接收方：私钥留在 Git 外。age-keygen 的输出包含私钥，务必用 -o。
umask 077
age-keygen -o /PRIVATE/identity.txt
age-keygen -y /PRIVATE/identity.txt > /DELIVERY/recipient.txt

# 发送方：用文件里 age1 开头的公钥替换 RECIPIENT，输入文件须在受保护目录。
age -r RECIPIENT -o response.age /PRIVATE/provider-secret.txt

# 接收方：只输出到 Git 外的新文件，不在终端显示明文。
age -d -i /PRIVATE/identity.txt -o /PRIVATE/received.secret response.age
```

这段 POSIX shell 的权限命令不适用于 Windows ACL；Windows 按官方安装说明并限制输出目录访问。标准工具不会替你绑定“这是哪家公司、哪个环境”，双方需通过已确认渠道核对这次公钥、文件和用途。age 会覆盖已存在的输出文件，执行前确认目标不存在。明文输入文件、剪贴板及编辑器自动保存仍需人工管理；这也是面向普通老板时优先 HTML、CLI 隐藏输入或现有密码管理器的原因。

官方来源（2026-10-30 核对）：[age](https://github.com/FiloSottile/age)、[1Password 分享](https://support.1password.com/share-items/)、[Bitwarden 创建 Send](https://bitwarden.com/help/create-send/)。这里只核对了文档能力，没有登录真实密码管理器账号验收。
