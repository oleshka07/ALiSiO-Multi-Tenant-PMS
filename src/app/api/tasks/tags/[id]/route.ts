import { withPermission } from '@core/auth/session';
import { getTag, updateTag, deleteTag } from '@tasks';

export const GET = await withPermission('nav:tasks', getTag);
export const PATCH = await withPermission('manage_tasks', updateTag);
export const DELETE = await withPermission('manage_tasks', deleteTag);
