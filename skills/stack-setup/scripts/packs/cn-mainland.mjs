// China mainland compliance pack: the interview, checks for providers that
// don't work for mainland users, and the guided steps for an individual or a
// business to put a site, an API and an app online legally.
// Registration steps guide the owner; they do not submit an application or pay a host.
// Facts come from the linked pages, checked on the date beside them. Not legal advice.

const CHECKED = "2026-11-10";
const src = (url, checked = CHECKED) => ({ url, checked });
const TENCENT_FILE = src("https://cloud.tencent.com/document/product/243/19628");
const TENCENT_FIRST = src("https://cloud.tencent.com/document/product/243/97668");
const TENCENT_OVERVIEW = src("https://cloud.tencent.com/document/product/243/18907");
const DOMAIN_RULES = src("https://help.aliyun.com/zh/icp-filing/basic-icp-service/user-guide/prepare-and-check-the-domain-name");
const POLICE = src("https://help.aliyun.com/document_detail/36981.html");
const APP_FILING = src("https://ithome.com/0/711/106.htm");

export const INTERVIEW = [
	{ key: "subject", question: "Who files?", options: ["mainland-person", "foreign-person", "individual-business", "company"], note: "Choose the actual filing subject. Payment onboarding depends on the product and merchant category; a personal login alone does not establish eligibility." },
	{ key: "province", question: "Which province is the filer registered in (ID card or business licence)?", note: "Rules differ slightly by province, e.g. guangdong, shanghai, beijing." },
	{ key: "registration", question: "For a business: register it at an approved hosted address (集群注册), at premises you have, or is it already registered?", options: ["cluster-host", "own-premises", "registered"], when: (p) => business(p), note: "A qualified host supplies the registered business address. Identity and contact documents are still required; hosting does not promise personal anonymity." },
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
const NANSHA_RULES = src("https://www.gzns.gov.cn/zwgk/zcwjjjd/zcwj/content/post_10068270.html", "2026-11-11");
const NANSHA_WECHAT = src("https://www.nstfhg.com/index/Article/detail.html?cate=5&id=876", "2026-11-11");
const TENCENT_AUTH = src("https://cloud.tencent.com/document/api/378/10496", "2026-11-11");
const WECHAT_SETTLEMENT = src("https://pay.wechatpay.cn/doc/v3/partner/4012760618", "2026-11-11");
const APPLE_ENTITY = src("https://developer.apple.com/help/account/membership/D-U-N-S", "2026-11-11");
const BENEFICIAL_OWNER = src("https://tianjin.pbc.gov.cn/fzhtianjin/113733/5424470/5492278/2024103016524665832.pdf", "2026-11-11");
const HOST_MESSAGE = "您好，我想在南沙办理注册地址托管，经营范围是软件开发、网站及App开发、AI应用和自动化技术服务，只购买地址托管，不申请项目孵化。请问个体工商户和一个自然人股东的有限责任公司目前是否都接受新申请？首年及续年全部费用分别是多少，托管期限多久，需要哪些材料，是否必须绑定代理记账？烦请发申请指南、收费表和合同范本，我暂不方便电话，请文字回复，谢谢。";

// Keep the two entity types separate and follow the owner's selected address route.
function businessGates(p) {
	if (!forming(p)) return [];
	const hosted = p.registration === "cluster-host";
	const company = p.subject === "company";
	const nansha = p.city === "guangzhou-nansha";
	return [
		{
			id: "cn.biz.plan",
			track: "business",
			bundle: "preflight",
			type: "console",
			who: "agent drafts; you approve",
			title: `Plan the ${kind(p)}`,
			steps: [
				company ? "Prepare three company names (e.g. 广州某某科技有限公司) and check the portal's name search" : "Prepare three individual-business names using the portal's industry wording and organisation suffix; do not choose 有限公司",
				"Select actual work from the standard scope catalogue: 软件开发, 人工智能应用软件开发, 软件外包服务, 信息技术咨询服务 and the relevant 技术服务 entry; adding AI wording alone does not qualify for a subsidy",
				company ? "Choose registered capital you can actually contribute; a newly formed limited company normally pays the subscribed amount within 5 years under its articles" : "An individual business has no company registered capital; fill any 资金数额 field truthfully as business funds",
				company ? "Record the natural-person shareholder, legal representative and director; select the supervisor arrangement allowed by the law and portal" : "Record the 经营者 and whether it is personal or family operation; there are no company shareholders or directors",
			],
			takes: "an hour of the agent's time, then your review",
			note: company ? "Keep company assets and records separate from personal assets. A sole shareholder must be able to prove that separation; a bank account alone does not establish it. See references/guangzhou-business-registration.md for expenses, distributions and closing." : "An individual business is not a limited company. Personal operation generally carries liability against personal assets; business records are still required.",
		},
		hosted
			? {
					id: "cn.biz.host.inquiry",
					track: "business",
					bundle: "preflight",
					type: "console",
					who: "you send the prepared message",
					title: "Ask a government-backed host for written eligibility, fees and documents",
					where: nansha ? "WeChat: 广州南沙投资咨询有限公司; check the account's certified operator and ask for 集群注册/住所托管 service" : `the published online contact for a government-backed host or the district's registration service${p.city ? ` in ${p.city}` : ""}`,
					after: ["cn.biz.plan"],
					steps: [
						"Send the draft yourself after review. This asks about address hosting only; no specific project, pitch or incubation application is needed in the inquiry",
						"Request a written reply covering new applicants of BOTH entity types, first-year and renewal totals, hosting term, required documents and any bundled bookkeeping",
						"Mark this inquiry done when the written reply is received and recorded, not merely when the message has been sent; unresolved eligibility or price stays open",
					],
					prefill: { message: nansha ? HOST_MESSAGE : "您好，我想办理注册地址托管，只购买地址服务，不申请项目孵化。请问个体工商户和一个自然人股东的有限责任公司目前是否接受新申请？首年、续年全部费用、托管期限和材料分别是什么？是否绑定代理记账？请发申请指南、收费表和合同范本，烦请文字回复，谢谢。" },
					note: "No current new-applicant price or admission confirmation has been obtained. Government backing does not establish free or permanent hosting. Do not open a new browser or send a message without the owner's instruction.",
					sources: nansha ? [NANSHA_RULES, NANSHA_WECHAT] : [CLUSTER_RULES],
				}
			: null,
		hosted
			? {
					id: "cn.biz.host",
					track: "business",
					bundle: "preflight",
					type: "console",
					who: "you",
					title: "Choose an approved hosted address (集群注册) in the district",
					where: "the host's written reply and hosting agreement; use the bureau's published online enquiry if qualification remains unclear",
					after: ["cn.biz.host.inquiry"],
					steps: [
						"Prefer the government-backed address-only offer. Consider a private host only if that route cannot meet the requirements; project screening or interviews require a new decision",
						"Verify the contracting entity and its qualification for the exact address and chosen entity type with the registration authority; a website advert or a business licence alone does not prove this",
						"Record first-year and renewal totals, term, deposit, refund/rejection terms, exit/address-change costs, mail handling and any required bookkeeping. A one-off payment can cover a fixed term; it does not mean permanent hosting",
						"Confirm what the host actually supports for bank checks, receiving official notices and merchant/address checks; a registered address alone does not guarantee bank, ICP or payment approval",
						"Before completing this step, obtain the valid hosting agreement, address-use consent and the required address evidence; the owner approves any fee and signs. Register with the exact address in those documents",
					],
					documents: ["the host's current written eligibility and materials list", "identity documents supplied privately through its verified channel", "the approved names and scope", "the host's address-use documents"],
					takes: "depends on the host's written reply and document processing",
					cost: "only the itemised quote approved by the owner; first-year and renewal fees remain unconfirmed",
					faq: [
						{ q: "A social-media agent offers a free address", a: "An advert is a lead, not proof. Verify the actual host, address permission, contract term and full fees before paying or uploading identity documents." },
						{ q: "Does Nansha's old free-three-year offer cover a new applicant?", a: "Do not assume so. Article 29 of the 2025 rules describes a transition for previously registered businesses; obtain a current new-applicant quote for the chosen entity type." },
					],
					sources: nansha ? [NANSHA_RULES, NANSHA_WECHAT] : [CLUSTER_RULES],
				}
			: null,
		{
			id: "cn.biz.register",
			track: "business",
			bundle: "preflight",
			type: "identity",
			who: "you",
			title: `Register the ${kind(p)} online`,
			where: company ? "广东政务服务网 → 企业开办 一网通办; Guangzhou has an OPC 开办一类事 section" : "广州市市场主体直通车 → 我要办 → 个体设立 (not the company-opening form)",
			after: hosted ? ["cn.biz.host"] : ["cn.biz.plan"],
			steps: [
				"Name self-declaration (名称自主申报) with the first available name",
				company ? "Fill the approved scope, shareholder, capital and articles" : "Fill the approved scope, operator and personal/family operation; do not fill company shareholder or registered-capital fields",
				hosted ? "Use the exact address and address-use documents supplied by the host, with no added spaces or omissions" : "Use the actual premises and the address-use evidence required locally; residential property may need additional site proof",
				"Electronic signature and face check on your phone",
				"Download the electronic business licence; order the seals through the same service if offered",
				company ? "Check beneficial-owner filing (受益所有人备案); a small all-natural-person company may qualify for a declaration exemption only if all official conditions hold" : "Individual businesses do not file beneficial-owner information (受益所有人备案)",
			],
			takes: "often the same day to a few working days (Nansha advertises same-day licences for one-person companies)",
			sources: [GD_PORTAL, NANSHA_OPC, BENEFICIAL_OWNER],
		},
		{
			id: "cn.biz.bank",
			track: "business",
			bundle: "preflight",
			type: "identity",
			who: "you",
			title: company ? "Open the company bank account (基本存款账户)" : "Confirm the individual business's settlement account requirements",
			where: company ? "the bank's published application channel; ask which steps require the legal representative in person" : "the chosen payment product's official onboarding rules; the bank if a business account is required",
			after: ["cn.biz.register"],
			steps: [
				company ? "Obtain the bank's material list and fees; prepare the licence, ID, seals and address documents" : "WeChat Pay accepts the operator's own personal account or a business account for an individual business; confirm the particular Alipay product separately",
				"The bank may check the registered address; tell the host in advance",
				"If opening an account, set up online banking and the tax-payment arrangement supported by the tax bureau; record the actual settlement-account holder",
			],
			takes: "1–7 working days, depending on the bank",
			note: company ? "Use the company account for business receipts and payments and keep clear records. Genuine shareholder advances and reimbursements need supporting evidence; personal expenses are not company costs." : "Do not order a company bank account automatically. Keep business income and costs traceable even when the product accepts the operator's personal account.",
			sources: [WECHAT_SETTLEMENT],
		},
		{
			id: "cn.biz.tax",
			track: "business",
			bundle: "preflight",
			type: "console",
			who: "you, with an accountant if needed",
			title: "Confirm tax setup, records and filing dates",
			where: "the provincial electronic tax bureau (电子税务局)",
			after: ["cn.biz.register"],
			steps: [
				"Log in as the business and confirm its registered taxes, taxpayer type and assigned filing periods; do not infer them from having no revenue",
				"Arrange accurate records and required returns yourself or through a qualified bookkeeping service; paid outsourcing is optional. No sales does not automatically mean every return is zero",
				"Use the tax bureau's calendar for actual monthly/quarterly due dates and holiday adjustments; do not hard-code the 15th for every return",
				company ? "For a calendar-year company, the annual corporate-income-tax settlement normally runs through the end of May; confirm the applicable notice" : "For the operator's business income, annual settlement is normally due by 31 March of the following year; confirm the applicable notice",
				"The market-regulation annual report (年报), normally 1 January to 30 June, is a separate obligation from tax returns",
			],
			takes: "depends on the tax setup and who keeps the books",
			note: "Business AI subscriptions can be costs with the required evidence; this is not a deduction from the owner's personal comprehensive income. Profit distributions and liquidation have separate tax treatment. Read references/guangzhou-business-registration.md.",
			sources: [src("https://tianjin.chinatax.gov.cn/11200000000/0300/030005/p20240202103825878.shtml", "2026-11-11"), src("https://tianjin.chinatax.gov.cn/11200000000/0300/030005/20210209163048703.shtml", "2026-11-11")],
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
	const filing = ["cn.account.realname", "tencent.login", "cn.domain.realname", "cn.filing.prepare", ...(app ? ["cn.app.prepare"] : [])];
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
		{
			// Same id as the Tencent adapters' login step, so it merges with theirs and sits here in the route.
			id: "tencent.login",
			track: "account",
			bundle: "preflight",
			type: "consent",
			who: "you",
			title: "Sign in to Tencent Cloud's CLI once",
			where: "your terminal (the agent opens it for you)",
			after: ["cn.account.realname"],
			steps: ["The agent runs tccli auth login; a browser page opens", "Approve it; the agent checks the sign-in and does the rest"],
			takes: "a minute",
			closedBy: "tencent.login",
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
								p.subject === "company" ? "Company settlement uses the company bank account" : "For WeChat Pay, an individual business may use the operator's personal account or a business account; verify the Alipay product's account rules separately",
								"The app's filed domain and the iOS app's name are asked for, so this comes after the filing",
								"The agent wires the API keys and certificates through secure-key-handoff, then the payment callbacks",
								has(p, "ios-app") ? "Digital services bought inside the iOS app still go through Apple's in-app purchase" : "",
							].filter(Boolean)
						: [
								"Check the specific product's merchant-category requirements; a personal login or micro-merchant route does not establish eligibility for website/API payment collection",
								has(p, "ios-app") ? "In the iOS app, digital services can be sold through Apple's in-app purchase under your developer account" : "Look at platforms that collect on your behalf",
								"Set subject to company or individual-business in profile: to add the registration steps",
							],
					needs: "adviser: whether selling online needs a commercial licence (B25) for your service",
					sources: [WECHAT_SETTLEMENT],
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
		// Tencent also accepts legal-representative verification; a bank account is not
		// a universal prerequisite. The licence must exist before business verification.
		const account = all.find((g) => g.id === "cn.account.realname");
		account.after = [...(account.after ?? []), "cn.biz.register"];
		account.steps[1] = "企业认证: follow the options offered for this subject, including legal-representative WeChat/face verification; use bank-transfer verification only if selected or required";
		account.sources = [...account.sources, TENCENT_AUTH];
		const apple = all.find((g) => g.id === "apple.developer");
		if (apple && p.subject === "company") {
			// The app is published under the business, so Apple enrolment is as an organisation, after registration.
			apple.after = [...(apple.after ?? []), "cn.biz.register"];
			apple.title = "Enrol in the Apple Developer Program as an organisation (the business)";
			apple.steps = [
				"Look up or request the business's D-U-N-S number with Apple's free lookup tool (a new one can take several days)",
				"developer.apple.com → Enroll → Organization, with the business's legal name exactly as on the licence",
				"Check the organisation's actual eligibility and current Apple requirements before paying; then the agent creates the bundle ID and distribution certificate",
			];
			apple.sources = [...(apple.sources ?? []), APPLE_ENTITY];
		} else if (apple) {
			apple.note = "A sole proprietor/individual business enrols with Apple as an individual, not an organisation. Apple may display the individual's legal name; confirm this before payment.";
			apple.sources = [...(apple.sources ?? []), APPLE_ENTITY];
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
