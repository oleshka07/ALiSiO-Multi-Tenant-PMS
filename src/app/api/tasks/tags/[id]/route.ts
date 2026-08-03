import { withPermission } from '@core/auth/session';
import { getTag, updateTag, deleteTag } from '@tasks';

export const GET = withPermission('nav:tasks', getTag);
export const PATCH = withPermission('manage_tasks', updateTag);
export const DELETE = withPermission('manage_tasks', deleteTag);
