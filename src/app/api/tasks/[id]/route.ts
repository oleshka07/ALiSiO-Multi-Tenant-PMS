import { withModule } from '@core/auth/session';
import { getTask, updateTask, deleteTask } from '@tasks';

export const GET = await withModule('tasks', 'nav:tasks', getTask);
export const PATCH = await withModule('tasks', 'manage_tasks', updateTask);
export const DELETE = await withModule('tasks', 'manage_tasks', deleteTask);
