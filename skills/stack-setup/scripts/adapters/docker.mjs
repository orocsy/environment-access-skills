import { GREEN, RED } from "../lib/context.mjs";
import { containers } from "./aws-ec2-docker.mjs";

// A database or cache running as a container on the app's own host.
function onHost(provider, image) {
	return {
		provider,
		tools: [],
		validate(cap, stack) {
			const host = stack.capabilities?.[cap.on];
			return host?.provider === "aws-ec2-docker" ? [] : ["on: a capability using provider aws-ec2-docker"];
		},
		gates: () => [],
		async verify(ctx, name, cap) {
			const list = await containers(ctx, cap.on);
			const found = list.find((c) => c.image.split("/").pop().startsWith(image) || c.name.includes(image));
			if (!found) return [{ id: `${name}.container`, status: RED, detail: `no ${image} container on ${cap.on}` }];
			const healthy = /^Up\b/.test(found.status) && !/unhealthy/.test(found.status);
			return [{ id: `${name}.container`, status: healthy ? GREEN : RED, detail: `${found.name} (${found.image}) ${found.status}` }];
		},
	};
}

export const dockerPostgres = onHost("docker-postgres", "postgres");
export const dockerRedis = onHost("docker-redis", "redis");
