// China mainland compliance pack: the interview, checks for providers that
// don't work for mainland users, and the guided steps for an individual or a
// business to put a site, an API and an app online legally.
// Business registration itself is out of scope (owner's decision, 10 Nov 2026).
// Facts come from the linked pages, checked on the date beside them. Not legal advice.

const CHECKED = "2026-11-10";
const src = (url) => ({ url, checked: CHECKED });
const TENCENT_FILE = src("https://cloud.tencent.com/document/product/243/19628");
const TENCENT_FIRST = src("https://cloud.tencent.com/document/product/243/97668");
const TENCENT_OVERVIEW = src("https://cloud.tencent.com/document/product/243/18907");
const DOMAIN_RULES = src("https://help.aliyun.com/zh/icp-filing/basic-icp-service/user-guide/prepare-and-check-the-domain-name");
const POLICE = src("https://help.aliyun.com/document_detail/36981.html");
const APP_FILING = src("https://ithome.com/0/711/106.htm");

export const INTERVIEW = [
	{ key: "subject", question: "Who files?", options: ["mainland-person", "foreign-person", "individual-business", "company"], note: "A person needs no business registration; payments by merchant account need a business." },
	{ key: "province", question: "Which province is the filer registered in (ID card or business licence)?", note: "Rules differ slightly by province, e.g. guangdong, shanghai, beijing." },
	{ key: "registration", question: "For a business: register it at an approved hosted address (集群注册), at premises you have, or is it already registered?", options: ["cluster-host", "own-premises", "registered"], when: (p) => business(p), note: "cluster-host keeps your home address out of it: an incubator, park or business-secretary company approved by the district bureau." },
	{ key: "city", question: "For a business: which city and district will it register in?", when: (p) => business(p) && p.registration !== "registered", note: "e.g. guangzhou-nansha; the district decides which hosts are approved." },
	{ key: "forms", question: "What goes online?", options: ["website", "api", "ios-app", "android-app", "mini-program"], many: true },
	{ key: "commercial", question: "Will it take payments or sell anything online?", options: [true, false] },
	{ key: "children", question: "Will children under 14 use it, or will it store their data?", options: [true, false] },
	{ key: "data_leaves_mainland", question: "Will any user data leave mainland China?", options: [true, false] },
	{ key: "domain", question: "The domain for China: a new one bought at Tencent, one to transfer in, or one already at a mainland registrar?", options: ["new", "transfer", "existing"] },
];

// Providers that don't serve a mainland-facing deployment, and why.
const NOT_FOR_MAINLAND = {
	"google-oauth": "Google sign-in isn't reachable from the mainland; use WeChat or phone sign-in",
	stripe: "Stripe doesn't onboard mainland businesses; use WeChat Pay or Alipay (needs a business), or Apple in-app purchase",
	vercel: "mainland visitors to an overseas host are slow and unreliable, and a filed domain must point at a mainland resource",
	cloudflare: "Cloudflare's network isn't licensed in the mainland; use DNSPod and Tencent's CDN",
	resend: "sends from outside the mainland and keeps data there; use Tencent SES",
	"aws-ec2-docker": "a filed domain must point at a mainland resource; use a Tencent server in a mainland region",
};

export const has = (profile, form) => (profile.forms ?? []).includes(form);
const person = (p) => p.subject === "mainland-person" || p.subject === "foreign-person";
const business = (p) => p.subject === "company" || p.subject === "individual-business";
const forming = (p) => business(p) && p.registration && p.registration !== "registered";
const kind = (p) => (p.subject === "company" ? "one-person limited company (一人有限责任公司)" : "individual business (个体工商户)");
const GD_PORTAL = src("https://www.gdzwfw.gov.cn");
const NANSHA_OPC = src("http://www.gzns.gov.cn/zwgk/rdzt/OPC/OPCYLS/content/post_10745016.html");
const CLUSTER_RULES = src("https://www.gz.gov.cn/gzzcwjk/gzdata/content/post_10068139.html");

