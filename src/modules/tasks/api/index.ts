// ─── Public API of the tasks module ──────────────────────────────────────
export { listTasks, createTask, getTask, updateTask, deleteTask } from './tasks.handlers';
export { listProjects, createProject, getProject, updateProject, deleteProject } from './projects.handlers';
export { listTags, createTag, getTag, updateTag, deleteTag } from './tags.handlers';
export { listTaskAttachments, uploadTaskAttachment, deleteTaskAttachment } from './attachments.handlers';
export type { Task, TaskProject, TaskTag, TaskStatus, TaskPriority } from '../domain/types';
export { TASK_STATUS_CONFIG, TASK_PRIORITY_CONFIG } from '../domain/types';

// For screens that need only the numbers. Callers used to import from
// ../data directly, which is what the module boundary exists to stop.
export { getTasksSummary } from '../data/summary.repo';
export type { TasksSummary } from '../data/summary.repo';
