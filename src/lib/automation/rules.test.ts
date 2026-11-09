import { describe, expect, it } from "vitest";
import { Action, RuleInput, Trigger, describeRule, eventForActivity } from "./rules";

describe("automation rules", () => {
  it("describes a rule in one line", () => {
    expect(
      describeRule({
        trigger: { kind: "status_changed", to: "Done" },
        condition: "priority >= high",
        actions: [{ kind: "add_label", label: "shipped" }, { kind: "notify", to: "watchers", person: "", message: "Done!" }],
      }),
    ).toBe("When the status changes to Done, if priority >= high: add the label shipped, email its watchers.");
    expect(describeRule({ trigger: { kind: "due_soon", days: 1 }, condition: "", actions: [{ kind: "set_priority", priority: "high" }] })).toBe(
      "When a card is due in 1 day: set priority high.",
    );
  });
  it("maps card activity to the events rules listen for", () => {
    expect(eventForActivity("created")).toEqual({ trigger: "card_created" });
    expect(eventForActivity("status")).toEqual({ trigger: "status_changed" });
    expect(eventForActivity("label")).toEqual({ trigger: "field_changed", field: "label" });
    expect(eventForActivity("field")).toEqual({ trigger: "field_changed", field: "custom" });
    expect(eventForActivity("description")).toBeNull();
    expect(eventForActivity("link")).toBeNull();
  });
  it("validates rules", () => {
    expect(Trigger.safeParse({ kind: "due_soon", days: 99 }).success).toBe(false);
    expect(Action.safeParse({ kind: "add_comment", text: "" }).success).toBe(false);
    expect(RuleInput.safeParse({ name: "x", boardId: null, trigger: { kind: "card_created" }, actions: [] }).success).toBe(false);
    expect(RuleInput.safeParse({ name: "x", boardId: null, trigger: { kind: "card_created" }, actions: [{ kind: "set_due", days: 3 }] }).success).toBe(true);
  });
});
