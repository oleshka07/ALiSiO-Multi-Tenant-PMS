import { listTaskAttachments, uploadTaskAttachment, deleteTaskAttachment } from '@tasks';

export const GET = listTaskAttachments;
export const POST = uploadTaskAttachment;
export const DELETE = deleteTaskAttachment;
