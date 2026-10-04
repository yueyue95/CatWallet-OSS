import { spawnSync } from "node:child_process";

const allowedAdvisory = "GHSA-vfj7-8cjw-p6xm";
const allowedPath =
  ".>eslint-config-next>@next/eslint-plugin-next>fast-glob>micromatch>braces";

function runAudit(args) {
  const pnpmPath = process.env.npm_execpath;
  if (!pnpmPath) {
    throw new Error("pnpm execution path is unavailable");
  }

  const result = spawnSync(
    process.execPath,
    [pnpmPath, "audit", "--json", ...args],
    {
      encoding: "utf8",
    },
  );

  if (result.error) {
    throw result.error;
  }

  const output = result.stdout || result.stderr;
  if (!output) {
    throw new Error("pnpm audit returned no JSON output");
  }

  return JSON.parse(output);
}

function totalVulnerabilities(report) {
  return Object.values(report.metadata.vulnerabilities).reduce(
    (total, count) => total + count,
    0,
  );
}

const productionReport = runAudit(["--prod"]);
if (totalVulnerabilities(productionReport) !== 0) {
  throw new Error(
    "Production dependency audit must contain zero vulnerabilities",
  );
}

const fullReport = runAudit([]);
const advisories = Object.values(fullReport.advisories ?? {});
const vulnerabilities = fullReport.metadata.vulnerabilities;

if (
  advisories.length !== 1 ||
  vulnerabilities.high !== 1 ||
  vulnerabilities.critical !== 0 ||
  totalVulnerabilities(fullReport) !== 1
) {
  throw new Error("Full audit differs from the single approved High advisory");
}

const advisory = advisories[0];
const findings = advisory.findings ?? [];
if (
  advisory.github_advisory_id !== allowedAdvisory ||
  advisory.module_name !== "braces" ||
  advisory.severity !== "high" ||
  findings.length !== 1 ||
  findings[0].dev !== true ||
  findings[0].paths?.length !== 1 ||
  findings[0].paths[0] !== allowedPath
) {
  throw new Error(
    "The audit finding does not match the approved dev-only path",
  );
}

console.log("Production-only audit: 0 vulnerabilities");
console.log(
  `Full audit: 1 High / 0 Critical (${allowedAdvisory}, ESLint dev toolchain only)`,
);
