import { access, cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function prepareStandaloneAssets(
  projectRoot = process.cwd(),
): Promise<void> {
  const standaloneRoot = resolve(projectRoot, ".next/standalone");
  const serverEntry = resolve(standaloneRoot, "server.js");
  await access(serverEntry);

  const copies = [
    {
      source: resolve(projectRoot, "public"),
      destination: resolve(standaloneRoot, "public"),
    },
    {
      source: resolve(projectRoot, ".next/static"),
      destination: resolve(standaloneRoot, ".next/static"),
    },
  ];

  for (const { source, destination } of copies) {
    await rm(destination, { force: true, recursive: true });
    await mkdir(resolve(destination, ".."), { recursive: true });
    await cp(source, destination, { force: true, recursive: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  prepareStandaloneAssets().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Standalone preparation failed.",
    );
    process.exitCode = 1;
  });
}
