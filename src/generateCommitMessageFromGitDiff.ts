import {
  ChatCompletionRequestMessage,
  ChatCompletionRequestMessageRoleEnum
} from 'openai';

import { getConfig } from './commands/config';
import { getMainCommitPrompt } from './prompts';
import { mergeDiffs } from './utils/mergeDiffs';
import { tokenCount } from './utils/tokenCount';
import { getEngine } from './utils/engine';

const config = getConfig();
const DEFAULT_MAX_TOKENS_INPUT = 4096;
const DEFAULT_MAX_TOKENS_OUTPUT = 500;
const MAX_TOKENS_INPUT = config?.OCO_TOKENS_MAX_INPUT || DEFAULT_MAX_TOKENS_INPUT;
const MAX_TOKENS_OUTPUT = config?.OCO_TOKENS_MAX_OUTPUT || DEFAULT_MAX_TOKENS_OUTPUT;

const generateCommitMessageChatCompletionPrompt = async (
  diff: string,
  issueID: string
): Promise<Array<ChatCompletionRequestMessage>> => {
  const INIT_MESSAGES_PROMPT = await getMainCommitPrompt(issueID);

  const chatContextAsCompletionRequest = [...INIT_MESSAGES_PROMPT];

  chatContextAsCompletionRequest.push({
    role: ChatCompletionRequestMessageRoleEnum.User,
    content: diff
  });

  return chatContextAsCompletionRequest;
};

export enum GenerateCommitMessageErrorEnum {
  tooMuchTokens = 'TOO_MUCH_TOKENS',
  internalError = 'INTERNAL_ERROR',
  emptyMessage = 'EMPTY_MESSAGE',
  outputTokensTooHigh = `Token limit exceeded, OCO_TOKENS_MAX_OUTPUT must not be much higher than the default ${DEFAULT_MAX_TOKENS_OUTPUT} tokens.`
}

const ADJUSTMENT_FACTOR = 20;

export const generateCommitMessageByDiff = async (
  diff: string,
  issueID: string
): Promise<string> => {
  try {
    const INIT_MESSAGES_PROMPT = await getMainCommitPrompt(issueID);
    const engine = getEngine()

    const INIT_MESSAGES_PROMPT_LENGTH = INIT_MESSAGES_PROMPT.map(
      (msg) => tokenCount(msg.content) + 4
    ).reduce((a, b) => a + b, 0);

    const MAX_REQUEST_TOKENS =
      MAX_TOKENS_INPUT -
      ADJUSTMENT_FACTOR -
      INIT_MESSAGES_PROMPT_LENGTH -
      MAX_TOKENS_OUTPUT;

    if (tokenCount(diff) >= MAX_REQUEST_TOKENS) {
      const commitMessagePromises = await getCommitMsgsPromisesFromFileDiffs(
        diff,
        MAX_REQUEST_TOKENS,
        issueID
      );

      const commitMessages = [];
      for (const promise of commitMessagePromises) {
        commitMessages.push(await promise);
        await delay(2000);
      }

      const commitMessagesNewLines = commitMessages.join('\n');

      const combinedCommitMessage = await engine.generateSingleCommitMessage(commitMessagesNewLines);

      if (!combinedCommitMessage)
      throw new Error(GenerateCommitMessageErrorEnum.emptyMessage);

      return combinedCommitMessage;
    }

    const messages = await generateCommitMessageChatCompletionPrompt(diff, issueID);

    const commitMessage = await engine.generateCommitMessage(messages);

    if (!commitMessage)
      throw new Error(GenerateCommitMessageErrorEnum.emptyMessage);

    return commitMessage;
  } catch (error) {
    throw error;
  }
};

function getMessagesPromisesByChangesInFile(
  fileDiff: string,
  separator: string,
  maxChangeLength: number,
  issueID: string
) {
  const hunkHeaderSeparator = '@@ ';
  const [fileHeader, ...fileDiffByLines] = fileDiff.split(hunkHeaderSeparator);

  // merge multiple line-diffs into 1 to save tokens
  const mergedChanges = mergeDiffs(
    fileDiffByLines.map((line) => hunkHeaderSeparator + line),
    maxChangeLength
  );

  const lineDiffsWithHeader = [];
  for (const change of mergedChanges) {
    const totalChange = fileHeader + change;
    if (tokenCount(totalChange) > maxChangeLength) {
      // If the totalChange is too large, split it into smaller pieces
      const splitChanges = splitDiff(totalChange, maxChangeLength);
      lineDiffsWithHeader.push(...splitChanges);
    } else {
      lineDiffsWithHeader.push(totalChange);
    }
  }

  const engine = getEngine()
  const commitMsgsFromFileLineDiffs = lineDiffsWithHeader.map(
    async (lineDiff) => {
      const messages = await generateCommitMessageChatCompletionPrompt(
        separator + lineDiff, issueID
      );

      return engine.generateCommitMessage(messages);
    }
  );

  return commitMsgsFromFileLineDiffs;
}

function splitDiff(diff: string, maxChangeLength: number) {
  const lines = diff.split('\n');
  const splitDiffs = [];
  let currentDiff = '';
  
  if (maxChangeLength <= 0) {
    throw new Error(GenerateCommitMessageErrorEnum.outputTokensTooHigh);
  }

  for (let line of lines) {
    // If a single line exceeds maxChangeLength, split it into multiple lines
    while (tokenCount(line) > maxChangeLength) {
      const subLine = line.substring(0, maxChangeLength);
      line = line.substring(maxChangeLength);
      splitDiffs.push(subLine);
    }

    // Check the tokenCount of the currentDiff and the line separately
    if (tokenCount(currentDiff) + tokenCount('\n' + line) > maxChangeLength) {
      // If adding the next line would exceed the maxChangeLength, start a new diff
      splitDiffs.push(currentDiff);
      currentDiff = line;
    } else {
      // Otherwise, add the line to the current diff
      currentDiff += '\n' + line;
    }
  }

  // Add the last diff
  if (currentDiff) {
    splitDiffs.push(currentDiff);
  }

  return splitDiffs;
}

export const getCommitMsgsPromisesFromFileDiffs = async (
  diff: string,
  maxDiffLength: number,
  issueID: string
) => {
  const separator = 'diff --git ';

  const diffByFiles = diff.split(separator).slice(1);

  // merge multiple files-diffs into 1 prompt to save tokens
  const mergedFilesDiffs = mergeDiffs(diffByFiles, maxDiffLength);

  const commitMessagePromises = [];

  for (const fileDiff of mergedFilesDiffs) {
    if (tokenCount(fileDiff) >= maxDiffLength) {
      // if file-diff is bigger than gpt context — split fileDiff into lineDiff
      const messagesPromises = getMessagesPromisesByChangesInFile(
        fileDiff,
        separator,
        maxDiffLength,
        issueID
      );

      commitMessagePromises.push(...messagesPromises);
    } else {
      const messages = await generateCommitMessageChatCompletionPrompt(
        separator + fileDiff, issueID
      );

      const engine = getEngine()
      commitMessagePromises.push(engine.generateCommitMessage(messages));
    }
  }

  return commitMessagePromises;
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
