/**
 * A throwaway copy of the fixture article for the dev server to serve.
 *
 * The spec edits pages and uploads files; doing that to `packages/core/test/fixture` would leave
 * the repo dirty and would make the unit suites depend on whether the e2e lane had run.
 */
import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const ARTICLE = fileURLToPath(new URL(".tmp/article/", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../packages/core/test/fixture/", import.meta.url));

export default async function globalSetup(): Promise<void> {
  await rm(ARTICLE, { recursive: true, force: true });
  await mkdir(ARTICLE, { recursive: true });
  await cp(FIXTURE, ARTICLE, { recursive: true });
}
