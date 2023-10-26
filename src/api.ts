import axios from 'axios';
import chalk from 'chalk';
import { execa } from 'execa';
import {
  ChatCompletionRequestMessage,
  Configuration as OpenAiApiConfiguration,
  OpenAIApi
} from 'openai';

import { intro, outro } from '@clack/prompts';

import {
  CONFIG_MODES,
  AI_TYPE,
  DEFAULT_MODEL_TOKEN_LIMIT,
  getConfig
} from './commands/config';
import { GenerateCommitMessageErrorEnum } from './generateCommitMessageFromGitDiff';
import { tokenCount } from './utils/tokenCount';

const config = getConfig();

const MAX_TOKENS = config?.OCO_OPENAI_MAX_TOKENS;
const BASE_PATH = config?.OCO_OPENAI_BASE_PATH;
const API_KEY = config?.OCO_OPENAI_API_KEY;
const API_TYPE = config?.OCO_OPENAI_API_TYPE || AI_TYPE.OPENAI;
const API_VERSION = config?.OCO_AZURE_API_VERSION || '2023-07-01-preview';
const MODEL = config?.OCO_MODEL || 'gpt-3.5-turbo';
const DEPLOYMENT = config?.OCO_AZURE_DEPLOYMENT;

const [command, mode] = process.argv.slice(2);

if (!API_KEY && command !== 'config' && mode !== CONFIG_MODES.set) {
  intro('opencommit');

  outro(
    'OCO_OPENAI_API_KEY is not set, please run `oco config set OCO_OPENAI_API_KEY=<your token>. Make sure you add payment details, so API works.`'
  );
  outro(
    'For help look into README https://github.com/di-sukharev/opencommit#setup'
  );

  process.exit(1);
}
class OpenAi {
  private openAiApiConfiguration = new OpenAiApiConfiguration({
    apiKey: API_KEY
  });
  private openAI!: OpenAIApi;

  constructor() {
    switch (API_TYPE) {
      case AI_TYPE.AZURE:
        this.openAiApiConfiguration.baseOptions =  {
          headers: {
            "api-key": API_KEY,
          },
          params: {
            'api-version': API_VERSION,
          }
        };
        if (BASE_PATH) {
          this.openAiApiConfiguration.basePath = BASE_PATH + 'openai/deployments/' + DEPLOYMENT;
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

  public generateCommitMessage = async (
    messages: Array<ChatCompletionRequestMessage>
  ): Promise<string | undefined> => {
    const params = {
      model: MODEL,
      messages,
      temperature: 0,
      top_p: 0.1,
      max_tokens: MAX_TOKENS || 500
    };
    try {
      const REQUEST_TOKENS = messages
        .map((msg) => tokenCount(msg.content) + 4)
        .reduce((a, b) => a + b, 0);

      if (REQUEST_TOKENS > DEFAULT_MODEL_TOKEN_LIMIT - MAX_TOKENS) {
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

export const getOpenCommitLatestVersion = async (): Promise<
  string | undefined
> => {
  try {
    const { stdout } = await execa('npm', ['view', 'opencommit', 'version']);
    return stdout;
  } catch (_) {
    outro('Error while getting the latest version of opencommit');
    return undefined;
  }
};

export const api = new OpenAi();
