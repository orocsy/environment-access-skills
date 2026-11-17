import cnMainland from "./cn-mainland.mjs";

// jurisdiction in stack.yaml → its compliance pack. Add a place by adding one file here.
export const packs = Object.fromEntries([cnMainland].map((p) => [p.jurisdiction, p]));
