import { withModule } from '@core/auth/session';
import { getTag, updateTag, deleteTag } from '@tasks';

export const GET = await withModule('tasks', 'nav:tasks', getTag);
export const PATCH = await withModule('tasks', 'manage_tasks', updateTag);
export const DELETE = await withModule('tasks', 'manage_tasks', deleteTag);
