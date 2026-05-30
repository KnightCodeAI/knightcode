import { describe, expect, test, beforeEach } from "bun:test";
import {
  buildTaskNotification,
  enqueueNotification,
  drainNotifications,
  dequeueNotification,
  resetNotifications,
} from "./notifications";

beforeEach(() => resetNotifications());

describe("task notifications", () => {
  test("builds the knightcode <task_notification> shape", () => {
    const msg = buildTaskNotification({
      taskId: "a1",
      description: "ship audit",
      status: "completed",
      finalMessage: "all clear",
      outputFile: "/tmp/a1.txt",
    });
    expect(msg).toContain("<task_notification>");
    expect(msg).toContain("<task_id>a1</task_id>");
    expect(msg).toContain("<status>completed</status>");
    expect(msg).toContain('Agent "ship audit" completed');
    expect(msg).toContain("<result>all clear</result>");
    expect(msg).toContain("<output_file>/tmp/a1.txt</output_file>");
  });

  test("dedups by taskId", () => {
    enqueueNotification("a1", "msg one");
    enqueueNotification("a1", "msg two");
    expect(drainNotifications()).toEqual(["msg one"]);
    expect(drainNotifications()).toEqual([]);
  });

  test("dequeue returns oldest first", () => {
    enqueueNotification("a1", "one");
    enqueueNotification("a2", "two");
    expect(dequeueNotification()).toBe("one");
    expect(dequeueNotification()).toBe("two");
    expect(dequeueNotification()).toBeUndefined();
  });
});
