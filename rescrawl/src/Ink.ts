import type { Brush, BrushPaths } from "./brush/Brush.ts";
import { Centerline } from "./centerline/Centerline.ts";
import type { CenterlineFit } from "./centerline/fit.ts";
import { setSpeedPressure } from "./brush/pressure.ts";
import type { Point3 } from "./math.ts";
import type { InkOptions } from "./options.ts";

// one per stroke
export class Ink {
  fit: CenterlineFit = { samples: [], nodes: [], settled: 0 };

  private line: Centerline;
  private brush: Brush;
  private options: InkOptions;
  private speedPressure: boolean | null = null;

  constructor(brush: Brush, options: InkOptions = {}) {
    this.brush = brush;
    this.options = options;
    this.line = new Centerline([], options);
  }

  update(point: Point3) {
    this.speedPressure ??= this.options.pressure === "speed" || point.p === undefined;
    this.line.update(point);
  }

  // tOpen: the time now, the pen still down
  draw(tOpen: number): BrushPaths {
    return this.paint(this.line.fit(tOpen));
  }

  end(): BrushPaths {
    return this.paint(this.line.end());
  }

  private paint(fit: CenterlineFit): BrushPaths {
    this.fit = fit;
    if (this.speedPressure) setSpeedPressure(fit.samples, this.options);
    return this.brush.draw(fit);
  }
}
