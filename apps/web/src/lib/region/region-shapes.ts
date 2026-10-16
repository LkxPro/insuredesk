import type { LngLat } from "./region-centers";
import { REGION_SHAPES_TEXT } from "./region-shapes-data";

export type Ring = readonly LngLat[];

const SCALE = 300;

function parseShapes(): ReadonlyMap<string, readonly Ring[]> {
  const shapes = new Map<string, Ring[]>();
  for (const line of REGION_SHAPES_TEXT.split("\n")) {
    if (!line) continue;
    const [code = "", ...encodedRings] = line.split("|");
    shapes.set(
      code,
      encodedRings.map((encoded) => {
        let x = 0;
        let y = 0;
        return encoded.split(" ").map((pair, index) => {
          const [dx = 0, dy = 0] = pair.split(",").map(Number);
          x = index === 0 ? dx : x + dx;
          y = index === 0 ? dy : y + dy;
          return [x / SCALE, y / SCALE] as const;
        });
      }),
    );
  }
  return shapes;
}

export const REGION_SHAPES: ReadonlyMap<string, readonly Ring[]> = parseShapes();
