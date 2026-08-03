import { withPermission } from '@core/auth/session';
import { getProject, updateProject, deleteProject } from '@tasks';

export const GET = withPermission('nav:tasks', getProject);
export const PATCH = withPermission('manage_tasks', updateProject);
export const DELETE = withPermission('manage_tasks', deleteProject);
