import {
  ChatCompletionRequestMessage,
  ChatCompletionRequestMessageRoleEnum
} from 'openai';

import { note } from '@clack/prompts';

import { getConfig } from './commands/config';
import { i18n, I18nLocals } from './i18n';
import { configureCommitlintIntegration } from './modules/commitlint/config';
import { commitlintPrompts } from './modules/commitlint/prompts';
import { ConsistencyPrompt } from './modules/commitlint/types';
import * as utils from './modules/commitlint/utils';

const config = getConfig();
const translation = i18n[(config?.OCO_LANGUAGE as I18nLocals) || 'en'];

export const IDENTITY =
  'You are to act as the author of a commit message in git.';

const INIT_MAIN_PROMPT = (language: string, issueID: string): ChatCompletionRequestMessage => ({
  role: ChatCompletionRequestMessageRoleEnum.System,
  content: `${IDENTITY} Your mission is to create a clean and comprehensive commit message as per the conventional commit convention and explain WHAT were the changes and mainly WHY the changes were done. 
  I'll send you an output of 'git diff --staged' command, and you are to convert it into a commit message. 
  Only produce a single commit message for all files combined.
    ${
      config?.OCO_EMOJI
        ? 'Use GitMoji convention to preface the commit.'
        : 'Do not preface the commit with anything.'
    }
    ${
      config?.OCO_DESCRIPTION
        ? 'Add a short description of WHY the changes are done after the single commit message title. Don\'t start it with "This commit", just describe the changes.'
        : "Your response should just be one line with a commit message title and no description."
    }
    ${
      config?.OCO_ISSUE_ENABLED
        ? `You must also include the Issue ID: ${issueID} in the commit message title.`
        : 'Don\'t include an Issue ID in the commit message title.'
    }
    Use the present tense. Lines must not be longer than 72 characters. Use ${language} for the commit message.`
});

export const INIT_DIFF_PROMPT: ChatCompletionRequestMessage = {
  role: ChatCompletionRequestMessageRoleEnum.User,
  content: `diff --git a/src/server.ts b/src/server.ts
    index ad4db42..f3b18a9 100644
    --- a/src/server.ts
    +++ b/src/server.ts
    @@ -10,7 +10,7 @@
    import {
        initWinstonLogger();
        
        const app = express();
        -const port = 7799;
        +const PORT = 7799;
        
        app.use(express.json());
        
        @@ -34,6 +34,6 @@
        app.use((_, res, next) => {
            // ROUTES
            app.use(PROTECTED_ROUTER_URL, protectedRouter);
            
            -app.listen(port, () => {
                -  console.log(\`Server listening on port \${port}\`);
                +app.listen(process.env.PORT || PORT, () => {
                    +  console.log(\`Server listening on port \${PORT}\`);
                });`
};

const INIT_CONSISTENCY_PROMPT = (
  translation: ConsistencyPrompt
): ChatCompletionRequestMessage => ({
  role: ChatCompletionRequestMessageRoleEnum.Assistant,
  content: `${config?.OCO_EMOJI ? '🐛 ' : ''}${translation.commitFeat}
${config?.OCO_DESCRIPTION ? translation.commitDescription : ''}`
});

export const getMainCommitPrompt = async (issueID: string): Promise<
  ChatCompletionRequestMessage[]
> => {
  switch (config?.OCO_PROMPT_MODULE) {
    case '@commitlint':
      if (!(await utils.commitlintLLMConfigExists())) {
        note(
          `OCO_PROMPT_MODULE is @commitlint but you haven't generated consistency for this project yet.`
        );
        await configureCommitlintIntegration();
      }

      // Replace example prompt with a prompt that's generated by OpenAI for the commitlint config.
      const commitLintConfig = await utils.getCommitlintLLMConfig();

      return [
        commitlintPrompts.INIT_MAIN_PROMPT(
          translation.localLanguage,
          commitLintConfig.prompts,
          issueID
        ),
        INIT_DIFF_PROMPT,
        INIT_CONSISTENCY_PROMPT(
          commitLintConfig.consistency[
            translation.localLanguage
          ] as ConsistencyPrompt
        )
      ];

    default:
      // conventional-commit
      return [
        INIT_MAIN_PROMPT(translation.localLanguage,issueID),
        INIT_DIFF_PROMPT,
        INIT_CONSISTENCY_PROMPT(translation)
      ];
  }
};
