import { z } from 'zod'
import { removeAsset } from '../../../../utils/asset-storage'
import {
  MAX_ASSET_UPLOAD_SOURCE_BYTES,
  createWorkspaceAsset,
  parseWorkspaceAssetUpload,
} from '../../../../utils/workspace-assets'
import { readBodyWithinLimit } from '../../../../utils/bounded-request-body'

const MAX_MULTIPART_BYTES = MAX_ASSET_UPLOAD_SOURCE_BYTES + 64 * 1024

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!id.success) throw createError({ statusCode: 404, message: 'Biznesi nuk u gjet.' })
  if (!getHeader(event, 'content-type')?.startsWith('multipart/form-data'))
    throw createError({ statusCode: 415, message: 'Përdor multipart/form-data.' })
  const contentLengthHeader = getHeader(event, 'content-length')
  if (!contentLengthHeader || !/^\d+$/.test(contentLengthHeader))
    throw createError({ statusCode: 411, message: 'Kërkohet madhësia e upload-it.' })
  const contentLength = Number(contentLengthHeader)
  if (contentLength > MAX_MULTIPART_BYTES)
    throw createError({ statusCode: 413, message: 'Fotografia tejkalon kufirin e lejuar.' })
  if (event.node?.req) {
    const rawBody = await readBodyWithinLimit(event.node.req, MAX_MULTIPART_BYTES)
    ;(event.node.req as typeof event.node.req & { rawBody?: Buffer }).rawBody = rawBody
  }
  const input = parseWorkspaceAssetUpload((await readMultipartFormData(event)) || [])
  const uploadedStoragePaths: string[] = []
  try {
    return await withBusinessTransaction(user.id, (client, business) => {
      if (business.id !== id.data)
        throw createError({ statusCode: 404, message: 'Biznesi nuk u gjet.' })
      return createWorkspaceAsset(client, {
        businessId: id.data,
        userId: user.id,
        slug: business.slug,
        metadata: input.metadata,
        file: input.file,
        uploadedStoragePaths,
      })
    })
  } catch (error) {
    for (const storagePath of uploadedStoragePaths) {
      try {
        await removeAsset(storagePath)
      } catch (cleanupError) {
        console.error('Failed to clean up asset upload after rollback', {
          storagePath,
          cleanupError,
        })
      }
    }
    throw error
  }
})
