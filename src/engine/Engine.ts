import { ChatCompletionRequestMessage } from 'openai';

export interface AiEngine {
  generateCommitMessage(
    messages: Array<ChatCompletionRequestMessage>
  ): Promise<string | undefined>;

  generateSingleCommitMessage(
    messages: string
  ): Promise<string | undefined>
}