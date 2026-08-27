import { withModule } from '@core/auth/session';
import { listTags, createTag } from '@tasks';

export const GET = await withModule('tasks', 'nav:tasks', listTags);
export const POST = await withModule('tasks', 'manage_tasks', createTag);