// Registering the business, when the answers say it doesn't exist yet. Kept to
// the route the owner chose: an approved hosted address, never the home.
function businessGates(p) {
	if (!forming(p)) return [];
	const hosted = p.registration === "cluster-host";
	return [
		{
			id: "cn.biz.plan",
			track: "business",
			bundle: "preflight",
			type: "console",
			who: "agent drafts; you approve",
			title: `Plan the ${kind(p)}`,
			steps: [
				"Three name choices in the form 城市 + 字号 + 行业 + 组织形式 (e.g. 广州某某科技有限公司), checked against the portal's name search",
				"Business scope (经营范围) from the standard catalogue for software work: 软件开发, 信息技术咨询服务, 信息系统集成服务, 技术服务 — and nothing that needs a prior licence",
				p.subject === "company" ? "Registered capital: a modest pledged amount (认缴); under the 2024 Company Law it must be paid in within 5 years" : "No registered capital for an individual business",
				"You are shareholder, executive director and legal representative; a supervisor or the 'no supervisor' option as the portal allows",
			],
			takes: "an hour of the agent's time, then your review",
			note: "Limited liability holds only if company and personal money stay apart: a separate bank account, every payment through it.",
		},
		hosted
			? {
					id: "cn.biz.host",
					track: "business",
					bundle: "preflight",
					type: "console",
					who: "you",
					title: "Choose an approved hosted address (集群注册) in the district",
					where: `the district's market-regulation bureau (市场监督管理局) or government service centre (政务服务中心)${p.city ? ` for ${p.city}` : ""}`,
					after: ["cn.biz.plan"],
					steps: [
						"Phone or visit and ask: 请问本区有哪些备案的集群注册托管机构？有没有面向一人公司/OPC 的免费或低价地址？",
						"Prefer a government-backed incubator or OPC community; ask for a yearly or one-off fee, not monthly rent",
						"Before paying, check the host: on the bureau's list; on gsxt.gov.cn for years in business, no violations, few abnormal firms at its address",
						"Ask: will banks' on-site checks be supported at this address? Has it worked for ICP filing and WeChat Pay/Alipay?",
						"Sign the 住所托管协议 with every yearly fee written in; get the host's proof of approval",
					],
					documents: ["your ID", "the name choices and scope from the plan"],
					takes: "a few days to compare two hosts",
					cost: "the host's fee, written in the contract (yearly or one-off)",
					faq: [
						{ q: "A Xiaohongshu agent offers a free address with no checks", a: "Walk away: unregistered addresses are rejected or end up on the abnormal-operations list (经营异常名录)." },
						{ q: "Is there a free government address?", a: "Some districts' OPC programmes subsidise addresses for new one-person companies; ask the district, the conditions vary." },
					],
					sources: [CLUSTER_RULES, NANSHA_OPC],
				}
			: null,
		{
			id: "cn.biz.register",
			track: "business",
			bundle: "preflight",
			type: "identity",
			who: "you",
			title: `Register the ${kind(p)} online`,
			where: "广东政务服务网 → 企业开办 一网通办 (Guangzhou also has an OPC 开办一类事 section)",
			after: hosted ? ["cn.biz.host"] : ["cn.biz.plan"],
			steps: [
				"Name self-declaration (名称自主申报) with the first available name",
				"Fill the registration with the plan's scope and capital; address = the host's address and its documents",
				"Electronic signature and face check on your phone",
				"Download the electronic business licence; order the seals through the same service if offered",
				"Beneficial-owner filing (受益所有人备案) is part of the online form",
			],
			takes: "often the same day to a few working days (Nansha advertises same-day licences for one-person companies)",
			sources: [GD_PORTAL, NANSHA_OPC],
		},
		{
			id: "cn.biz.bank",
			track: "business",
			bundle: "preflight",
			type: "identity",
			who: "you",
			title: "Open the business bank account (基本存款账户)",
			where: "a bank branch you choose (most need the legal representative in person)",
			after: ["cn.biz.register"],
			steps: [
				"Book an appointment; bring the licence, your ID, the seals and the host's address documents",
				"The bank may check the registered address; tell the host in advance",
				"Set up online banking, then the tax authority's three-party agreement (三方协议) so taxes can be paid from the account",
			],
			takes: "1–7 working days, depending on the bank",
			note: "Every business payment in and out goes through this account. Keep personal spending off it.",
		},
		{
			id: "cn.biz.tax",
			track: "business",
			bundle: "preflight",
			type: "console",
			who: "you, then a bookkeeper (代账)",
			title: "Tax setup and a bookkeeper",
			where: "the provincial electronic tax bureau (电子税务局)",
			after: ["cn.biz.register"],
			steps: [
				"Log in as the business, confirm the tax registration details and the taxpayer type (small-scale 小规模纳税人 is usual)",
				"Hire a bookkeeper; filings are due even with no income (零申报)",
				"Diary: monthly or quarterly filings by the 15th, and the annual report (年报) between 1 January and 30 June every year",
			],
			takes: "an hour, plus choosing a bookkeeper",
			cost: "the bookkeeper's monthly fee",
		},
	].filter(Boolean);
}

