// Shapes of real credentials. stack.yaml, state.json and every report are checked
// against these before they are written or printed, so a key can't leak by accident.
const SECRET_SHAPES = [
	[/\b(sk|rk)_(live|test)_[A-Za-z0-9]{8,}/, "Stripe secret key"],
	[/\bwhsec_[A-Za-z0-9+/=]{8,}/, "Stripe webhook secret"],
	[/\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{8,}/, "Resend API key"],
	[/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/, "GitHub token"],
	[/\bgithub_pat_[A-Za-z0-9_]{20,}/, "GitHub token"],
	[/\bAKIA[0-9A-Z]{16}\b/, "AWS access key"],
	[/\bGOCSPX-[A-Za-z0-9_-]{10,}/, "Google client secret"],
	[/\bxox[abpr]-[A-Za-z0-9-]{10,}/, "Slack token"],
	[/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, "JWT"],
	[/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
	[/:\/\/[^\s:/@]+:[^\s@/]{6,}@/, "password inside a URL"],
];

export function findSecret(text) {
	for (const [shape, label] of SECRET_SHAPES) if (shape.test(text)) return label;
	return null;
}

// Throws naming the path of the first value that looks like a credential.
export function assertNoSecrets(value, where, path = "") {
	if (typeof value === "string") {
		const label = findSecret(value);
		if (label)
			throw new Error(
				`${where}: ${path || "value"} looks like a ${label}. Secrets never go in stack files, state or reports.`,
			);
	} else if (Array.isArray(value)) {
		value.forEach((v, i) => assertNoSecrets(v, where, `${path}[${i}]`));
	} else if (value && typeof value === "object") {
		for (const [k, v] of Object.entries(value))
			assertNoSecrets(v, where, path ? `${path}.${k}` : k);
	}
}
