import type { CenterlineNode, FitOptions } from "./centerline/fit.ts";
import type { Point4 } from "./math.ts";
import type { OutlineNode } from "./outline/contact.ts";
import { greedyEngine, type GreedyOptions } from "./outline/greedy.ts";

// An engine decides how to lay contacts on the envelope; `fitCurve` gives it
// the nodes. To try a variant, write another `(distinct, o) => Shape`, add it
// below, and add its name to `OutlineEngine` -- everything else follows.
export type Shape = {
  centerline: CenterlineNode[];
  outline: OutlineNode[]; // closed loop
};

export type Engine = (distinct: Point4[], o: Required<FitOptions & GreedyOptions>) => Shape;

// One today.
export type OutlineEngine = "greedy";

export const ENGINES: Record<OutlineEngine, Engine> = {
  greedy: greedyEngine,
};
