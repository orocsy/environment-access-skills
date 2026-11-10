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

export const missingAnswers = (stack) => INTERVIEW.filter((q) => stack.profile?.[q.key] === undefined);

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
					title: "Decide how to take payments",
					steps: [
						"A person (no business) can't open a WeChat Pay or Alipay merchant account; those need an individual business (个体工商户) or a company",
						has(p, "ios-app") ? "In the iOS app, digital services can be sold through Apple's in-app purchase under your developer account" : "Look at platforms that collect on your behalf",
						"Setting up a business isn't covered here; see the payments note in docs/stack-setup/china-mainland.md",
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
	return list.filter(Boolean).map((g, seq) => ({ ...g, seq, pack: "cn-mainland" }));
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
