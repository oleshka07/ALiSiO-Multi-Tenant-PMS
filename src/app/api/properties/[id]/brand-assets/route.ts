// Зображення обʼєкта за ролями (0421): лого, лого для темного тла,
// обкладинка. Їх читають гостьовий застосунок і аркуш A4.
import { listBrandAssets, saveBrandAsset } from '@properties/brand-assets.handlers';

export const GET = listBrandAssets;
export const PUT = saveBrandAsset;
