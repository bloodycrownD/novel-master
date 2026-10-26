/**
 * Composer 发送门闩 / 入参清洗策略（T-ATD* / T-CR3）。
 *
 * @module domain/chat/logic/composer/composer-send-policy
 */

import {attachmentScanner} from "../attachment/attachment-scanner.js";

type ComposerSendIntentInput = {
    text: string;
    canResumeWithoutInput: boolean;
    hasAnnotateDrafts?: boolean;
    hasModel?: boolean;
    running?: boolean;
};

type ComposerSendIntent = {
    hasSendable: boolean;
    allowResumeWithoutInput: boolean;
    attachOnly: readonly [];
    sendDisabled: boolean;
};

/** 发送门闩策略。 */
class ComposerSendPolicy {
    evaluate(input: ComposerSendIntentInput): ComposerSendIntent {
        const content = input.text.trim();
        const scannedCount = attachmentScanner.scanAtPaths(input.text).length + attachmentScanner.scanSkills(input.text).length;
        const hasSendable = content !== "" || scannedCount > 0 || input.hasAnnotateDrafts === true;
        const allowResumeWithoutInput = !hasSendable && input.canResumeWithoutInput;
        const hasModel = input.hasModel !== false;
        const running = input.running === true;
        const sendDisabled = !hasModel || (!running && !hasSendable && !input.canResumeWithoutInput);
        return {hasSendable, allowResumeWithoutInput, attachOnly: [], sendDisabled};
    }
}

export const composerSendPolicy = new ComposerSendPolicy();
