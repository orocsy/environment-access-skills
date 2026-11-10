import cloudflare from "./cloudflare.mjs";
import awsEc2Docker from "./aws-ec2-docker.mjs";
import { dockerPostgres, dockerRedis } from "./docker.mjs";
import vercel from "./vercel.mjs";
import github from "./github.mjs";
import resend from "./resend.mjs";
import stripe from "./stripe.mjs";
import googleOauth from "./google-oauth.mjs";
import { dnspod, lighthouse } from "./tencent.mjs";

// provider name in stack.yaml → adapter. Add a provider by adding one file here.
export const adapters = Object.fromEntries(
	[cloudflare, awsEc2Docker, dockerPostgres, dockerRedis, vercel, github, resend, stripe, googleOauth, dnspod, lighthouse].map((a) => [a.provider, a]),
);
