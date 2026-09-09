import { classicEngine } from "./classic";
import { fitEngine } from "./fit";
import { greedyEngine } from "./greedy";
import { sampledEngine } from "./sampled";
import { tensionEngine } from "./tension";
import type { Contact, OutlineEngine, Point4, RenderOptions } from "./types";

export type Shape = {
  nodes: Point4[];
  outline: Contact[]; // closed loop
  spine: string; // the centerline as path data, for the debug views
};

export type Engine = (distinct: Point4[], o: Required<RenderOptions>) => Shape;

export const ENGINES: Record<OutlineEngine, Engine> = {
  fit: fitEngine,
  sampled: sampledEngine,
  greedy: greedyEngine,
  tension: tensionEngine,
  classic: classicEngine,
};
