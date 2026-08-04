import { withPermission } from '@core/auth/session';
import { getTask, updateTask, deleteTask } from '@tasks';

export const GET = await withPermission('nav:tasks', getTask);
export const PATCH = await withPermission('manage_tasks', updateTask);
export const DELETE = await withPermission('manage_tasks', deleteTask);
