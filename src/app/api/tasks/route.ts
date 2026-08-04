import { withPermission } from '@core/auth/session';
import { listTasks, createTask } from '@tasks';

export const GET = await withPermission('nav:tasks', listTasks);
export const POST = await withPermission('manage_tasks', createTask);
