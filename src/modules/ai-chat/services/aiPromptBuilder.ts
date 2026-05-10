import type { AIAgentConfig, AICommandPreset, AIContextSnapshot } from '../types';

function section(title: string, content: string | undefined): string {
  if (!content?.trim()) return '';
  return `## ${title}\n${content.trim()}`;
}

export function renderContextPrompt(context: AIContextSnapshot): string {
  const parts = [
    context.documentTitle ? `文档标题：${context.documentTitle}` : '',
    context.documentPath ? `文档路径：${context.documentPath}` : '',
    section('选中文本', context.selectedText),
    section('光标前文', context.cursorBeforeText),
    section('光标后文', context.cursorAfterText),
    section('当前文档', context.documentContent),
  ].filter(Boolean);

  return parts.length > 0 ? ['# 写作上下文', ...parts].join('\n\n') : '';
}

export function renderCommandPrompt(command: AICommandPreset | undefined, userInput: string): string {
  const prompt = command?.userPromptTemplate || userInput;
  if (!command) return prompt;
  return [prompt, userInput && userInput !== prompt ? `用户补充：${userInput}` : ''].filter(Boolean).join('\n\n');
}

export function buildPrompt(input: {
  agent: AIAgentConfig;
  command?: AICommandPreset;
  context: AIContextSnapshot;
  userInput: string;
}) {
  return {
    system: input.agent.systemPrompt,
    user: [
      renderContextPrompt(input.context),
      renderCommandPrompt(input.command, input.userInput),
    ].filter(Boolean).join('\n\n'),
  };
}
