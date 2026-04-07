import { Tool, ToolRiskLevel } from "z-agent-shared";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { ReadFileSchema, WriteFileSchema } from "./schemas";

const DEFAULT_CWD = process.cwd();

function safePath(p: string) {
  const absolutePath = path.isAbsolute(p) ? p : path.join(DEFAULT_CWD, p);
  if (!absolutePath.startsWith(DEFAULT_CWD)) {
    throw new Error(`Access denied: ${p} is outside of project root.`);
  }
  return absolutePath;
}

export const readFileTool: Tool<{ path: string }> = {
  name: "read_file",
  description: "读取指定文件的内容。建议在分析代码逻辑前调用。",
  riskLevel: ToolRiskLevel.SAFE,
  requireApproval: false,
  parameters: ReadFileSchema,
  execute: async ({ path: p }) => {
    try {
      const content = await readFile(safePath(p), "utf-8");
      return { content, path: p };
    } catch (error: any) {
      return { error: error.message };
    }
  },
};

export const writeFileTool: Tool<{ path: string; content: string }> = {
  name: "write_file",
  description: "写入内容到指定文件。如果目录不存在会自动创建。",
  riskLevel: ToolRiskLevel.MODERATE,
  requireApproval: true,
  parameters: WriteFileSchema,
  execute: async ({ path: p, content }) => {
    try {
      const targetPath = safePath(p);
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, content, "utf-8");
      return { success: true, path: p };
    } catch (error: any) {
      return { error: error.message };
    }
  },
};
