import { join } from "node:path";

// Optional asset maintenance; regular builds use the committed PNG files.
// FFmpeg's SVG decoder requires librsvg support.
const directory = new URL("../public/icon/", import.meta.url).pathname;
for (const size of [16, 32, 48, 96, 128]) {
  const result = Bun.spawnSync([
    "ffmpeg",
    "-v",
    "error",
    "-y",
    "-i",
    join(directory, "icon.svg"),
    "-vf",
    `scale=${size}:${size}:flags=lanczos`,
    "-frames:v",
    "1",
    "-update",
    "1",
    "-metadata",
    "comment=Original Viewer Companion VC monogram; rasterized from public/icon/icon.svg.",
    join(directory, `${size}.png`),
  ]);
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}
