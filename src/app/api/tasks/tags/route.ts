import { withPermission } from '@core/auth/session';
import { listTags, createTag } from '@tasks';

export const GET = await withPermission('nav:tasks', listTags);
export const POST = await withPermission('manage_tasks', createTag);
