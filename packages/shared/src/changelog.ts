import { z } from "zod";

export const CHANGELOG_CATEGORIES = ["新增", "改进", "修复", "内部"] as const;
export const changelogCategorySchema = z.enum(CHANGELOG_CATEGORIES);
export type ChangelogCategory = (typeof CHANGELOG_CATEGORIES)[number];

export const CHANGELOG_VERSION_PATTERN = /^v\d{4}\.\d{2}\.\d+$/;

export const changelogEntrySchema = z.strictObject({
  category: changelogCategorySchema,
  user: z.string().trim().min(1),
  full: z.string().trim().min(1),
  page: z.string().regex(/^\//).optional(),
  screenshot: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\.png$/)
    .optional(),
});
export type ChangelogEntry = z.infer<typeof changelogEntrySchema>;

export const changelogFileSchema = z.strictObject({
  version: z.string().regex(CHANGELOG_VERSION_PATTERN),
  date: z.iso.date(),
  entries: z.array(changelogEntrySchema).min(1),
});
export type ChangelogFile = z.infer<typeof changelogFileSchema>;
