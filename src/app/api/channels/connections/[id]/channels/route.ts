import { listConnectionChannels, refreshConnectionChannels } from '@channels';

export const GET = listConnectionChannels;
// POST — «перечитати», а не «записати»: запис мапінгу з нашого боку це
// ЧЕКПОІНТ рецензента (К2), і маршруту для нього немає навмисно.
export const POST = refreshConnectionChannels;
