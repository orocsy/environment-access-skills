---
name: secure-key-handoff
description: 为向客户或同事索取 API Key、Webhook secret 等凭据生成按平台配置的短步骤和安全交接包，支持离线 HTML、隐藏输入的命令行及密码管理器备用方案。适用于“管老板要某平台 key”“安全交接凭据”；不自动申请权限、发送消息、调用支付或部署。
---

# 安全密钥交接

把一次索取凭据变成一条对方能照做的顺序：平台上创建专用凭据 → 安全交给接收方 → 本机接收保存。不要把账号邀请、测试邮箱和 API Key 混为一谈。

## 先确定真正需要什么

从当前项目和会话确定平台、客户/账号、用途、测试或正式环境、所需读写权限、谁接收、对方能用什么设备。已知信息不重问；缺少影响权限的事实才问。优先查询平台官方文档和现有授权连接，不默认索要管理员主 Key。

- 按 [平台说明](references/platforms.md) 选择权限；每次生成前核对官方菜单、当前权限和凭据种类。若原生授权/应用安装可避免代收凭据，按实际用途采用它；不要为 GitHub 长期集成索要老板全局 PAT。
- 加密交接不能保证平台本身按客户隔离。工作空间、沙箱、Key 范围及运行门禁是另外的检查。
- 账号邀请码用于协作登录；测试收件邮箱用于收测试邮件；都不是 API Key 的替代品。

## 只给对方一条流程

选择一个渠道，先告知为什么适合；不要把所有备选塞进老板说明。

1. 对方能在电脑打开本地文件：生成离线 HTML 包。接收方私钥留在本机，交付包只有公钥、请求和页面。
2. HTML 不可用、对方有 Node.js 22.13+：交付同一请求文件和 `handoff.mjs`，用隐藏输入的 `seal` 命令。它和 HTML 使用相同格式及同一公钥，不必重新协商密钥。
3. 对方只有手机或不愿装工具：若已有 1Password/Bitwarden，用该平台的限时分享功能。先读 [备用办法](references/fallbacks.md)。此方式不使用本工具的公私钥；发送方需要对应账号，分享链接本身也须保密。没有这些条件时让用户选择渠道，不强行承诺“零安装通用”。

平台步骤用短的连续动作：登录正确账号 → 具体菜单 → 名称/权限/环境 → 创建 → 加密/分享 → 把什么交给谁。操作说明通常 4–6 步；Webhook、域名、接入测试和技术命令留给技术人员。参考 [Resend 成稿](references/resend-example.md)。

## 生成与接收

脚本基于 Node 内置 RSA-OAEP SHA-256 + AES-256-GCM；不需要 npm 安装。命令选项只放非秘密元数据，禁止把密钥值放进参数。

```sh
node scripts/handoff.mjs prepare --platform resend --environment test --label 'Resend API Key 交接' --private-dir /PRIVATE/keys --out /DELIVERY/resend-handoff
```

常用选项（都只放非秘密元数据）：

- `--lang en`：英文页面和提示；默认中文。对方用英文沟通时用它。
- `--fields STRIPE_SECRET_KEY:rk_test_|sk_test_,STRIPE_WEBHOOK_SECRET:whsec_`：一次交接多个具名值，每个一格。冒号后是允许的开头，可省略。页面先检查再加密，接收端再检查一次。
- 非 live 请求一律拒绝 `sk_live_`/`rk_live_`/`pk_live_` 开头的值，页面当场提示，不生成文件。
- 每个具名值都必须有“在哪里找”的指引，页面在对应输入框上方显示步骤和官方链接。常用值在 [密钥目录](references/key-catalog.json)（Stripe 测试密钥、可公开密钥、Connect client ID、webhook 密钥，Resend API Key），省略的开头也从这里补全。目录只描述测试环境的值；`--environment live` 时必须用 `--guide-file` 提供查证过的正式环境指引，并在 `--fields` 里写明正式环境的开头（如 `sk_live_`）。目录里没有的值：先查平台官方文档，写成同样格式的 JSON，用 `--guide-file` 传入；没有指引就拒绝生成。指引要写清具体页面、按钮名、值的开头，以及容易拿错的相近值（例如 client ID 不是 `pk_` 可公开密钥）。
- 页面拒绝时，提示出现在按钮正上方并滚动到可见处，不会“点了没反应”。

替换路径为该任务自己的位置。私钥目录必须在所有 Git checkout 之外；输出目录必须新建。`prepare` 输出的 `shortCode`（如 `9F1C-87C4-21DA-C3C7`）也显示在页面上：把它通过另一渠道（如聊天）告诉对方，让对方核对后再粘贴。`prepare` 返回 requestId 和路径，不返回私钥内容。`test` 只是交接标签，不会自动在供应商创建沙箱。请求默认 24 小时，可用 `--hours 48`，上限 168 小时。

向对方交 `owner.html` 及按平台编写的短步骤；CLI 备用另交 `request.json` 和 `handoff.mjs`。路径均相对本 skill。不要把技术说明发成老板待办。

