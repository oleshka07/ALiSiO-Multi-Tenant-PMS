import { withPermission } from '@core/auth/session';
import { getTask, updateTask, deleteTask } from '@tasks';

export const GET = withPermission('nav:tasks', getTask);
export const PATCH = withPermission('manage_tasks', updateTask);
export const DELETE = withPermission('manage_tasks', deleteTask);
