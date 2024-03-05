import axios from 'axios';
import chalk from 'chalk';
import {
  ChatCompletionRequestMessage,
  Configuration as OpenAiApiConfiguration,
  OpenAIApi
} from 'openai';

import { intro, outro } from '@clack/prompts';

import {
  CONFIG_MODES,
  AI_TYPE,
  getConfig
} from '../commands/config';
import { GenerateCommitMessageErrorEnum } from '../generateCommitMessageFromGitDiff';
import { tokenCount } from '../utils/tokenCount';
import { IDENTITY } from '../prompts';
import { AiEngine } from './Engine';

const config = getConfig();

const MAX_TOKENS_OUTPUT = config?.OCO_TOKENS_MAX_OUTPUT || 500;
const MAX_TOKENS_INPUT = config?.OCO_TOKENS_MAX_INPUT || 4096;
const BASE_PATH = config?.OCO_OPENAI_BASE_PATH;
const API_KEY = config?.OCO_OPENAI_API_KEY;
const API_TYPE = config?.OCO_OPENAI_API_TYPE || AI_TYPE.OPENAI;
const API_VERSION = config?.OCO_AZURE_API_VERSION || '2023-07-01-preview';
const MODEL = config?.OCO_MODEL || 'gpt-3.5-turbo';
const DEPLOYMENT = config?.OCO_AZURE_DEPLOYMENT;

const [command, mode] = process.argv.slice(2);

const isLocalModel = config?.OCO_AI_PROVIDER == 'ollama'


if (!API_KEY && command !== 'config' && mode !== CONFIG_MODES.set && !isLocalModel) {
  intro('opencommit');

  outro(
    'OCO_OPENAI_API_KEY is not set, please run `oco config set OCO_OPENAI_API_KEY=<your token> . If you are using GPT, make sure you add payment details, so API works.`'
  );
  outro(
    'For help look into README https://github.com/di-sukharev/opencommit#setup'
  );

  process.exit(1);
}
class OpenAi implements AiEngine {
  private openAiApiConfiguration = new OpenAiApiConfiguration({
    apiKey: API_KEY
  });
  private openAI!: OpenAIApi;

  constructor() {
    switch (API_TYPE) {
      case AI_TYPE.AZURE:
        this.openAiApiConfiguration.baseOptions = {
          headers: {
            'api-key': API_KEY
          },
          params: {
            'api-version': API_VERSION
          }
        };
        if (BASE_PATH) {
          this.openAiApiConfiguration.basePath =
            BASE_PATH + 'openai/deployments/' + DEPLOYMENT;
        }
        break;
      case AI_TYPE.OPENAI:
      // fall through to default
      default:
        if (BASE_PATH) {
          this.openAiApiConfiguration.basePath = BASE_PATH;
        }
    }
    this.openAI = new OpenAIApi(this.openAiApiConfiguration);
  }

  public generateSingleCommitMessage = async (
    messages: string
  ): Promise<string | undefined> => {
    const params = {
      model: MODEL,
      messages,
      temperature: 0,
      top_p: 0.1,
      max_tokens: MAX_TOKENS_OUTPUT
    };
    try {
      const completionReponse = await this.openAI.createChatCompletion({
        ...params,
        messages: [
          {
            role: 'system',
            content: ` ${IDENTITY} Your mission is to summarise multiple commit messages into a single commit message.`
          },
          {
            role: 'user',
            content: `Summarise the following commit messages into a single commit message title ensuring the title format stays the same.
              ${
                config?.OCO_EMOJI
                  ? 'Use GitMoji convention to preface the summarised commit.'
                  : 'Do not preface the commit with anything.'
              }
              ${
                config?.OCO_DESCRIPTION
                  ? 'Summarise the descriptions from the multiple messages into a single short description of WHY the changes are done after the commit message. Don\'t start it with "This commit", just describe the changes.'
                  : 'The summarised commit message should just be one line with a commit message title and no description.'
              }
              ${
                config?.OCO_ISSUE_ENABLED
                  ? `You must also keep the Issue ID in the summarised commit message title.`
                  : 'Don\'t include an Issue ID in the summarised commit message title.'
              } 
               The summarised commit message title needs to be less than 72 characters. Where there are multiple types (eg. fix, feat), this should be combined into the single most relevant type. 
               You should only output ONE commit message:\n${messages}`
          }
        ]
      });
      const oneLineMessage = completionReponse.data.choices[0].message;
      return oneLineMessage?.content;
    } catch (error) {
      outro(`${chalk.red('✖')} ${JSON.stringify(params)}`);

      const err = error as Error;
      outro(`${chalk.red('✖')} ${err?.message || err}`);

      if (
        axios.isAxiosError<{ error?: { message: string } }>(error) &&
        error.response?.status === 401
      ) {
        const openAiError = error.response.data.error;

        if (openAiError?.message) outro(openAiError.message);
        outro(
          'For help look into README https://github.com/di-sukharev/opencommit#setup'
        );
      }

      throw err;
    }
  };

  public generateCommitMessage = async (
    messages: Array<ChatCompletionRequestMessage>
  ): Promise<string | undefined> => {
    const params = {
      model: MODEL,
      messages,
      temperature: 0,
      top_p: 0.1,
      max_tokens: MAX_TOKENS_OUTPUT
    };
    try {
      const REQUEST_TOKENS = messages
        .map((msg) => tokenCount(msg.content) + 4)
        .reduce((a, b) => a + b, 0);

      if (REQUEST_TOKENS > MAX_TOKENS_INPUT - MAX_TOKENS_OUTPUT) {
        throw new Error(GenerateCommitMessageErrorEnum.tooMuchTokens);
      }

      const { data } = await this.openAI.createChatCompletion(params);

      const message = data.choices[0].message;

      return message?.content;
    } catch (error) {
      outro(`${chalk.red('✖')} ${JSON.stringify(params)}`);

      const err = error as Error;
      outro(`${chalk.red('✖')} ${err?.message || err}`);

      if (
        axios.isAxiosError<{ error?: { message: string } }>(error) &&
        error.response?.status === 401
      ) {
        const openAiError = error.response.data.error;

        if (openAiError?.message) outro(openAiError.message);
        outro(
          'For help look into README https://github.com/di-sukharev/opencommit#setup'
        );
      }

      throw err;
    }
  };
}


export const api = new OpenAi();
