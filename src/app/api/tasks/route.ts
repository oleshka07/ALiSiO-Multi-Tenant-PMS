import { withPermission } from '@core/auth/session';
import { listTasks, createTask } from '@tasks';

export const GET = withPermission('nav:tasks', listTasks);
export const POST = withPermission('manage_tasks', createTask);
