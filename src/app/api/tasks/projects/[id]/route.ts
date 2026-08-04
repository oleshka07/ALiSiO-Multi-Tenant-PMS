import { withPermission } from '@core/auth/session';
import { getProject, updateProject, deleteProject } from '@tasks';

export const GET = await withPermission('nav:tasks', getProject);
export const PATCH = await withPermission('manage_tasks', updateProject);
export const DELETE = await withPermission('manage_tasks', deleteProject);
