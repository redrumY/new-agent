import { Tool, ToolRiskLevel } from "z-agent-shared";
import { glob } from "glob";
import { SearchFilesSchema } from "./schemas";

const DEFAULT_CWD = process.cwd();

export const searchFilesTool: Tool<{ pattern: string }> = {
  name: "search_files",
  description: "根据 glob 模式搜索文件。例如使用 '**/*.tsx' 搜索所有 React 组件。",
  riskLevel: ToolRiskLevel.SAFE,
  requireApproval: false,
  parameters: SearchFilesSchema,
  execute: async ({ pattern }) => {
    try {
      const files = await glob(pattern, {
        cwd: DEFAULT_CWD,
        ignore: ["node_modules/**", ".next/**", "dist/**", ".git/**"],
      });
      return { files };
    } catch (error: any) {
      return { error: error.message };
    }
  },
};
