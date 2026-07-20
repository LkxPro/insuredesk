import { z } from "zod";

/**
 * 字典目录 contract factory: the three catalogs (渠道/类别/完结状态) share one
 * input-schema shape, differing only in the noun their validation messages
 * carry. Per-catalog modules re-export the generated schemas under their
 * historical names, so the wire and every frontend import stay unchanged.
 */

/** `nameNoun` is the short noun in name-field messages（渠道/类别/状态）. */
export function createCatalogSchemas(nameNoun: string) {
  const fields = {
    name: z
      .string()
      .trim()
      .min(1, `请填写${nameNoun}名称`)
      .max(50, `${nameNoun}名称最多 50 个字符`),
    displayOrder: z.number().int("显示顺序必须为整数"),
  };
  return {
    createInputSchema: z.object(fields),
    updateInputSchema: z.object({ id: z.string().min(1), ...fields }),
    setActiveInputSchema: z.object({ id: z.string().min(1), active: z.boolean() }),
    deleteInputSchema: z.object({ id: z.string().min(1) }),
  };
}

export type CatalogSchemas = ReturnType<typeof createCatalogSchemas>;
