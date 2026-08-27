import { withModule } from '@core/auth/session';
import { getProject, updateProject, deleteProject } from '@tasks';

export const GET = await withModule('tasks', 'nav:tasks', getProject);
export const PATCH = await withModule('tasks', 'manage_tasks', updateProject);
export const DELETE = await withModule('tasks', 'manage_tasks', deleteProject);
