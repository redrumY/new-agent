import { z } from "zod";

export const ReadFileSchema = z.object({
  path: z.string().describe("相对于项目根目录的文件路径"),
});

export const WriteFileSchema = z.object({
  path: z.string().describe("相对于项目根目录的文件路径"),
  content: z.string().describe("要写入的完整文件内容"),
});

export const SearchFilesSchema = z.object({
  pattern: z.string().describe("Glob 搜索模式，例如 '**/*.tsx'"),
});
