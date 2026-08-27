import { withModule } from '@core/auth/session';
import { listTasks, createTask } from '@tasks';

export const GET = await withModule('tasks', 'nav:tasks', listTasks);
export const POST = await withModule('tasks', 'manage_tasks', createTask);
