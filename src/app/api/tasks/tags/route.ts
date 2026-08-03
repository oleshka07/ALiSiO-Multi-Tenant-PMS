import { withPermission } from '@core/auth/session';
import { listTags, createTag } from '@tasks';

export const GET = withPermission('nav:tasks', listTags);
export const POST = withPermission('manage_tasks', createTag);