```sh
# 对方执行：隐藏输入，粘贴后回车，不需要明文文件。
node handoff.mjs seal --request request.json --out response-encrypted.json

# 接收方执行：request 必须是本机 prepare 留存的副本。
node scripts/handoff.mjs receive --request /PRIVATE/keys/REQUEST_ID.request.json --key /PRIVATE/keys/REQUEST_ID.pem --input /RECEIVED/response-encrypted.json --out /PRIVATE/config/provider.secret
```

接收也可直接写入 env 文件，不经过任何明文文件：

```sh
# --input 可以是下载文件夹：自动选这次请求最新的密文文件。
node scripts/handoff.mjs receive --request /PRIVATE/keys/REQUEST_ID.request.json --key /PRIVATE/keys/REQUEST_ID.pem --input ~/Downloads --dotenv /PROJECT/apps/api/.env.local
# 单值请求另加 --env-name RESEND_API_KEY；已存在的变量须加 --replace true 才会覆盖。
```

`--dotenv` 的文件若在 Git checkout 内，必须已被 Git 忽略且未被跟踪，写入时的明文暂存副本（同目录下私有子文件夹里的同名文件）也必须被忽略，所以 `.gitignore` 要用不带开头 `/` 的规则（如 `.env.local` 或 `.env*`），否则写入前就拒绝并说明原因；写入是原子替换，权限 0600，只打印变量名。不要用 `--env-file` 这个名字：Node 会在脚本参数里也解析它并加载该文件。每个请求只能成功接收一次：写任何输出前先独占创建私钥旁的 `.used` 标记，写入失败会删除标记以便重试；`--replace` 会替换该变量的所有赋值行；同一 env 文件的写入会排队；文件里有多行值，或改动会影响其他变量时，拒绝写入；要再交接就重新 `prepare`。出错信息只含原因，不含值。

只交密文文件。接收时核对请求、平台、环境、公钥配对、完整性和有效期；输出权限 0600、不覆盖现有文件、不写 Git 目录。Windows 须另检查目录 ACL，POSIX mode 不等于 Windows 权限保证。接收后不要 `cat`、读文件工具、截图或打印秘密；由程序直接导入目标密钥配置。拿到 Key 不自动授权发信、付款、推送、部署或真实客户操作。

## 接收方是 Claude 等 agent 时

用户要给 agent 一个密钥时默认走这条，不让用户在聊天里粘贴：

1. 先查代码确定真正要的变量名和用途（只要当前工作用得到的），再确定环境、要写入哪个被忽略的 env 文件；私钥目录用 `~/.config/secure-key-handoff/<项目>/`。
2. 给出获取路径前先查官方文档：目录里已有且 `verified` 日期较近就用；否则查文档后写 `--guide-file`（或更新目录并注明 `source` 和 `verified`）。不凭记忆写菜单路径。
3. `prepare --lang <用户语言> --fields ...`。
4. 不要只发 `owner.html` 文件：有些内置浏览器（例如 Claude Code 的浏览器面板）对 `file://` 页面不运行脚本，按钮会完全没反应。运行 `serve --page <out>/owner.html`（只监听 127.0.0.1，后台常驻），在用户能用的浏览器里打开它打印的地址，确认页面脚本在运行（底部有效期显示为本地时间），再把地址告诉用户。交接完成前不要关闭这个标签页或服务。
5. 在聊天里说出 `shortCode`，并说明每个框分别要什么、哪些值不需要（例如可公开密钥不是服务器密钥）。
6. 用户说“好了”后，`receive --input ~/Downloads --dotenv <文件>`。只报告写入了哪些变量名，不读取、不打印值；再用只读请求验证密钥可用（只报告状态码）。
7. 用完停止 `serve`，提醒用户删掉下载的密文文件；平台上的撤销仍由用户决定。

## 必须保留的边界

- 不让真实秘密进入模型上下文、群消息、命令历史、日志、公开仓库或测试样例。不要用工具打开密码分享链接取得明文；让人或受控本地导入程序接收。
- HTML 只通过已确认的渠道交给对方；首次或公钥变更时，通过已知联系人核对指纹。加密不能防止对方使用被替换的网页、公钥或已感染的设备。
- 有效期只是接收程序的拒绝规则，不会让密文自毁或撤销平台 Key。分享链接过期同样不收回已经复制的内容。撤权应在供应商处撤销专用凭据；私钥留到交接核对完成，不擅自删除。
- 通用 RSA 页面是第一版工程工具，已做功能和边界测试，不宣称经过独立密码学审计。需要现成标准文件格式时用 [age 说明](references/fallbacks.md#标准工具-age)，不要把 age 文件与本工具 JSON 混用。

## 验证与交付

改变脚本后运行仓库 `npm test`。涉及 HTML 时用合成秘密在真实浏览器完成下载、解密、零网络与清空输入检查；CLI 检查无回显、错请求/错私钥/篡改/过期拒绝。只验证示例数据，不顺手接真实生产服务。

给用户：选中的渠道、可直接转发的短步骤、交付文件路径、私钥保存位置（只给路径）、验证结果及尚需本人操作的事项。发布代码先检查暂存文件；输出包、请求、公私钥及收到的密文都不进公开仓库。
