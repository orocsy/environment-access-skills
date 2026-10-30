# Environment Access Skills

面向客户环境接入的可复用 skills。第一版只有 **secure-key-handoff（安全密钥交接）**：把“向老板要某平台 API Key”变成一条按平台配置的短步骤，并提供离线加密页、命令行备用和密码管理器选路。

```text
$secure-key-handoff 帮我向客户要 Resend 的 API Key，用于读信和改草稿，先做测试接入。
$secure-key-handoff 帮我准备 Stripe 沙箱的受限 Key 交接。
$secure-key-handoff 对方打不开 HTML，给我不需要网页的方案。
```

安装：把 `skills/secure-key-handoff` 文件夹放到自己的 Codex skills 目录。完整入口见 [SKILL.md](skills/secure-key-handoff/SKILL.md)。运行脚本需 Node.js 22.13+，无 npm 运行依赖。

## 工作原理

接收方生成公钥和私钥，私钥留在本机。发送方只拿到公钥，用它加密自己的 API Key，再返回密文；接收方用私钥解密到受保护的本机文件。HTML 只是这个动作的界面；CLI 使用同样的请求和格式。

| 方式 | 适合谁 | 对方要做什么 |
| --- | --- | --- |
| 离线 HTML | 普通电脑用户 | 打开文件、粘贴、下载密文 |
| 隐藏输入 CLI | 有 Node 的技术人员 | 运行一条 seal 命令，粘贴后回车 |
| 已有密码管理器 | 不能打开 HTML，也不想装工具的人 | 使用现有 1Password/Bitwarden 限时分享；发送方需要账号 |

每次只向客户提供选定的一条顺序；不会让老板同时看邀请账号、Key 创建、Webhook 和多种交接流程。平台菜单、最小权限和测试/正式环境必须另核对；加密不会替你创建平台沙箱或阻止真实付款。

## 验证

```sh
npm test
```

测试涵盖加密往返、错请求/环境/私钥、篡改、过期、输出权限、拒绝 Git 目录与无秘密回显。浏览器、终端和标准工具的实测范围见 [验证记录](docs/VALIDATION.md)。此工具未经过独立密码学审计。

这是公开的工具仓库，不接收真实密钥、生成的请求包或客户数据。首次使用新平台应查询官方文档；示例仅帮助选路。后续可在 `skills/` 下增加其他环境配置 skill，当前不占用账号登录、部署或付款流程。
