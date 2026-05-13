import type { AIAgentConfig, AICommandPreset, AIContextSnapshot } from '../types';
import { getDocumentLanguage, translateText } from '../../../i18n';

function section(title: string, content: string | undefined): string {
  if (!content?.trim()) return '';
  return `## ${title}\n${content.trim()}`;
}

export function renderContextPrompt(context: AIContextSnapshot): string {
  const language = getDocumentLanguage();
  const t = (value: string, params?: Record<string, string | number>) => translateText(language, value, params);
  const parts = [
    context.documentTitle ? t('文档标题：{title}', { title: context.documentTitle }) : '',
    context.documentPath ? t('文档路径：{path}', { path: context.documentPath }) : '',
    section(t('选中文本'), context.selectedText),
    section(t('光标前文'), context.cursorBeforeText),
    section(t('光标后文'), context.cursorAfterText),
    section(t('当前文档'), context.documentContent),
  ].filter(Boolean);

  return parts.length > 0 ? [`# ${t('写作上下文')}`, ...parts].join('\n\n') : '';
}

export function renderCommandPrompt(command: AICommandPreset | undefined, userInput: string): string {
  const language = getDocumentLanguage();
  const t = (value: string, params?: Record<string, string | number>) => translateText(language, value, params);
  const prompt = command?.userPromptTemplate || userInput;
  if (!command) return prompt;
  return [prompt, userInput && userInput !== prompt ? t('用户补充：{input}', { input: userInput }) : ''].filter(Boolean).join('\n\n');
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
