import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const stylePath = /^web\/src\/(?:components\/[^\0\r\n]+|app\/globals)\.css$/;
const imagePath = /^web\/public\/[^\0\r\n]+\.(?:png|jpg|jpeg|webp|ico)$/;
const documentationPath =
  /^(?:docs\/[^\0\r\n]+\.(?:md|png|jpg|jpeg|webp|ico)|README\.md)$/;
const iconUrl =
  /^\/(?:apple-touch-icon|pwa-icon(?:-maskable)?-(?:192|512))-v[1-9]\d*\.png$/;
const manifestUrl = /^\/manifest\.json\?v=home-icon-v[1-9]\d*$/;
const gitRead = (args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

function normalizeIconUrl(value) {
  return typeof value === "string" &&
    (iconUrl.test(value) || manifestUrl.test(value))
    ? value.replace(/-v[1-9]\d*(?=\.png$|$)/, "-vVERSION")
    : value;
}

function normalizeBrandingContent(file, source) {
  if (file === "web/public/manifest.json") {
    const manifest = JSON.parse(source);
    if (
      !manifest ||
      typeof manifest !== "object" ||
      !Array.isArray(manifest.icons) ||
      manifest.icons.length === 0 ||
      !manifest.icons.every(
        (icon) =>
          icon &&
          typeof icon === "object" &&
          !Array.isArray(icon) &&
          typeof icon.src === "string" &&
          iconUrl.test(icon.src),
      )
    )
      throw new Error("Manifest icons unavailable");
    return JSON.stringify({
      ...manifest,
      icons: manifest.icons.map((icon) => ({
        ...icon,
        src: normalizeIconUrl(icon.src),
      })),
    });
  }
  // Neutralize only complete quoted, versioned install-icon URL literals.
  // Imports, nonce handling, JSX, assertions and all other runtime code remain exact.
  return source.replace(/(["'])([^"'\r\n]*)\1/g, (literal, quote, value) =>
    normalizeIconUrl(value) === value
      ? literal
      : `${quote}${normalizeIconUrl(value)}${quote}`,
  );
}

export function requiresMigrationRehearsals(files, readVersions) {
  if (!Array.isArray(files) || files.length === 0) return true;
  return files.some((file) => {
    if (
      typeof file !== "string" ||
      file.includes("\\") ||
      /[\0\r\n]/.test(file) ||
      file
        .split("/")
        .some(
          (segment) => segment === ".." || segment === "." || segment === "",
        )
    )
      return true;
    if (
      stylePath.test(file) ||
      imagePath.test(file) ||
      documentationPath.test(file)
    )
      return false;
    if (
      ![
        "web/src/app/layout.tsx",
        "web/tests/branding.spec.ts",
        "web/public/manifest.json",
      ].includes(file) ||
      !readVersions
    )
      return true;
    try {
      const [before, after] = readVersions(file);
      if (
        typeof before !== "string" ||
        typeof after !== "string" ||
        !before ||
        !after ||
        before === after
      )
        return true;
      return (
        normalizeBrandingContent(file, before) !==
        normalizeBrandingContent(file, after)
      );
    } catch {
      return true;
    }
  });
}

export function rehearsalScope(base, head, git = gitRead) {
  try {
    if (
      ![base, head].every(
        (sha) => /^[a-f0-9]{40}$/.test(sha ?? "") && !/^0+$/.test(sha),
      )
    )
      return true;
    if (
      git(["rev-parse", "--verify", `${base}^{commit}`]).trim() !== base ||
      git(["rev-parse", "--verify", `${head}^{commit}`]).trim() !== head
    )
      return true;
    const output = git([
      "diff",
      "--no-renames",
      "--name-only",
      "-z",
      base,
      head,
      "--",
    ]);
    if (!output.endsWith("\0")) return true;
    return requiresMigrationRehearsals(
      output.slice(0, -1).split("\0"),
      (file) => [
        git(["show", `${base}:${file}`]),
        git(["show", `${head}:${file}`]),
      ],
    );
  } catch {
    return true;
  }
}

export function localMigrationToolingRequired(git = gitRead) {
  try {
    // Only a clean committed candidate with a resolvable integration base can omit tooling.
    // Dirty/untracked files, missing history and empty scope retain the full gate.
    if (git(["status", "--porcelain"]).trim()) return true;
    return rehearsalScope(
      git(["rev-parse", "--verify", "origin/main^{commit}"]).trim(),
      git(["rev-parse", "--verify", "HEAD^{commit}"]).trim(),
      git,
    );
  } catch {
    return true;
  }
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const full = rehearsalScope(process.env.REHEARSAL_BASE_SHA, head);
  if (!process.env.GITHUB_OUTPUT)
    throw new Error("Workflow output destination required");
  appendFileSync(process.env.GITHUB_OUTPUT, `full=${full}\n`);
  console.log(
    full
      ? "Full migration rehearsals required"
      : "Proven presentation/docs-only diff: historical rehearsals omitted; security/schema checks retained",
  );
}
