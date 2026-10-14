import type { Asset } from '~~/shared/schemas/workspace'

export function galleryAssets(assets: Asset[]) {
  return assets.filter((asset) => !asset.generated)
}
