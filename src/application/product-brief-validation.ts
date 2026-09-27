import { ApplicationError } from "../domain/errors.js";
import type { ProductBriefJson } from "../domain/models.js";

export function validateProductBrief(brief: ProductBriefJson): ProductBriefJson {
  if (!brief || typeof brief !== "object") {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Product Brief must be an object."
    );
  }
  if (typeof brief.product_goal !== "string" || !brief.product_goal.trim()) {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Product Brief product_goal is required."
    );
  }
  assertArray(brief.target_users, "target_users");
  assertArray(brief.pain_points, "pain_points");
  assertArray(brief.core_workflows, "core_workflows");
  for (const field of [
    "mvp_scope",
    "non_goals",
    "success_metrics",
    "risks",
    "open_questions"
  ] as const) {
    assertStringArray(brief[field], field);
  }
  for (const user of brief.target_users) {
    assertStringField(user, "name", "target_users");
    assertStringField(user, "description", "target_users");
  }
  for (const painPoint of brief.pain_points) {
    assertStringField(painPoint, "title", "pain_points");
    assertStringField(painPoint, "description", "pain_points");
  }
  for (const workflow of brief.core_workflows) {
    assertStringField(workflow, "title", "core_workflows");
    assertStringArray(workflow.steps, "core_workflows.steps");
  }
  return { ...brief, product_goal: brief.product_goal.trim() };
}

function assertArray(value: unknown, field: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      `Product Brief ${field} must be an array.`
    );
  }
}

function assertStringArray(
  value: unknown,
  field: string
): asserts value is string[] {
  assertArray(value, field);
  if (!value.every(item => typeof item === "string")) {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      `Product Brief ${field} must contain only strings.`
    );
  }
}

function assertStringField(
  value: unknown,
  field: string,
  parent: string
): void {
  if (
    typeof value !== "object" ||
    value === null ||
    !(field in value) ||
    typeof value[field as keyof typeof value] !== "string"
  ) {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      `Product Brief ${parent}.${field} must be a string.`
    );
  }
}
