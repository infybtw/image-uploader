import manifest from "../extension/manifest.json";
import metadata from "../package.json";

export function checkReleaseVersion(
  tag?: string,
  packageVersion = metadata.version,
  extensionVersion = manifest.version,
) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(packageVersion)) {
    throw new Error("Release version must be a stable X.Y.Z version.");
  }
  if (packageVersion.split(".").some((part) => Number(part) > 65535)) {
    throw new Error("Browser extension version components must not exceed 65535.");
  }
  if (packageVersion !== extensionVersion) {
    throw new Error("package.json and extension/manifest.json versions must match.");
  }
  if (tag !== undefined && tag !== `v${packageVersion}`) {
    throw new Error(`Release tag must be v${packageVersion}, received ${tag}.`);
  }
  return packageVersion;
}

if (import.meta.main) console.log(checkReleaseVersion(Bun.argv[2]));
