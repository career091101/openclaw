import { describe, expect, it } from "vitest";
import {
  createTaskGraph,
  addTask,
  updateTaskStatus,
  getReadyTasks,
  getTask,
  getAllTasks,
  cancelGraph,
  isGraphCompleted,
  hasFailedTasks,
  serializeGraph,
  deserializeGraph,
  getTasksByRole,
} from "../src/task-graph.js";

describe("TaskGraph", () => {
  it("creates a graph with a root task", () => {
    const graph = createTaskGraph({
      supervisorSessionKey: "agent:test:supervisor",
      rootLabel: "Plan the feature",
    });
    expect(graph.id).toBeTruthy();
    expect(graph.rootTaskId).toBeTruthy();
    expect(graph.nodes.size).toBe(1);
    expect(graph.status).toBe("active");
    const root = getTask(graph, graph.rootTaskId);
    expect(root).toBeDefined();
    expect(root!.label).toBe("Plan the feature");
    expect(root!.role).toBe("planner");
    expect(root!.status).toBe("pending");
  });

  it("adds dependent tasks", () => {
    const graph = createTaskGraph({
      supervisorSessionKey: "agent:test:supervisor",
      rootLabel: "Plan",
    });
    const planTask = getTask(graph, graph.rootTaskId)!;

    const execTask = addTask(graph, {
      label: "Execute step 1",
      role: "executor",
      dependsOn: [planTask.id],
    });
    expect(execTask.dependsOn).toContain(planTask.id);
    expect(graph.nodes.size).toBe(2);
  });

  it("rejects tasks with missing dependencies", () => {
    const graph = createTaskGraph({
      supervisorSessionKey: "agent:test:supervisor",
      rootLabel: "Plan",
    });
    expect(() =>
      addTask(graph, {
        label: "Bad task",
        role: "executor",
        dependsOn: ["nonexistent-id"],
      }),
    ).toThrow("dependency not found");
  });

  it("identifies ready tasks based on completed dependencies", () => {
    const graph = createTaskGraph({
      supervisorSessionKey: "agent:test:supervisor",
      rootLabel: "Plan",
    });

    const exec1 = addTask(graph, {
      label: "Exec 1",
      role: "executor",
      dependsOn: [graph.rootTaskId],
    });
    const exec2 = addTask(graph, {
      label: "Exec 2",
      role: "executor",
      dependsOn: [graph.rootTaskId],
    });

    // Root is pending — nothing should be ready except root
    let ready = getReadyTasks(graph);
    expect(ready.length).toBe(1);
    expect(ready[0].id).toBe(graph.rootTaskId);

    // Complete root — exec1 and exec2 should become ready
    updateTaskStatus(graph, graph.rootTaskId, "completed", "plan done");
    ready = getReadyTasks(graph);
    expect(ready.length).toBe(2);
    expect(ready.map((t) => t.id)).toContain(exec1.id);
    expect(ready.map((t) => t.id)).toContain(exec2.id);
  });

  it("updates graph status on completion", () => {
    const graph = createTaskGraph({
      supervisorSessionKey: "agent:test:supervisor",
      rootLabel: "Single task",
    });
    expect(isGraphCompleted(graph)).toBe(false);
    updateTaskStatus(graph, graph.rootTaskId, "completed");
    expect(isGraphCompleted(graph)).toBe(true);
    expect(graph.status).toBe("completed");
  });

  it("detects failed tasks", () => {
    const graph = createTaskGraph({
      supervisorSessionKey: "agent:test:supervisor",
      rootLabel: "Task",
    });
    updateTaskStatus(graph, graph.rootTaskId, "failed", undefined, "something went wrong");
    expect(hasFailedTasks(graph)).toBe(true);
    const root = getTask(graph, graph.rootTaskId)!;
    expect(root.retryCount).toBe(1);
    expect(root.error).toBe("something went wrong");
  });

  it("cancels all pending/running tasks", () => {
    const graph = createTaskGraph({
      supervisorSessionKey: "agent:test:supervisor",
      rootLabel: "Plan",
    });
    addTask(graph, { label: "Exec", role: "executor" });
    cancelGraph(graph);
    expect(graph.status).toBe("cancelled");
    const tasks = getAllTasks(graph);
    expect(tasks.every((t) => t.status === "cancelled")).toBe(true);
  });

  it("filters tasks by role", () => {
    const graph = createTaskGraph({
      supervisorSessionKey: "agent:test:supervisor",
      rootLabel: "Plan",
    });
    addTask(graph, { label: "Exec 1", role: "executor" });
    addTask(graph, { label: "Exec 2", role: "executor" });
    addTask(graph, { label: "Review", role: "critic" });
    expect(getTasksByRole(graph, "planner").length).toBe(1);
    expect(getTasksByRole(graph, "executor").length).toBe(2);
    expect(getTasksByRole(graph, "critic").length).toBe(1);
  });

  it("serializes and deserializes", () => {
    const graph = createTaskGraph({
      supervisorSessionKey: "agent:test:supervisor",
      rootLabel: "Plan",
    });
    addTask(graph, { label: "Exec", role: "executor", dependsOn: [graph.rootTaskId] });
    const json = serializeGraph(graph);
    const restored = deserializeGraph(json);
    expect(restored.id).toBe(graph.id);
    expect(restored.nodes.size).toBe(graph.nodes.size);
    expect(restored.rootTaskId).toBe(graph.rootTaskId);
    const restoredExec = Array.from(restored.nodes.values()).find((n) => n.role === "executor");
    expect(restoredExec?.dependsOn).toContain(graph.rootTaskId);
  });
});
