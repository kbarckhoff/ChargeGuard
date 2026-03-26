"use client";

import { useState, useTransition } from "react";
import { updateTaskStatus } from "@/app/actions";
import { Check, Loader2 } from "lucide-react";
import type { AuditTask, TaskStatus } from "@/types";

export function TaskList({ tasks }: { tasks: AuditTask[] }) {
  return (
    <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
      {tasks.map((task) => (
        <TaskItem key={task.id} task={task} />
      ))}
    </div>
  );
}

function TaskItem({ task }: { task: AuditTask }) {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const done = status === "completed";

  const toggle = () => {
    const newStatus: TaskStatus = done ? "pending" : "completed";
    setStatus(newStatus);
    startTransition(async () => {
      try {
        await updateTaskStatus(task.id, newStatus);
      } catch {
        setStatus(task.status); // revert
      }
    });
  };

  return (
    <div
      onClick={toggle}
      className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border transition-colors cursor-pointer ${
        done ? "border-emerald-200 bg-emerald-50/30" : "border-[#e5e5e0] hover:bg-[#fafaf8]"
      } ${isPending ? "opacity-60" : ""}`}
    >
      <div
        className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 mt-0.5 ${
          done ? "bg-emerald-500" : "border-2 border-[#d5d5d0]"
        }`}
      >
        {isPending ? (
          <Loader2 size={10} className="animate-spin text-white" />
        ) : done ? (
          <Check size={12} className="text-white" />
        ) : null}
      </div>
      <div className="flex-1 min-w-0">
        <span className={`text-sm ${done ? "text-[#7a7a75] line-through" : "text-[#3d3d3a]"}`}>
          {task.title}
        </span>
        {task.description && (
          <p className="text-xs text-[#9a9a95] mt-0.5 line-clamp-2">{task.description}</p>
        )}
      </div>
    </div>
  );
}
