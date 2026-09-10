import { greedyEngine } from "./greedy.ts";
import type { Contact, FitNode, OutlineEngine, Point4, RenderOptions } from "./types.ts";

// An engine decides how to lay contacts on the envelope; `fitCurve` gives it
// the nodes. To try a variant, write another `(distinct, o) => Shape`, add it
// below, and add its name to `OutlineEngine` -- everything else follows.
export type Shape = {
  nodes: FitNode[];
  outline: Contact[]; // closed loop
};

export type Engine = (distinct: Point4[], o: Required<RenderOptions>) => Shape;

export const ENGINES: Record<OutlineEngine, Engine> = {
  greedy: greedyEngine,
};
