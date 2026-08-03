import { withPermission } from '@core/auth/session';
import { listProjects, createProject } from '@tasks';

export const GET = withPermission('nav:tasks', listProjects);
export const POST = withPermission('manage_tasks', createProject);
