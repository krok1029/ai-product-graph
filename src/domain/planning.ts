// 規劃內容採用 to-spec 的決策結構；階段以成果與退出條件定義。
import { z } from "zod";

const text = z.string().trim().min(1);
const items = z.array(text);
export const milestoneContentSchema = z.object({
  outcome: text,
  exit_criteria: items.min(1),
  sequence: z.number().int().positive(),
  scope: items.min(1),
  non_goals: items
}).strict();
export const specContentSchema = z.object({
  problem_statement: text,
  solution: text,
  user_stories: items.min(1),
  implementation_decisions: items,
  testing_decisions: items.min(1),
  out_of_scope: items,
  further_notes: items
}).strict();
export const planningContentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("milestone"), content: milestoneContentSchema }).strict(),
  z.object({ type: z.literal("spec"), content: specContentSchema }).strict()
]);
export type PlanningContent = z.infer<typeof planningContentSchema>;
