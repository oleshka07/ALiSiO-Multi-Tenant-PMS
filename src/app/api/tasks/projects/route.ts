import { withModule } from '@core/auth/session';
import { listProjects, createProject } from '@tasks';

export const GET = await withModule('tasks', 'nav:tasks', listProjects);
export const POST = await withModule('tasks', 'manage_tasks', createProject);
