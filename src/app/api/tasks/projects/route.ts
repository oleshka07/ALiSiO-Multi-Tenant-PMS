import { withPermission } from '@core/auth/session';
import { listProjects, createProject } from '@tasks';

export const GET = await withPermission('nav:tasks', listProjects);
export const POST = await withPermission('manage_tasks', createProject);
