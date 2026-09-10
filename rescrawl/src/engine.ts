import { fitEngine } from "./fit.ts";
import { greedyEngine } from "./greedy.ts";
import { sampledEngine } from "./sampled.ts";
import type { Contact, FitNode, OutlineEngine, Point4, RenderOptions } from "./types.ts";

// Every engine runs `fitCurve` for its nodes, so they all hand back the same
// node type; they differ only in how stage 4 wraps an outline around it. The
// centerline as path data is not returned: it is `fitPath(nodes)`, and only
// the debug views want it.
export type Shape = {
  nodes: FitNode[];
  outline: Contact[]; // closed loop
};

export type Engine = (distinct: Point4[], o: Required<RenderOptions>) => Shape;

export const ENGINES: Record<OutlineEngine, Engine> = {
  fit: fitEngine,
  sampled: sampledEngine,
  greedy: greedyEngine,
};
