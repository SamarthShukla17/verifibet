import { ImageResponse } from "next/og";

/**
 * Same ✓-in-shield mark as `app/icon.svg` (that file's own doc comment
 * covers the design), rendered as a PNG via `ImageResponse` — Apple's
 * touch-icon convention doesn't support SVG, only raster. The shield
 * itself is plain embedded SVG markup inside the JSX tree; Satori (what
 * `ImageResponse` renders with) passes raw `<svg>`/`<path>` elements
 * through directly rather than needing them reimplemented as flexbox
 * divs.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "hsl(222, 47%, 6%)",
        }}
      >
        <svg width="140" height="140" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M16 5 L24 8 V15 C24 21.5 20.5 25.5 16 27 C11.5 25.5 8 21.5 8 15 V8 Z"
            fill="hsl(160, 84%, 39%)"
          />
          <path
            d="M11.5 16 L14.5 19 L20.5 12"
            fill="none"
            stroke="hsl(222, 47%, 6%)"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    ),
    { ...size },
  );
}