export function validate(stack) {
	const profile = stack.profile ?? {};
	const errors = [];
	const warnings = [];
	for (const q of INTERVIEW) {
		const value = profile[q.key];
		if (value === undefined) continue;
		const values = q.many ? value : [value];
		if (q.options && (!Array.isArray(values) || values.some((v) => !q.options.includes(v))))
			errors.push(`profile.${q.key}: one${q.many ? " or more" : ""} of ${q.options.join(", ")}`);
	}
	for (const [name, cap] of Object.entries(stack.capabilities)) {
		const why = NOT_FOR_MAINLAND[cap.provider];
		if (why) warnings.push(`capabilities.${name}: ${cap.provider} — ${why}`);
	}
	if (profile.data_leaves_mainland === false && stack.secrets?.mirrors?.some((m) => m.type === "github-secret"))
		warnings.push("secrets.mirrors: a GitHub secret copies the env file outside the mainland; fine for keys, but keep user data out of it");
	return { errors, warnings };
}

export const missingAnswers = (stack) => INTERVIEW.filter((q) => (!q.when || q.when(stack.profile ?? {})) && stack.profile?.[q.key] === undefined);

export function gates(stack) {
	const p = stack.profile ?? {};
	const app = has(p, "ios-app") || has(p, "android-app");
	const site = has(p, "website") || has(p, "api");
	const filing = ["cn.account.realname", "cn.domain.realname", "cn.filing.prepare", ...(app ? ["cn.app.prepare"] : [])];
	const list = [
		{
			id: "cn.account.realname",
			track: "account",
			bundle: "preflight",
			type: "identity",
			who: "you",
			title: `Real-name verify your Tencent Cloud account as ${person(p) ? "a person (个人认证)" : "a business (企业认证)"}`,
			where: "https://console.cloud.tencent.com/developer/auth",
			steps: ["账号中心 → 实名认证", person(p) ? "个人认证 → 微信扫码 or 人脸识别" : "企业认证 → 上传营业执照, then the company's bank or legal-person check", "Wait for 认证成功"],
			documents: person(p) ? [p.subject === "foreign-person" ? "passport (some provinces accept it for filing; Tencent shows if yours does)" : "mainland ID card"] : ["business licence (营业执照) scan"],
			takes: "minutes for a person; up to 1–3 working days for a business",
			faq: [{ q: "Can I change from person to business later?", a: "Yes, by upgrading the verification; filings made as a person stay in the person's name until changed." }],
			sources: [TENCENT_FIRST],
		},
		p.domain === "transfer"
			? {
					id: "cn.domain.register",
					track: "domain",
					bundle: "app",
					type: "console",
					who: "you",
					title: "Transfer the domain to Tencent Domains (a registrar MIIT approves)",
					where: "https://console.cloud.tencent.com/domain",
					steps: [
						"At the current registrar: unlock the domain and copy the transfer code (EPP/auth code). It must be more than 60 days since it was registered or last transferred.",
						"Tencent console → 域名注册 → 转入 → paste the domain and code → pay the transfer fee (it adds a year)",
						"Approve the transfer email the old registrar sends, if it sends one",
					],
					takes: "usually about a week; the old registrar may hold it up to 5 days",
					cost: "a transfer fee shown at checkout (it includes a year's renewal)",
					sources: [DOMAIN_RULES],
				}
			: p.domain === "existing"
				? null
				: {
						id: "cn.domain.register",
						track: "domain",
						bundle: "app",
						type: "money",
						who: "you",
						title: `Buy ${stack.domain} at Tencent Domains`,
						where: "https://buy.cloud.tencent.com/domain",
						steps: ["Search the name → add to cart", "Choose a 信息模板 (or create one in the next step) → pay"],
						takes: "minutes",
						cost: "the yearly price shown at checkout, usually tens of yuan for .com or .cn",
						note: "Bought early on purpose: it's cheap, and its real-name check takes days.",
						sources: [DOMAIN_RULES],
					},
		{
			id: "cn.domain.realname",
			track: "domain",
			bundle: "app",
			type: "identity",
			who: "you",
			title: "Real-name the domain in the filer's own name (域名实名认证)",
			where: "https://console.cloud.tencent.com/domain/template",
			after: ["cn.account.realname", ...(p.domain === "existing" ? [] : ["cn.domain.register"])],
			steps: ["域名注册 → 信息模板 → 新建模板", "Owner type and name exactly as on the account's real-name check", "Upload the same ID or licence → submit → attach the template to the domain"],
			documents: person(p) ? ["the same ID used for the account"] : ["the business licence"],
			takes: "1–3 working days, then 2–3 more for the details to reach the filing system",
			faq: [{ q: "Does the name have to match the filing exactly?", a: "Yes: holder name and ID number must be the filing subject's, or the filing is rejected." }],
			sources: [DOMAIN_RULES],
		},
		{
			id: "cn.filing.prepare",
			track: "filing",
			bundle: "app",
			type: "console",
			who: "agent",
			title: "Prepare every filing value and check the documents",
			steps: [
				`Site name: Chinese, describing what the site does (not just a brand), within the rules; the agent proposes one${site ? "" : " (needed for the API's domain too)"}`,
				"Service description, responsible person fields, emergency contact: drafted for you to check",
				"Document check: ID photos in colour, both sides, readable, in date; nothing else is uploaded by the agent",
			],
			after: [],
			takes: "an hour of the agent's time, then your review",
			note: "Personal details (ID numbers, phone numbers) are never written to the repo; you type them into the console.",
			sources: [TENCENT_FILE],
		},
		app
			? {
					id: "cn.app.prepare",
					track: "filing",
					bundle: "app",
					type: "console",
					who: "agent",
					title: "Prepare the app filing values (APP备案)",
					steps: [
						"App name as it appears in the store; bundle ID",
						has(p, "ios-app") ? "The signing certificate's public key and SHA-1 fingerprint, read from your Apple distribution certificate" : "The Android package name, public key and MD5 fingerprint",
						"Service description and the backend domain(s) the app calls",
					],
					after: has(p, "ios-app") ? ["apple.developer"] : [],
					takes: "an hour of the agent's time",
					sources: [APP_FILING],
				}
			: null,
		has(p, "ios-app")
			? {
					id: "apple.developer",
					track: "filing",
					bundle: "app",
					type: "money",
					who: "you",
					title: "Enrol in the Apple Developer Program (as an individual is fine)",
					where: "https://developer.apple.com/programs/enroll/",
					steps: ["Sign in with your Apple Account → Enroll → Individual", "Pay the yearly fee", "Then the agent creates the bundle ID and distribution certificate"],
					note: "Needed for TestFlight and for the app filing's certificate details. It can wait until just before the app details are prepared; approval usually takes up to 48 hours.",
					takes: "usually within 48 hours",
					cost: "the yearly fee shown by Apple (about US$99 / ¥688)",
				}
			: null,
		{
			id: "cn.host.purchase",
			track: "filing",
			bundle: "app",
			type: "money",
			who: "you approve; the agent buys",
			title: "Buy the mainland server the filing is attached to",
			where: "https://console.cloud.tencent.com/lighthouse",
			after: filing,
			justInTime: true,
			steps: [
				"Only now, because a filing can't be submitted without it, and everything else for the filing is ready, so you don't pay while waiting",
				"Lighthouse in a mainland region near your users (e.g. Guangzhou or Shanghai), monthly or yearly billing (filing needs prepaid billing), the shortest term the filing console accepts",
				"The plan shows Tencent's current price; nothing is bought without your yes (--accept-cost)",
			],
			takes: "minutes",
			cost: "Tencent's monthly price for the chosen size, shown before you agree",
			faq: [
				{ q: "Why not buy earlier to test?", a: "The app is tested locally and on Tencent's free default domains first; a mainland server can't serve your domain until the filing is approved anyway." },
				{ q: "Can serverless CloudBase be the filing resource?", a: "Your choice: the filing form lists every resource on your account that qualifies. If a CloudBase environment is listed there, it works; if not, use a server." },
			],
			sources: [TENCENT_FIRST, src("https://cloud.tencent.com/document/product/1207/45756")],
		},
		{
			id: "cn.filing.submit",
			track: "filing",
			bundle: "app",
			type: "console",
			who: "you",
			title: `Submit the ICP filing${app ? " with the app in the same order" : ""}`,
			where: "https://console.cloud.tencent.com/beian",
			after: ["cn.host.purchase"],
			steps: [
				"备案 → 首次备案 → choose the server bought above (or enter a 备案授权码)",
				"Paste the values the agent prepared; type the personal details yourself",
				app ? "Add the app (APP备案) in the same order, so one review and one face check cover both" : "Check every field against the agent's list",
				"Upload the documents → submit",
			],
			takes: "Tencent checks it in 1–2 working days and may phone you",
			faq: [{ q: "They phoned and asked what the site does", a: "Describe it in the words of the service description you submitted." }],
			sources: [TENCENT_FILE],
		},
		{
			id: "cn.filing.face",
			track: "filing",
			bundle: "app",
			type: "identity",
			who: "you",
			title: "Face check in the 腾讯云助手 mini program",
			where: "WeChat → search 腾讯云助手 → 备案 → 待核验",
			after: ["cn.filing.submit"],
			steps: ["Open the mini program on your phone", "Follow the face-check prompts with the same ID"],
			takes: "minutes",
			sources: [TENCENT_FILE],
		},
		{
			id: "cn.filing.sms",
			track: "filing",
			bundle: "app",
			type: "identity",
			who: "you",
			title: "Answer the MIIT text message within 24 hours",
			where: "the link in the SMS from MIIT (工信部), or https://beian.miit.gov.cn → 短信核验",
			after: ["cn.filing.face"],
			deadline: { within: "24 hours", from: "cn.filing.face", note: "of the SMS arriving; it usually comes a day or two after Tencent's review" },
			steps: ["Open the page, enter your ID number, phone number and the code from the SMS", "Submit before the 24 hours run out, or the filing is sent back"],
			takes: "minutes",
			sources: [TENCENT_FILE],
		},
		{
			id: "cn.filing.review",
			track: "filing",
			bundle: "app",
			type: "time",
			who: "the provincial authority (管局)",
			title: "Wait for the filing number (备案号)",
			after: ["cn.filing.sms"],
			steps: ["Nothing to do", "When the email or SMS with the filing number arrives, run: stack guide done --note \"<filing number>\""],
			takes: "up to 20 working days",
			sources: [src("https://m.thepaper.cn/newsDetail_forward_24155262")],
		},
		{
			id: "cn.golive",
			track: "launch",
			bundle: "app",
			type: "console",
			who: "agent",
			title: "Go live on the filed domain",
			after: ["cn.filing.review"],
			steps: [
				"DNSPod: point the domain at the server",
				"HTTPS certificate, then the site and API on the filed domain",
				"Footer: the filing number linking to https://beian.miit.gov.cn",
				"Check from a mainland network",
			],
			takes: "an hour",
		},
		app && has(p, "ios-app")
			? {
					id: "cn.app.store",
					track: "launch",
					bundle: "go-live",
					type: "console",
					who: "you",
					title: "Add the app's filing number in App Store Connect for the China storefront",
					where: "https://appstoreconnect.apple.com → the app → App Information",
					after: ["cn.filing.review"],
					steps: ["Enter the app's ICP filing number in the China mainland field", "Submit the build for review with China in its availability"],
					takes: "Apple's normal review, usually 1–2 days",
				}
			: null,
		{
			id: "cn.police.filing",
			track: "launch",
			bundle: "go-live",
			type: "identity",
			who: "you",
			title: "Police filing (公安联网备案) within 30 days of going live",
			where: "https://beian.mps.gov.cn",
			after: ["cn.golive"],
			deadline: { within: "30 days", from: "cn.golive" },
			steps: [
				"Register and verify your identity on the national platform",
				"新办网站备案: enter the domain, the filing number, the server's provider (Tencent Cloud) and the service type",
				"After approval, the agent adds the police filing number and badge to the footer (within 30 days of approval)",
			],
			takes: "the local police review, often 1–2 weeks",
			faq: [{ q: "Our domain only serves an API", a: "A domain that only serves an API and no web pages can wait; the website's domain can't." }],
			sources: [POLICE, TENCENT_OVERVIEW],
		},
		{
			id: "cn.sms.signature",
			track: "launch",
			bundle: "go-live",
			type: "console",
			who: "you",
			title: "SMS sign-in: get the signature and template approved",
			where: "https://console.cloud.tencent.com/smsv2",
			after: ["cn.filing.review"],
			steps: [
				person(p) ? "签名管理 → 创建: as a person, use the filed website's or app's name as the signature" : "签名管理 → 创建: the business's name or the filed site's name",
				"正文模板管理 → 创建: the agent drafts the one-time-code template to the review rules",
				"After approval, wait for the carrier registration (报备成功) before sending",
			],
			takes: "1–2 working days, then the carrier registration",
			sources: [src("https://cloud.tencent.com/announce/detail/2156")],
		},
		{
			id: "cn.privacy",
			track: "launch",
			bundle: "app",
			type: "terms",
			who: "agent drafts; you approve",
			title: "Chinese privacy policy and user agreement",
			steps: [
				"The agent drafts both from what the app really collects and where it stores it",
				p.children ? "Children under 14: a parent's separate consent, and children's data treated as sensitive (PIPL)" : "Separate consent for any sensitive data",
				"Linked from the app and site before launch",
			],
			needs: p.children ? "lawyer: confirm the children's-data consent flow and retention rules" : undefined,
		},
		p.commercial
			? {
					id: "cn.payments",
					track: "launch",
					bundle: "go-live",
					type: "money",
					who: "you",
					title: business(p) ? "Open WeChat Pay and Alipay merchant accounts" : "Decide how to take payments",
					after: business(p) && forming(p) ? ["cn.biz.bank", "cn.filing.review"] : business(p) ? ["cn.filing.review"] : [],
					where: business(p) ? "https://pay.weixin.qq.com and https://b.alipay.com" : undefined,
					steps: business(p)
						? [
								"WeChat Pay merchant platform → 接入微信支付 as the business; Alipay merchant centre → 入驻 as the business",
								"Settlement account: the business bank account",
								"The app's filed domain and the iOS app's name are asked for, so this comes after the filing",
								"The agent wires the API keys and certificates through secure-key-handoff, then the payment callbacks",
								has(p, "ios-app") ? "Digital services bought inside the iOS app still go through Apple's in-app purchase" : "",
							].filter(Boolean)
						: [
								"A person (no business) can't open a WeChat Pay or Alipay merchant account; those need an individual business (个体工商户) or a company",
								has(p, "ios-app") ? "In the iOS app, digital services can be sold through Apple's in-app purchase under your developer account" : "Look at platforms that collect on your behalf",
								"Set subject to company or individual-business in profile: to add the registration steps",
							],
					needs: "adviser: whether selling online needs a commercial licence (B25) for your service",
				}
			: null,
		p.data_leaves_mainland
			? {
					id: "cn.data.export",
					track: "launch",
					bundle: "go-live",
					type: "terms",
					who: "you, with an adviser",
					title: "A legal route for data leaving the mainland",
					steps: ["Security assessment, standard-contract filing or certification, unless an exemption applies"],
					needs: "lawyer: which route applies",
					sources: [src("https://www.mondaq.com/china/security/1701278/china-finalizes-certification-route-for-cross-border-data-transfer")],
				}
			: null,
	];
	const all = [...businessGates(p), ...list.filter(Boolean)];
	if (forming(p)) {
		// A business verifies its Tencent account through a payment to its own bank account,
		// and real-names the domain with the licence, so both wait for the business to exist.
		const account = all.find((g) => g.id === "cn.account.realname");
		account.after = [...(account.after ?? []), "cn.biz.bank"];
		const apple = all.find((g) => g.id === "apple.developer");
		if (apple) {
			// The app is published under the business, so Apple enrolment is as an organisation, after registration.
			apple.after = [...(apple.after ?? []), "cn.biz.register"];
			apple.title = "Enrol in the Apple Developer Program as an organisation (the business)";
			apple.steps = [
				"Look up or request the business's D-U-N-S number with Apple's free lookup tool (a new one can take several days)",
				"developer.apple.com → Enroll → Organization, with the business's legal name exactly as on the licence",
				"Pay the yearly fee from the business account; then the agent creates the bundle ID and distribution certificate",
			];
		}
		const domain = all.find((g) => g.id === "cn.domain.register");
		if (domain) domain.after = [...(domain.after ?? []), "cn.biz.register"]; // bought in the business's name
	}
	return all.map((g, seq) => ({ ...g, seq, pack: "cn-mainland" }));
}

export default {
	jurisdiction: "cn-mainland",
	interview: INTERVIEW,
	validate,
	missingAnswers,
	gates,
	// Command-line tools a China stack relies on (checked by doctor; installing asks first).
	tools: [
		{ cmd: "tccli", args: ["--version"], install: "pip install tccli (Tencent's official CLI)", why: "Lighthouse, DNSPod, SMS and SES" },
	],
};
